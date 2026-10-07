-- 0079 — Loyalty discounts are paid by the platform, never by the restaurant.
-- Apply in the Supabase SQL editor. Atomic and safe to run again.
-- Paid, non-cancelled historical redemptions receive their missing credit once.
begin;

create table if not exists public.loyalty_funding (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique references public.orders(id) on delete set null,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  customer_id uuid references public.profiles(id) on delete set null,
  reference text not null,
  points integer not null check (points > 0),
  amount integer not null check (amount > 0),
  paid_amount integer not null check (paid_amount >= 0),
  service_charge integer not null check (service_charge >= 0),
  status text not null default 'credited' check (status in ('credited', 'reversed')),
  credited_at timestamptz not null default now(),
  reversed_at timestamptz,
  check ((status = 'reversed') = (reversed_at is not null))
);
alter table public.loyalty_funding enable row level security;
revoke all on public.loyalty_funding from public, anon, authenticated;
grant all on public.loyalty_funding to service_role;
create index if not exists loyalty_funding_credited_idx on public.loyalty_funding(credited_at desc);
create unique index if not exists loyalty_ledger_one_refund_per_order_idx
  on public.loyalty_ledger(order_id) where kind = 'refund' and order_id is not null;

-- The paid/status transition and the subsidy are one database transaction.
-- Its order key is also the idempotency key for backfill and concurrent retries.
create or replace function public.fund_order_loyalty(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype; v_funding public.loyalty_funding%rowtype; v_claim uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  select * into v_funding from public.loyalty_funding where order_id = p_order_id for update;
  if v_funding.id is not null and (not v_order.is_paid
    or v_order.restaurant_id is distinct from v_funding.restaurant_id
    or v_order.customer_id is distinct from v_funding.customer_id
    or v_order.loyalty_value <> v_funding.amount or v_order.loyalty_points_used <> v_funding.points
    or v_order.total <> v_funding.paid_amount or v_order.service_charge <> v_funding.service_charge) then
    raise exception 'loyalty_funding_snapshot_changed';
  end if;
  if v_order.status = 'cancelled' then
    if v_funding.status = 'credited' then
      perform public.wallet_debit(v_funding.restaurant_id, v_funding.amount, 'adjustment',
        'Order ' || v_funding.reference || ' cancelled — platform loyalty reversed', v_funding.reference);
      update public.loyalty_funding set status = 'reversed', reversed_at = now() where id = v_funding.id;
    end if;
    -- Points return as points. Only the customer's actual cash payment is refunded.
    if v_order.customer_id is not null then
      perform pg_advisory_xact_lock(hashtextextended('checkout-loyalty:' || v_order.customer_id::text, 0));
      insert into public.loyalty_ledger(profile_id, order_id, restaurant_id, points, kind, note)
        select profile_id, order_id, restaurant_id, -sum(points)::integer, 'refund',
          'Commande annulée — points restitués'
        from public.loyalty_ledger where order_id = p_order_id and kind = 'redeem'
        group by profile_id, order_id, restaurant_id having sum(points) < 0
        on conflict (order_id) where kind = 'refund' and order_id is not null do nothing;
    end if;
    return;
  end if;
  if v_funding.id is not null then
    if v_funding.status = 'reversed' or not v_order.is_paid
      or v_order.restaurant_id is distinct from v_funding.restaurant_id
      or v_order.customer_id is distinct from v_funding.customer_id
      or v_order.loyalty_value <> v_funding.amount
      or v_order.loyalty_points_used <> v_funding.points then
      raise exception 'loyalty_funding_snapshot_changed';
    end if;
    return;
  end if;
  if not v_order.is_paid or v_order.loyalty_value <= 0 then return; end if;
  if v_order.payment_method not in ('mobile_money', 'wallet') then raise exception 'loyalty_payment_method_invalid'; end if;
  if v_order.customer_id is null or v_order.loyalty_points_used <= 0
    or v_order.loyalty_value > greatest(v_order.subtotal - v_order.discount_amount, 0)
    or v_order.total <> greatest(v_order.subtotal - v_order.discount_amount, 0) + v_order.service_charge - v_order.loyalty_value
    or coalesce((select -sum(points) from public.loyalty_ledger
      where order_id = p_order_id and profile_id = v_order.customer_id and kind = 'redeem'), 0) <> v_order.loyalty_points_used
    or exists(select 1 from public.loyalty_ledger where order_id = p_order_id and kind = 'refund') then
    raise exception 'loyalty_redemption_invalid';
  end if;
  insert into public.loyalty_funding(order_id, restaurant_id, customer_id, reference, points, amount, paid_amount, service_charge)
    values(p_order_id, v_order.restaurant_id, v_order.customer_id, v_order.reference, v_order.loyalty_points_used, v_order.loyalty_value, v_order.total, v_order.service_charge)
    on conflict(order_id) do nothing returning id into v_claim;
  if v_claim is not null then
    perform public.wallet_credit(v_order.restaurant_id, v_order.loyalty_value, 'payment',
      'Platform loyalty funding for order ' || v_order.reference, v_order.reference);
  end if;
end $$;
revoke all on function public.fund_order_loyalty(uuid) from public, anon, authenticated;
grant execute on function public.fund_order_loyalty(uuid) to service_role;

create or replace function public.orders_loyalty_funding_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.fund_order_loyalty(new.id); return new; end $$;
revoke all on function public.orders_loyalty_funding_trigger() from public, anon, authenticated;
drop trigger if exists orders_loyalty_funding on public.orders;
create trigger orders_loyalty_funding after insert or update of is_paid, status, total, service_charge, loyalty_value, loyalty_points_used, customer_id, restaurant_id
  on public.orders for each row execute function public.orders_loyalty_funding_trigger();

create or replace function public.settle_online_order_payment(p_order_id uuid, p_attempt_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype; v_restaurant_amount integer; v_restaurant_balance integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  -- The attempt that paid this order, asking again: nothing to do, and
  -- nothing to refuse, whatever stage the order has moved on to since.
  if v_order.is_paid and p_attempt_id is not null and v_order.paid_attempt_id = p_attempt_id then
    select balance into v_restaurant_balance from public.restaurant_wallets where restaurant_id = v_order.restaurant_id;
    return jsonb_build_object('alreadySettled', true,
      'restaurantAmount', greatest(v_order.total - v_order.service_charge, 0) + v_order.loyalty_value,
      'restaurantBalance', coalesce(v_restaurant_balance, 0));
  end if;

  if v_order.status <> 'awaiting_customer' then raise exception 'order_not_payable'; end if;
  if v_order.is_paid then
    select balance into v_restaurant_balance from public.restaurant_wallets where restaurant_id = v_order.restaurant_id;
    return jsonb_build_object('alreadySettled', true,
      'restaurantAmount', greatest(v_order.total - v_order.service_charge, 0) + v_order.loyalty_value,
      'restaurantBalance', coalesce(v_restaurant_balance, 0));
  end if;
  v_restaurant_amount := greatest(v_order.total - v_order.service_charge, 0);
  if v_restaurant_amount > 0 then
    perform public.wallet_credit(v_order.restaurant_id, v_restaurant_amount, 'payment',
      'Online order ' || v_order.reference, v_order.reference);
  end if;
  if v_order.service_charge > 0 then
    insert into public.platform_revenue_ledger (source_type, source_id, restaurant_id, gross, amount, reference, note)
    values ('online_payment_fee', v_order.id, v_order.restaurant_id, v_order.total, v_order.service_charge,
      v_order.reference, 'Online payment service fee')
    on conflict (source_type, source_id) do nothing;
  end if;
  update public.orders set is_paid = true,
    paid_attempt_id = p_attempt_id,
    status = case when dining_session_id is null then 'confirmed' else 'delivered' end,
    delivered_at = case when dining_session_id is null then delivered_at else now() end
  where id = v_order.id;
  insert into public.order_status_history (order_id, status, note)
  values (v_order.id, case when v_order.dining_session_id is null then 'confirmed' else 'delivered' end,
    'Online payment confirmed');
  if v_order.dining_session_id is not null then
    update public.dining_sessions set status = 'closed', closed_at = now() where id = v_order.dining_session_id;
    update public.dining_guests set status = 'expired' where session_id = v_order.dining_session_id;
    perform public.dining_release_tables(v_order.dining_session_id);
  end if;
  select balance into v_restaurant_balance from public.restaurant_wallets where restaurant_id = v_order.restaurant_id;
  return jsonb_build_object('alreadySettled', false, 'restaurantAmount', v_restaurant_amount + v_order.loyalty_value,
    'restaurantBalance', coalesce(v_restaurant_balance, 0));
end $$;

revoke all on function public.settle_online_order_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.settle_online_order_payment(uuid, uuid) to service_role;


create or replace function public.cancel_paid_order(
  p_order_id uuid,
  p_actor text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_refund public.refunds%rowtype;
  v_restaurant_amount integer;
  v_phone text;
  v_reference text;
  v_destination text;
  v_status text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  -- Idempotent: a second call returns the refund the first one created.
  select * into v_refund from public.refunds
  where order_id = v_order.id and type = 'refund'
  order by created_at asc limit 1;

  if v_order.status = 'cancelled' then
    return jsonb_build_object(
      'orderId', v_order.id, 'reference', v_order.reference,
      'restaurantId', v_order.restaurant_id, 'customerId', v_order.customer_id,
      'refundId', v_refund.id, 'refundAmount', coalesce(v_refund.amount, 0),
      'refundStatus', v_refund.status, 'phone', v_refund.phone,
      'destination', coalesce(v_refund.raw_response->>'destination', 'mobile_money'),
      'alreadyCancelled', true
    );
  end if;
  if v_order.status = 'delivered' then raise exception 'order_not_cancellable'; end if;
  if not v_order.is_paid or v_order.payment_method not in ('mobile_money', 'wallet') then
    raise exception 'order_not_paid_online';
  end if;

  v_restaurant_amount := greatest(v_order.total - coalesce(v_order.service_charge, 0), 0);
  if v_restaurant_amount > 0 then
    perform public.wallet_debit(
      v_order.restaurant_id, v_restaurant_amount, 'adjustment',
      'Order ' || v_order.reference || ' cancelled — customer refunded',
      v_order.reference
    );
  end if;

  delete from public.platform_revenue_ledger
  where source_type = 'online_payment_fee' and source_id = v_order.id;

  v_reference := 'RF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

  if v_order.payment_method = 'wallet' and v_order.customer_id is not null then
    if v_order.total > 0 then perform public.credit_customer_wallet(
      v_order.customer_id, v_order.total, 'refund',
      'Order refund ' || v_order.reference, v_order.reference
    ); end if;
    v_destination := 'customer_wallet';
    v_status := 'completed';
  else
    select phone into v_phone
    from public.payment_attempts
    where raw_response->>'orderId' = v_order.id::text
      and status = 'succeeded'
    order by created_at desc
    limit 1;
    v_phone := coalesce(v_phone, v_order.delivery_phone);
    v_destination := 'mobile_money';
    v_status := 'pending';
  end if;

  if v_order.total > 0 then
    insert into public.refunds (
      reference, restaurant_id, order_id, type, amount, reason, status,
      completed_at, created_by, phone, raw_response
    ) values (
      v_reference, v_order.restaurant_id, v_order.id, 'refund', v_order.total,
      coalesce(nullif(trim(p_reason), ''), 'Order cancelled'), v_status,
      case when v_status = 'completed' then now() else null end,
      coalesce(p_actor, 'system'), v_phone,
      jsonb_build_object('destination', v_destination, 'restaurantDebit', v_restaurant_amount)
    ) returning * into v_refund;
  end if;

  update public.orders
  set status = 'cancelled',
      cancelled_reason = coalesce(nullif(trim(p_reason), ''), 'Order cancelled'),
      cancelled_at = now()
  where id = v_order.id;

  insert into public.order_status_history (order_id, status, by_name, note)
  values (v_order.id, 'cancelled', coalesce(p_actor, 'system'), p_reason);

  return jsonb_build_object(
    'orderId', v_order.id, 'reference', v_order.reference,
    'restaurantId', v_order.restaurant_id, 'customerId', v_order.customer_id,
    'refundId', v_refund.id, 'refundAmount', coalesce(v_refund.amount, 0),
    'refundStatus', v_refund.status, 'phone', v_phone,
    'destination', v_destination, 'alreadyCancelled', false
  );
end
$$;

revoke all on function public.cancel_paid_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cancel_paid_order(uuid, text, text) to service_role;



-- Hold both the collected sale and its subsidy until delivery. Deposits keep
-- the 0078 promotion-window protection. The same RPC is used by the wallet UI.
create or replace function public.wallet_refund_hold(p_restaurant_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select sum(greatest(0, o.total - coalesce(o.service_charge, 0)) + coalesce(f.amount, 0))
    from public.orders o left join public.loyalty_funding f on f.order_id = o.id and f.status = 'credited'
    where o.restaurant_id = p_restaurant_id and o.is_paid
      and o.payment_method in ('mobile_money', 'wallet') and o.status in ('confirmed', 'preparing', 'shipped')), 0)
    + coalesce((select sum(deposit) from (
      select r.id, max(a.amount) as deposit from public.reservations r
      join public.payment_attempts a on a.reservation_id = r.id and a.status = 'succeeded'
      where r.restaurant_id = p_restaurant_id and r.status in ('confirmed', 'awaiting_payment')
        and r.deposit_paid and r.reserved_for > now() group by r.id
    ) deposits), 0);
$$;

-- Restaurant analytics use the full food value, including platform-funded points.
create or replace function public.manager_sales_summary(
  p_restaurant uuid,
  p_from       timestamptz,
  p_to         timestamptz
)
returns table (
  order_count    bigint,
  revenue        bigint,
  customer_count bigint,
  cancelled      bigint
)
language sql
stable
as $$
  select
    (count(*) filter (where o.status <> 'cancelled'))::bigint,
    (coalesce(sum(greatest(o.subtotal - o.discount_amount, 0)) filter (where o.status <> 'cancelled'), 0))::bigint,
    (count(distinct coalesce(o.customer_id::text, btrim(o.delivery_phone)))
      filter (where o.status <> 'cancelled'))::bigint,
    (count(*) filter (where o.status = 'cancelled'))::bigint
  from public.orders o
  where o.restaurant_id = p_restaurant
    and o.created_at >= p_from
    and o.created_at <  p_to
$$;


-- ── Revenue over time ──
-- One function for day/week/month rather than three, because the caller picks
-- the bucket from the length of the range it asked for.

create or replace function public.manager_sales_series(
  p_restaurant uuid,
  p_from       timestamptz,
  p_to         timestamptz,
  p_bucket     text default 'day'
)
returns table (
  bucket      timestamptz,
  revenue     bigint,
  order_count bigint
)
language sql
stable
as $$
  select
    date_trunc(
      -- Whitelisted, not interpolated. date_trunc takes its unit as text, and
      -- passing the caller's string through unchecked is how a report filter
      -- becomes an error message that names your schema.
      case lower(p_bucket) when 'month' then 'month' when 'week' then 'week' else 'day' end,
      o.created_at at time zone 'Africa/Douala'
    ) at time zone 'Africa/Douala'                       as bucket,
    coalesce(sum(greatest(o.subtotal - o.discount_amount, 0)), 0)::bigint   as revenue,
    count(*)::bigint                                     as order_count
  from public.orders o
  where o.restaurant_id = p_restaurant
    and o.status <> 'cancelled'
    and o.created_at >= p_from
    and o.created_at <  p_to
  group by 1
  order by 1
$$;


-- ── Which days of the week actually sell ──

create or replace function public.manager_sales_by_weekday(
  p_restaurant uuid,
  p_from       timestamptz,
  p_to         timestamptz
)
returns table (
  dow         integer,   -- 0 = Sunday, matching JS getDay()
  revenue     bigint,
  order_count bigint
)
language sql
stable
as $$
  select
    extract(dow from (o.created_at at time zone 'Africa/Douala'))::integer,
    coalesce(sum(greatest(o.subtotal - o.discount_amount, 0)), 0)::bigint,
    count(*)::bigint
  from public.orders o
  where o.restaurant_id = p_restaurant
    and o.status <> 'cancelled'
    and o.created_at >= p_from
    and o.created_at <  p_to
  group by 1
  order by 1
$$;


-- ── When the rush is ──

create or replace function public.manager_peak_hours(
  p_restaurant uuid,
  p_from       timestamptz,
  p_to         timestamptz
)
returns table (
  -- Not named `hour`: an output-parameter name that collides with the field
  -- token in `extract(hour from …)` is the kind of thing that parses on one
  -- Postgres minor version and not the next.
  hour_of_day integer,   -- 0–23, Africa/Douala
  revenue     bigint,
  order_count bigint
)
language sql
stable
as $$
  select
    extract(hour from (o.created_at at time zone 'Africa/Douala'))::integer,
    coalesce(sum(greatest(o.subtotal - o.discount_amount, 0)), 0)::bigint,
    count(*)::bigint
  from public.orders o
  where o.restaurant_id = p_restaurant
    and o.status <> 'cancelled'
    and o.created_at >= p_from
    and o.created_at <  p_to
  group by 1
  order by 1
$$;


-- ── Delivery vs pickup vs dining room ──

create or replace function public.manager_order_mix(
  p_restaurant uuid,
  p_from       timestamptz,
  p_to         timestamptz
)
returns table (
  order_type  text,
  revenue     bigint,
  order_count bigint
)
language sql
stable
as $$
  select
    o.type,
    coalesce(sum(greatest(o.subtotal - o.discount_amount, 0)), 0)::bigint,
    count(*)::bigint
  from public.orders o
  where o.restaurant_id = p_restaurant
    and o.status <> 'cancelled'
    and o.created_at >= p_from
    and o.created_at <  p_to
  group by 1
  order by 3 desc
$$;



revoke all on function public.manager_sales_summary(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.manager_sales_summary(uuid,timestamptz,timestamptz) to service_role;
revoke all on function public.manager_sales_series(uuid,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.manager_sales_series(uuid,timestamptz,timestamptz,text) to service_role;
revoke all on function public.manager_sales_by_weekday(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.manager_sales_by_weekday(uuid,timestamptz,timestamptz) to service_role;
revoke all on function public.manager_peak_hours(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.manager_peak_hours(uuid,timestamptz,timestamptz) to service_role;
revoke all on function public.manager_order_mix(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.manager_order_mix(uuid,timestamptz,timestamptz) to service_role;

-- No 1,000-row API ceiling: all totals are aggregated in one database snapshot.
create or replace function public.admin_loyalty_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with balances as (select profile_id, sum(points) as points from public.loyalty_ledger group by profile_id),
  rate as (select greatest(coalesce((select nullif(value, '')::integer from public.settings where key = 'loyalty_point_value'), 0), 0) as value)
  select jsonb_build_object(
    'pointValue', (select value from rate),
    'outstandingPoints', coalesce((select sum(greatest(points, 0)) from balances), 0),
    'outstandingValue', coalesce((select sum(greatest(points, 0)) from balances), 0) * (select value from rate),
    'customersWithPoints', (select count(*) from balances where points > 0),
    'negativeBalances', (select count(*) from balances where points < 0),
    'pendingRedemptionValue', coalesce((select sum(loyalty_value) from public.orders where not is_paid and status in ('pending', 'awaiting_customer')), 0),
    'fundedValue', coalesce((select sum(amount) from public.loyalty_funding where status = 'credited'), 0),
    'reversedValue', coalesce((select sum(amount) from public.loyalty_funding where status = 'reversed'), 0),
    'restaurantBalances', coalesce((select sum(balance) from public.restaurant_wallets), 0),
    'customerBalances', coalesce((select sum(balance) from public.customer_wallets), 0),
    'pendingRefunds', coalesce((select sum(amount) from public.refunds where status = 'pending'), 0),
    'pendingWithdrawals', coalesce((select sum(amount) from public.withdrawal_requests where status = 'pending'), 0),
    'unconfirmedPayouts', coalesce((select sum(coalesce(net, amount)) from public.withdrawal_requests where status = 'paid' and decided_at is null), 0)
  );
$$;
revoke all on function public.admin_loyalty_summary() from public, anon, authenticated;
grant execute on function public.admin_loyalty_summary() to service_role;

-- Repair the exact missing subsidy on historical paid orders. Cancelled
-- orders are excluded: their collected sale was already clawed back.
do $$ declare v_id uuid; begin
  for v_id in select id from public.orders where is_paid and status <> 'cancelled' and loyalty_value > 0 order by restaurant_id, id
  loop perform public.fund_order_loyalty(v_id); end loop;
end $$;
create or replace function public.security_invariants_version()
returns integer language sql stable security definer set search_path = public as $$ select 79; $$;
revoke all on function public.security_invariants_version() from public, anon, authenticated;
grant execute on function public.security_invariants_version() to service_role;
notify pgrst, 'reload schema';
commit;
