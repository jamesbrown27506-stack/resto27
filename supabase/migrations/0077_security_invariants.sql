-- A verified recovery OTP issues an opaque, short-lived grant. Browser roles
-- cannot create or consume these rows; a stolen ordinary session is not enough.
begin;

create table if not exists public.account_recovery_grants (
  token_hash text primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.account_recovery_grants enable row level security;
revoke all on public.account_recovery_grants from public, anon, authenticated;
grant all on public.account_recovery_grants to service_role;

create or replace function public.consume_recovery_grant(p_token_hash text, p_auth_user_id uuid, p_session_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_claimed text;
begin
  update public.account_recovery_grants set consumed_at = now()
  where token_hash = p_token_hash and auth_user_id = p_auth_user_id
    and session_id = p_session_id and expires_at > now() and consumed_at is null
  returning token_hash into v_claimed;
  return v_claimed is not null;
end $$;
revoke all on function public.consume_recovery_grant(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_recovery_grant(text, uuid, uuid) to service_role;

-- Withdrawals are reserved and debited under the same wallet row lock. Every
-- executor (including retry/admin/cron) revalidates the original withdrawer.
alter table public.withdrawal_requests add column if not exists debited_at timestamptz;
update public.withdrawal_requests set debited_at = coalesce(decided_at, requested_at)
where status = 'paid' and debited_at is null;

create or replace function public.wallet_refund_hold(p_restaurant_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(greatest(0, total - coalesce(service_charge, 0))) from public.orders
      where restaurant_id = p_restaurant_id and is_paid
        and payment_method in ('mobile_money', 'wallet') and status in ('confirmed', 'preparing', 'shipped')), 0)
    + coalesce((select sum(deposit) from (
        select r.id, max(a.amount) as deposit from public.reservations r
        join public.payment_attempts a on a.reservation_id = r.id and a.status = 'succeeded'
        where r.restaurant_id = p_restaurant_id and r.status = 'confirmed' and r.deposit_paid and r.reserved_for > now()
        group by r.id
      ) deposits), 0);
$$;

create or replace function public.withdrawal_current_limit(p_restaurant_id uuid, p_profile_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles%rowtype; v_role text; v_limit integer;
begin
  select * into v_profile from public.profiles where id = p_profile_id for share;
  if not found or v_profile.status <> 'active' or v_profile.deleted_at is not null then
    raise exception 'withdrawal_not_allowed';
  end if;
  if not exists (select 1 from public.restaurants where id = p_restaurant_id and status in ('active', 'paused')) then
    raise exception 'withdrawal_not_allowed';
  end if;
  select role into v_role from public.restaurant_staff
    where restaurant_id = p_restaurant_id and profile_id = p_profile_id and status = 'active' for share;
  if v_role = 'owner' or exists (select 1 from public.restaurants where id = p_restaurant_id and owner_id = p_profile_id) then
    return null;
  end if;
  if v_role is distinct from 'manager' then raise exception 'withdrawal_not_allowed'; end if;
  select daily_limit into v_limit from public.withdrawal_permissions
    where restaurant_id = p_restaurant_id and profile_id = p_profile_id for share;
  if not found then raise exception 'withdrawal_not_allowed'; end if;
  return v_limit;
end $$;

create or replace function public.request_withdrawal_secure(
  p_restaurant_id uuid, p_profile_id uuid, p_amount integer, p_payout_account_id uuid,
  p_note text default null, p_recipient_name text default null, p_keep integer default 0
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_balance integer; v_limit integer; v_used bigint; v_queued bigint;
  v_account public.payout_accounts%rowtype; v_request_id uuid; v_role text;
begin
  if p_amount is null or p_amount < 500 or p_keep is null or p_keep < 0 then raise exception 'withdrawal_bad_amount'; end if;
  select balance into v_balance from public.restaurant_wallets where restaurant_id = p_restaurant_id for update;
  if not found then raise exception 'withdrawal_insufficient_balance'; end if;
  v_limit := public.withdrawal_current_limit(p_restaurant_id, p_profile_id);
  select a.* into v_account from public.payout_accounts a join public.restaurants r on r.id = p_restaurant_id
    where a.id = p_payout_account_id and a.account_id = coalesce(r.parent_id, r.id) and a.removed_at is null for share of a;
  if not found then raise exception 'withdrawal_account_missing'; end if;
  select coalesce(sum(amount), 0) into v_queued from public.withdrawal_requests where restaurant_id = p_restaurant_id and status = 'pending';
  if v_balance::bigint - v_queued - public.wallet_refund_hold(p_restaurant_id) - p_keep < p_amount then
    raise exception 'withdrawal_insufficient_balance';
  end if;
  if v_limit is not null then
    select coalesce(sum(amount), 0) into v_used from public.withdrawal_requests
      where restaurant_id = p_restaurant_id and requested_by = p_profile_id
        and (status = 'pending' or (status = 'paid' and coalesce(debited_at, decided_at, requested_at) > now() - interval '24 hours'));
    if v_used + p_amount > v_limit then raise exception 'withdrawal_daily_limit'; end if;
  end if;
  select role into v_role from public.restaurant_staff where restaurant_id = p_restaurant_id and profile_id = p_profile_id and status = 'active';
  insert into public.withdrawal_requests(restaurant_id, requested_by, amount, phone, note, recipient_name, requester_role, payout_account_id)
    values(p_restaurant_id, p_profile_id, p_amount, v_account.phone, left(p_note, 1000), p_recipient_name, coalesce(v_role, 'owner'), v_account.id)
    returning id into v_request_id;
  return v_request_id;
end $$;

-- A generic debit cannot silently bypass the withdrawal policy, including
-- during deployment while an older application instance is still running.
create or replace function public.wallet_debit(p_restaurant_id uuid, p_amount integer, p_kind text, p_note text default null, p_reference text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  if p_amount <= 0 then raise exception 'debit amount must be positive'; end if;
  if p_kind = 'withdrawal' and (p_reference is null or current_setting('app.withdrawal_claim', true) is distinct from p_reference) then
    raise exception 'withdrawal_secure_claim_required';
  end if;
  select balance into v_balance from public.restaurant_wallets where restaurant_id = p_restaurant_id for update;
  if v_balance is null or v_balance < p_amount then raise exception 'insufficient balance'; end if;
  insert into public.wallet_ledger(restaurant_id, amount, kind, note, reference) values(p_restaurant_id, -p_amount, p_kind, p_note, p_reference);
  update public.restaurant_wallets set balance = balance - p_amount, updated_at = now() where restaurant_id = p_restaurant_id;
  return v_balance - p_amount;
end $$;

create or replace function public.claim_withdrawal_secure(p_request_id uuid, p_actor_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_request public.withdrawal_requests%rowtype; v_restaurant uuid; v_balance integer;
  v_limit integer; v_used bigint; v_queued bigint; v_actor public.profiles%rowtype; v_account public.payout_accounts%rowtype;
begin
  select restaurant_id into v_restaurant from public.withdrawal_requests where id = p_request_id;
  if not found then raise exception 'withdrawal_not_found'; end if;
  select balance into v_balance from public.restaurant_wallets where restaurant_id = v_restaurant for update;
  if not found then raise exception 'withdrawal_insufficient_balance'; end if;
  select * into v_request from public.withdrawal_requests where id = p_request_id for update;
  if v_request.status <> 'pending' then return false; end if;
  select * into v_actor from public.profiles where id = p_actor_id for share;
  if not found or v_actor.status <> 'active' or v_actor.deleted_at is not null
    or (p_actor_id is distinct from v_request.requested_by and v_actor.role <> 'admin') then
    raise exception 'withdrawal_not_allowed';
  end if;
  v_limit := public.withdrawal_current_limit(v_restaurant, v_request.requested_by);
  select a.* into v_account from public.payout_accounts a join public.restaurants r on r.id = v_restaurant
    where a.id = v_request.payout_account_id and a.account_id = coalesce(r.parent_id, r.id) and a.removed_at is null for share of a;
  if not found or v_account.phone is distinct from v_request.phone then raise exception 'withdrawal_account_missing'; end if;
  select coalesce(sum(amount), 0) into v_queued from public.withdrawal_requests
    where restaurant_id = v_restaurant and status = 'pending' and id <> p_request_id;
  if v_balance::bigint - v_queued - public.wallet_refund_hold(v_restaurant) < v_request.amount then
    raise exception 'withdrawal_insufficient_balance';
  end if;
  if v_limit is not null then
    select coalesce(sum(amount), 0) into v_used from public.withdrawal_requests
      where restaurant_id = v_restaurant and requested_by = v_request.requested_by and id <> p_request_id
        and (status = 'pending' or (status = 'paid' and coalesce(debited_at, decided_at, requested_at) > now() - interval '24 hours'));
    if v_used + v_request.amount > v_limit then raise exception 'withdrawal_daily_limit'; end if;
  end if;
  update public.withdrawal_requests set status = 'paid', decided_at = null, decided_by = p_actor_id, debited_at = now() where id = p_request_id;
  perform set_config('app.withdrawal_claim', p_request_id::text, true);
  perform public.wallet_debit(v_restaurant, v_request.amount, 'withdrawal', 'Withdrawal ' || p_request_id, p_request_id::text);
  return true;
end $$;

create or replace function public.release_withdrawal_secure(p_request_id uuid, p_actor_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_request public.withdrawal_requests%rowtype; v_restaurant uuid;
begin
  select restaurant_id into v_restaurant from public.withdrawal_requests where id = p_request_id;
  perform 1 from public.restaurant_wallets where restaurant_id = v_restaurant for update;
  select * into v_request from public.withdrawal_requests where id = p_request_id for update;
  if not found or v_request.status <> 'paid' or v_request.reply_to is not null or v_request.decided_at is not null
    or v_request.decided_by is distinct from p_actor_id or v_request.debited_at is null then return false; end if;
  perform public.wallet_credit(v_restaurant, v_request.amount, 'adjustment', 'Withdrawal refused: ' || left(p_reason, 500), p_request_id::text);
  update public.withdrawal_requests set status = 'pending', decided_at = null, decided_by = null, debited_at = null where id = p_request_id;
  return true;
end $$;

revoke all on function public.wallet_refund_hold(uuid), public.withdrawal_current_limit(uuid, uuid),
  public.request_withdrawal_secure(uuid, uuid, integer, uuid, text, text, integer),
  public.wallet_debit(uuid, integer, text, text, text), public.claim_withdrawal_secure(uuid, uuid),
  public.release_withdrawal_secure(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.wallet_refund_hold(uuid), public.withdrawal_current_limit(uuid, uuid),
  public.request_withdrawal_secure(uuid, uuid, integer, uuid, text, text, integer),
  public.wallet_debit(uuid, integer, text, text, text), public.claim_withdrawal_secure(uuid, uuid),
  public.release_withdrawal_secure(uuid, uuid, text) to service_role;

-- Checkout claims stock, coupon usage and loyalty in one transaction. Prices
-- still come from the server; a rejected claim changes none of these resources.
alter table public.orders add column if not exists checkout_finalized boolean not null default true;
create table if not exists public.checkout_resource_claims (
  order_id uuid primary key references public.orders(id) on delete cascade,
  quantities jsonb not null,
  promo_id uuid,
  platform_coupon boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.checkout_resource_claims enable row level security;
revoke all on public.checkout_resource_claims from public, anon, authenticated;
grant all on public.checkout_resource_claims to service_role;

create or replace function public.finalize_checkout_secure(p_order_id uuid, p_promo_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype; v_item record; v_promo record; v_platform boolean := false;
  v_quantities jsonb := '[]'; v_low jsonb := '[]'; v_points bigint;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'pending' then raise exception 'checkout_order_missing'; end if;
  if exists (select 1 from public.checkout_resource_claims where order_id = p_order_id) then
    return jsonb_build_object('low_stock', '[]'::jsonb);
  end if;
  if v_order.checkout_finalized then raise exception 'checkout_already_finalized'; end if;
  if v_order.customer_id is not null and not exists (select 1 from public.profiles where id = v_order.customer_id and status = 'active' and deleted_at is null) then
    raise exception 'checkout_customer_invalid';
  end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id)
    or (select count(*) from public.order_items where order_id = p_order_id) > 100
    or exists (select 1 from public.order_items oi left join public.menu_items m on m.id = oi.menu_item_id
      where oi.order_id = p_order_id and (oi.quantity < 1 or oi.quantity > 50 or m.id is null or m.restaurant_id <> v_order.restaurant_id)) then
    raise exception 'checkout_bad_lines';
  end if;
  -- Lock dishes in a stable order, aggregating variants/duplicate basket lines.
  for v_item in
    select m.*, q.quantity from public.menu_items m join (
      select menu_item_id, sum(quantity) as quantity from public.order_items where order_id = p_order_id group by menu_item_id
    ) q on q.menu_item_id = m.id order by m.id for update of m
  loop
    if not v_item.is_available then raise exception 'checkout_item_unavailable'; end if;
    if v_item.track_stock and v_item.stock_quantity is not null then
      if v_item.stock_quantity < v_item.quantity then raise exception 'checkout_insufficient_stock'; end if;
      update public.menu_items set stock_quantity = stock_quantity - v_item.quantity where id = v_item.id;
      v_quantities := v_quantities || jsonb_build_array(jsonb_build_object('id', v_item.id, 'quantity', v_item.quantity));
      if v_item.low_stock_threshold is not null and v_item.stock_quantity > v_item.low_stock_threshold
        and v_item.stock_quantity - v_item.quantity <= v_item.low_stock_threshold then
        v_low := v_low || jsonb_build_array(jsonb_build_object('id', v_item.id, 'name', v_item.name, 'remaining', v_item.stock_quantity - v_item.quantity));
      end if;
    end if;
  end loop;
  if p_promo_id is not null then
    select id, code, used_count, usage_limit, is_active, starts_at, ends_at, min_order into v_promo
      from public.promotions where id = p_promo_id and restaurant_id = v_order.restaurant_id for update;
    if not found then
      v_platform := true;
      select id, code, used_count, usage_limit, is_active, starts_at, ends_at, min_order into v_promo
        from public.platform_coupons where id = p_promo_id for update;
      if not found then raise exception 'checkout_promo_invalid'; end if;
    end if;
    if not v_promo.is_active or v_promo.code is distinct from v_order.promo_code
      or (v_promo.starts_at is not null and v_promo.starts_at > now())
      or (v_promo.ends_at is not null and v_promo.ends_at < now()) or v_order.subtotal < v_promo.min_order
      or (v_promo.usage_limit is not null and v_promo.used_count >= v_promo.usage_limit) then
      raise exception 'checkout_promo_invalid';
    end if;
    if v_platform then update public.platform_coupons set used_count = used_count + 1 where id = p_promo_id;
    else
      update public.promotions set used_count = used_count + 1 where id = p_promo_id;
      insert into public.promotion_redemptions(promotion_id, order_id, customer_id, amount)
        values(p_promo_id, p_order_id, v_order.customer_id, v_order.discount_amount);
    end if;
  elsif v_order.promo_code is not null or v_order.discount_amount > 0 then
    raise exception 'checkout_promo_invalid';
  end if;
  if v_order.loyalty_points_used > 0 then
    if v_order.customer_id is null then raise exception 'checkout_customer_invalid'; end if;
    perform pg_advisory_xact_lock(hashtextextended('checkout-loyalty:' || v_order.customer_id::text, 0));
    select coalesce(sum(points), 0) into v_points from public.loyalty_ledger where profile_id = v_order.customer_id;
    if v_points < v_order.loyalty_points_used then raise exception 'checkout_not_enough_points'; end if;
    insert into public.loyalty_ledger(profile_id, order_id, restaurant_id, points, kind, note)
      values(v_order.customer_id, p_order_id, v_order.restaurant_id, -v_order.loyalty_points_used, 'redeem', 'Commande ' || v_order.reference);
  end if;
  insert into public.checkout_resource_claims(order_id, quantities, promo_id, platform_coupon)
    values(p_order_id, v_quantities, p_promo_id, v_platform);
  update public.orders set checkout_finalized = true where id = p_order_id;
  return jsonb_build_object('low_stock', v_low);
end $$;

create or replace function public.rollback_pending_checkout()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_claim public.checkout_resource_claims%rowtype; v_item record;
begin
  select * into v_claim from public.checkout_resource_claims where order_id = old.id;
  if not found or old.status <> 'pending' then return old; end if;
  for v_item in select m.id, q.quantity from public.menu_items m
    join jsonb_to_recordset(v_claim.quantities) as q(id uuid, quantity integer) on m.id = q.id
    order by m.id for update of m
  loop
    update public.menu_items set stock_quantity = stock_quantity + v_item.quantity where id = v_item.id;
  end loop;
  if v_claim.promo_id is not null then
    if v_claim.platform_coupon then update public.platform_coupons set used_count = greatest(0, used_count - 1) where id = v_claim.promo_id;
    else
      update public.promotions set used_count = greatest(0, used_count - 1) where id = v_claim.promo_id;
      delete from public.promotion_redemptions where order_id = old.id;
    end if;
  end if;
  delete from public.loyalty_ledger where order_id = old.id and kind = 'redeem';
  return old;
end $$;
drop trigger if exists rollback_pending_checkout on public.orders;
create trigger rollback_pending_checkout before delete on public.orders for each row execute function public.rollback_pending_checkout();
revoke all on function public.finalize_checkout_secure(uuid, uuid), public.rollback_pending_checkout() from public, anon, authenticated;
grant execute on function public.finalize_checkout_secure(uuid, uuid) to service_role;

-- Public photo writes have a durable per-person budget, not a per-instance
-- counter. Both reservations and completed uploads consume the byte quota.
create table public.customer_uploads (
  object_path text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('avatars', 'reviews')),
  bytes integer not null check (bytes between 1 and 2097152),
  public_url text not null unique,
  ready boolean not null default false,
  created_at timestamptz not null default now()
);
create index customer_uploads_profile_created on public.customer_uploads(profile_id, created_at);
alter table public.customer_uploads enable row level security;
revoke all on public.customer_uploads from public, anon, authenticated;
grant all on public.customer_uploads to service_role;

create or replace function public.reserve_customer_upload(
  p_profile_id uuid, p_auth_user_id uuid, p_object_path text, p_kind text, p_bytes integer, p_public_url text
) returns void language plpgsql security definer set search_path = public as $$
declare v_bytes bigint; v_recent bigint;
begin
  perform 1 from public.profiles where id = p_profile_id and auth_user_id = p_auth_user_id
    and status = 'active' and deleted_at is null for update;
  if not found then raise exception 'upload_not_allowed'; end if;
  if p_kind not in ('avatars', 'reviews') or p_bytes not between 1 and 2097152
    or p_object_path not like p_kind || '/%' or p_object_path ~ '\.\.|[[:cntrl:]]' then
    raise exception 'upload_bad_input';
  end if;
  select coalesce(sum(bytes), 0), count(*) filter (where created_at > now() - interval '24 hours')
    into v_bytes, v_recent from public.customer_uploads where profile_id = p_profile_id;
  if v_bytes + p_bytes > 104857600 or v_recent >= 20 then raise exception 'upload_quota'; end if;
  insert into public.customer_uploads(object_path, profile_id, kind, bytes, public_url)
    values(p_object_path, p_profile_id, p_kind, p_bytes, p_public_url);
end $$;
revoke all on function public.reserve_customer_upload(uuid, uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_customer_upload(uuid, uuid, text, text, integer, text) to service_role;

commit;
