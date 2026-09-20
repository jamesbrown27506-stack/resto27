-- 0054 — Enterprise QR table service
-- Anonymous diners receive a short-lived, revocable guest token. The printed
-- QR identifies a table; staff approval is what proves the guest is present.

alter table public.restaurant_tables
  add column if not exists public_token uuid not null default gen_random_uuid();
create unique index if not exists restaurant_tables_public_token_idx
  on public.restaurant_tables(public_token);

create table if not exists public.dining_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  status text not null default 'awaiting_staff'
    check (status in ('awaiting_staff','open','payment_requested','closed','cancelled')),
  order_id uuid references public.orders(id) on delete set null,
  opened_by uuid references public.profiles(id) on delete set null,
  opened_at timestamptz,
  payment_requested_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists dining_sessions_active_table_idx
  on public.dining_sessions(table_id)
  where status in ('awaiting_staff','open','payment_requested');
create index if not exists dining_sessions_restaurant_idx
  on public.dining_sessions(restaurant_id, created_at desc);

create table if not exists public.dining_guests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.dining_sessions(id) on delete cascade,
  token_hash text not null unique,
  display_name text not null default 'Guest' check (length(display_name) between 1 and 60),
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists dining_guests_session_idx on public.dining_guests(session_id, created_at);

create table if not exists public.dining_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.dining_sessions(id) on delete cascade,
  guest_id uuid not null references public.dining_guests(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  notes text,
  subtotal integer not null default 0 check (subtotal >= 0),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists dining_rounds_session_idx on public.dining_rounds(session_id, created_at);

create table if not exists public.dining_round_items (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.dining_rounds(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name text not null,
  unit_price integer not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 50),
  options_label text,
  created_at timestamptz not null default now()
);

create table if not exists public.dining_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.dining_sessions(id) on delete cascade,
  guest_id uuid references public.dining_guests(id) on delete set null,
  sender_kind text not null check (sender_kind in ('guest','staff','system')),
  sender_staff_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'message'
    check (kind in ('message','call_waiter','water','cutlery','bill','missing_item','allergy','help')),
  body text not null check (length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists dining_messages_session_idx on public.dining_messages(session_id, created_at);

alter table public.orders
  add column if not exists dining_session_id uuid references public.dining_sessions(id) on delete set null,
  add column if not exists payment_requested_at timestamptz;
create unique index if not exists orders_dining_session_idx
  on public.orders(dining_session_id) where dining_session_id is not null;

alter table public.dining_sessions enable row level security;
alter table public.dining_guests enable row level security;
alter table public.dining_rounds enable row level security;
alter table public.dining_round_items enable row level security;
alter table public.dining_messages enable row level security;

drop trigger if exists set_updated_at on public.dining_sessions;
create trigger set_updated_at before update on public.dining_sessions
  for each row execute function public.set_updated_at();

-- The only anonymous database entry point. It returns opaque ids, never
-- operational table/session data. All later reads pass through server actions.
create or replace function public.request_dining_access(
  p_table_token uuid, p_token_hash text, p_display_name text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_table public.restaurant_tables%rowtype; v_session public.dining_sessions%rowtype; v_guest uuid;
begin
  select t.* into v_table from public.restaurant_tables t
  join public.restaurants r on r.id=t.restaurant_id and r.status='active'
  where t.public_token=p_table_token and t.status <> 'out_of_service';
  if not found then raise exception 'table_unavailable'; end if;
  if not exists (
    select 1 from public.subscription_state s join public.subscription_plans p on p.id=s.plan_id
    where s.restaurant_id=v_table.restaurant_id and s.state in ('active','grace') and p.tier='enterprise'
  ) then raise exception 'feature_unavailable'; end if;
  select * into v_session from public.dining_sessions
    where table_id=v_table.id and status in ('awaiting_staff','open','payment_requested')
    order by created_at desc limit 1;
  if not found then
    begin
      insert into public.dining_sessions(restaurant_id,table_id) values(v_table.restaurant_id,v_table.id)
      returning * into v_session;
    exception when unique_violation then
      select * into v_session from public.dining_sessions
       where table_id=v_table.id and status in ('awaiting_staff','open','payment_requested') limit 1;
    end;
  end if;
  insert into public.dining_guests(session_id,token_hash,display_name)
    values(v_session.id,p_token_hash,left(coalesce(nullif(trim(p_display_name),''),'Guest'),60)) returning id into v_guest;
  insert into public.dining_messages(session_id,guest_id,sender_kind,kind,body)
    values(v_session.id,v_guest,'system','message','Guest access requested');
  return jsonb_build_object('guestId',v_guest,'sessionId',v_session.id,'status','pending');
end $$;
revoke all on function public.request_dining_access(uuid,text,text) from public;
grant execute on function public.request_dining_access(uuid,text,text) to service_role;

-- Reprice and snapshot a guest round atomically. It remains outside the
-- kitchen order until a staff member accepts it.
create or replace function public.submit_dining_round(
  p_token_hash text, p_lines jsonb, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_guest public.dining_guests%rowtype; v_session public.dining_sessions%rowtype;
  v_round uuid; v_line jsonb; v_item public.menu_items%rowtype; v_qty integer;
  v_unit integer; v_labels text; v_subtotal integer := 0;
begin
  select * into v_guest from public.dining_guests where token_hash=p_token_hash and status='approved' for update;
  if not found then raise exception 'guest_not_approved'; end if;
  select * into v_session from public.dining_sessions where id=v_guest.session_id and status='open' for update;
  if not found then raise exception 'session_not_open'; end if;
  if jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 40 then raise exception 'invalid_lines'; end if;
  insert into public.dining_rounds(session_id,guest_id,notes) values(v_session.id,v_guest.id,left(nullif(trim(p_notes),''),500)) returning id into v_round;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::integer;
    if v_qty < 1 or v_qty > 50 then raise exception 'invalid_quantity'; end if;
    select * into v_item from public.menu_items where id=(v_line->>'menuItemId')::uuid
      and restaurant_id=v_session.restaurant_id and is_available for share;
    if not found then raise exception 'item_unavailable'; end if;
    v_unit := v_item.price; v_labels := null;
    if jsonb_array_length(coalesce(v_line->'optionIds','[]'::jsonb)) > 0 then
      select v_item.price + coalesce(sum(o.price_delta),0), string_agg(o.name,' · ' order by o.sort_order)
      into v_unit,v_labels from public.menu_options o join public.menu_option_groups g on g.id=o.group_id
      where g.menu_item_id=v_item.id and o.is_available
        and o.id in (select value::text::uuid from jsonb_array_elements_text(v_line->'optionIds'));
    end if;
    if v_unit < 0 then raise exception 'invalid_price'; end if;
    insert into public.dining_round_items(round_id,menu_item_id,name,unit_price,quantity,options_label)
      values(v_round,v_item.id,v_item.name,v_unit,v_qty,v_labels);
    v_subtotal := v_subtotal + v_unit*v_qty;
  end loop;
  update public.dining_rounds set subtotal=v_subtotal where id=v_round;
  update public.dining_guests set last_seen_at=now() where id=v_guest.id;
  return v_round;
end $$;
revoke all on function public.submit_dining_round(text,jsonb,text) from public, anon, authenticated;
grant execute on function public.submit_dining_round(text,jsonb,text) to service_role;

-- Payment settlement closes an enterprise dine-in visit instead of moving it
-- back to the kitchen's confirmed state.
create or replace function public.settle_online_order_payment(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order public.orders%rowtype; v_restaurant_amount integer; v_restaurant_balance integer; v_table_id uuid;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.status <> 'awaiting_customer' then raise exception 'order_not_payable'; end if;
  if v_order.is_paid then select balance into v_restaurant_balance from public.restaurant_wallets where restaurant_id=v_order.restaurant_id;
    return jsonb_build_object('alreadySettled',true,'restaurantAmount',greatest(v_order.total-v_order.service_charge,0),'restaurantBalance',coalesce(v_restaurant_balance,0)); end if;
  v_restaurant_amount := greatest(v_order.total-v_order.service_charge,0);
  perform public.wallet_credit(v_order.restaurant_id,v_restaurant_amount,'payment','Online order '||v_order.reference,v_order.reference);
  if v_order.service_charge>0 then insert into public.platform_revenue_ledger(source_type,source_id,restaurant_id,gross,amount,reference,note)
    values('online_payment_fee',v_order.id,v_order.restaurant_id,v_order.total,v_order.service_charge,v_order.reference,'Online payment service fee') on conflict(source_type,source_id) do nothing; end if;
  update public.orders set is_paid=true,status=case when dining_session_id is null then 'confirmed' else 'delivered' end,
    delivered_at=case when dining_session_id is null then delivered_at else now() end where id=v_order.id;
  insert into public.order_status_history(order_id,status,note) values(v_order.id,case when v_order.dining_session_id is null then 'confirmed' else 'delivered' end,'Online payment confirmed');
  if v_order.dining_session_id is not null then
    update public.dining_sessions set status='closed',closed_at=now() where id=v_order.dining_session_id returning table_id into v_table_id;
    update public.dining_guests set status='expired' where session_id=v_order.dining_session_id;
    update public.restaurant_tables set status='available' where id=v_table_id and status='occupied';
  end if;
  select balance into v_restaurant_balance from public.restaurant_wallets where restaurant_id=v_order.restaurant_id;
  return jsonb_build_object('alreadySettled',false,'restaurantAmount',v_restaurant_amount,'restaurantBalance',coalesce(v_restaurant_balance,0));
end $$;
revoke all on function public.settle_online_order_payment(uuid) from public,anon,authenticated;
grant execute on function public.settle_online_order_payment(uuid) to service_role;

create or replace function public.accept_dining_round(p_round_id uuid, p_staff_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_round public.dining_rounds%rowtype; v_session public.dining_sessions%rowtype;
  v_table public.restaurant_tables%rowtype; v_order public.orders%rowtype; v_reference text; v_stock record;
begin
  select * into v_round from public.dining_rounds where id=p_round_id and status='pending' for update;
  if not found then raise exception 'round_not_pending'; end if;
  select * into v_session from public.dining_sessions where id=v_round.session_id and status='open' for update;
  if not found then raise exception 'session_not_open'; end if;
  for v_stock in select i.id,i.name,i.track_stock,i.stock_quantity,ri.quantity from public.dining_round_items ri join public.menu_items i on i.id=ri.menu_item_id where ri.round_id=v_round.id for update of i loop
    if v_stock.track_stock and coalesce(v_stock.stock_quantity,0)<v_stock.quantity then raise exception 'insufficient_stock:%',v_stock.name; end if;
    if v_stock.track_stock then update public.menu_items set stock_quantity=stock_quantity-v_stock.quantity where id=v_stock.id; end if;
  end loop;
  if not exists(select 1 from public.restaurant_staff where restaurant_id=v_session.restaurant_id and profile_id=p_staff_id and status='active' and role in ('owner','manager','cashier','waiter')) then raise exception 'staff_forbidden'; end if;
  select * into v_table from public.restaurant_tables where id=v_session.table_id;
  if v_session.order_id is null then
    v_reference := 'CMD-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
    insert into public.orders(reference,restaurant_id,type,status,subtotal,service_charge_percent,service_charge,total,table_number,payment_method,dining_session_id)
      values(v_reference,v_session.restaurant_id,'dine_in','confirmed',v_round.subtotal,0,0,v_round.subtotal,v_table.number,'pay_at_restaurant',v_session.id)
      returning * into v_order;
    update public.dining_sessions set order_id=v_order.id where id=v_session.id;
    insert into public.order_status_history(order_id,status,by_name,note) values(v_order.id,'confirmed','Dining room','Table '||v_table.number||' guest order accepted');
  else
    select * into v_order from public.orders where id=v_session.order_id for update;
    if v_order.status in ('awaiting_customer','delivered','cancelled') then raise exception 'order_not_open'; end if;
    update public.orders set subtotal=subtotal+v_round.subtotal,total=total+v_round.subtotal where id=v_order.id returning * into v_order;
    insert into public.order_status_history(order_id,status,by_name,note) values(v_order.id,v_order.status,'Dining room','Additional guest round accepted');
  end if;
  insert into public.order_items(order_id,menu_item_id,name,unit_price,quantity,options_label)
    select v_order.id,menu_item_id,name,unit_price,quantity,options_label from public.dining_round_items where round_id=v_round.id;
  update public.dining_rounds set status='accepted',decided_by=p_staff_id,decided_at=now() where id=v_round.id;
  update public.restaurant_tables set status='occupied' where id=v_session.table_id and status in ('available','reserved');
  return jsonb_build_object('orderId',v_order.id,'reference',v_order.reference,'total',v_order.total);
end $$;
revoke all on function public.accept_dining_round(uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_dining_round(uuid,uuid) to service_role;

-- Staff approval is one transaction: a guest cannot be approved while the
-- visit or physical table remains in a contradictory state.
create or replace function public.decide_dining_guest(
  p_guest_id uuid, p_staff_id uuid, p_approve boolean
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_guest public.dining_guests%rowtype; v_session public.dining_sessions%rowtype;
begin
  select * into v_guest from public.dining_guests
    where id=p_guest_id and status='pending' for update;
  if not found then raise exception 'guest_not_pending'; end if;
  select * into v_session from public.dining_sessions
    where id=v_guest.session_id and status in ('awaiting_staff','open') for update;
  if not found then raise exception 'session_not_open'; end if;
  if not exists (
    select 1 from public.restaurant_staff
    where restaurant_id=v_session.restaurant_id and profile_id=p_staff_id
      and status='active' and role in ('owner','manager','kitchen','cashier','waiter')
  ) then raise exception 'staff_forbidden'; end if;

  update public.dining_guests set
    status=case when p_approve then 'approved' else 'rejected' end,
    approved_by=case when p_approve then p_staff_id else null end,
    approved_at=case when p_approve then now() else null end
  where id=v_guest.id;

  if p_approve then
    update public.dining_sessions set status='open',opened_by=coalesce(opened_by,p_staff_id),
      opened_at=coalesce(opened_at,now()) where id=v_session.id;
    update public.restaurant_tables set status='occupied'
      where id=v_session.table_id and status in ('available','reserved');
  elsif not exists (
    select 1 from public.dining_guests where session_id=v_session.id and status in ('pending','approved')
  ) and v_session.status='awaiting_staff' then
    update public.dining_sessions set status='cancelled',closed_at=now() where id=v_session.id;
  end if;
  return v_session.id;
end $$;
revoke all on function public.decide_dining_guest(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.decide_dining_guest(uuid,uuid,boolean) to service_role;

-- The service fee, order state and session state change together. If any
-- check or write fails, PostgreSQL rolls the entire payment request back.
create or replace function public.request_dining_payment(
  p_session_id uuid, p_staff_id uuid, p_service_charge_percent numeric
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_session public.dining_sessions%rowtype; v_order public.orders%rowtype;
  v_percent numeric; v_fee integer;
begin
  select * into v_session from public.dining_sessions
    where id=p_session_id and status='open' for update;
  if not found or v_session.order_id is null then raise exception 'session_not_payable'; end if;
  if not exists (
    select 1 from public.restaurant_staff
    where restaurant_id=v_session.restaurant_id and profile_id=p_staff_id
      and status='active' and role in ('owner','manager')
  ) then raise exception 'staff_forbidden'; end if;
  select * into v_order from public.orders where id=v_session.order_id for update;
  if v_order.is_paid then raise exception 'order_already_paid'; end if;
  if v_order.status not in ('confirmed','preparing','shipped') then raise exception 'order_not_payable'; end if;

  v_percent := greatest(coalesce(p_service_charge_percent,0),0);
  v_fee := round(v_order.subtotal*v_percent/100.0);
  update public.orders set payment_method='mobile_money',service_charge_percent=v_percent,
    service_charge=v_fee,total=subtotal+v_fee,status='awaiting_customer',payment_requested_at=now()
    where id=v_order.id returning * into v_order;
  update public.dining_sessions set status='payment_requested',payment_requested_at=now()
    where id=v_session.id;
  insert into public.order_status_history(order_id,status,by_name,note)
    values(v_order.id,'awaiting_customer','Dining room','Mobile Money payment requested at table');
  return jsonb_build_object('orderId',v_order.id,'total',v_order.total,'serviceCharge',v_fee);
end $$;
revoke all on function public.request_dining_payment(uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.request_dining_payment(uuid,uuid,numeric) to service_role;
create or replace function public.close_dining_cash(p_session_id uuid, p_staff_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_session public.dining_sessions%rowtype; v_order public.orders%rowtype;
begin
  select * into v_session from public.dining_sessions where id=p_session_id and status in ('open','payment_requested') for update;
  if not found or v_session.order_id is null then raise exception 'session_not_payable'; end if;
  if not exists(select 1 from public.restaurant_staff where restaurant_id=v_session.restaurant_id and profile_id=p_staff_id and status='active' and role in ('owner','manager','cashier')) then raise exception 'staff_forbidden'; end if;
  select * into v_order from public.orders where id=v_session.order_id for update;
  if v_order.is_paid then return v_order.id; end if;
  if exists(select 1 from public.payment_attempts where raw_response->>'orderId'=v_order.id::text and status in ('pending','succeeded') and settled_at is null) then raise exception 'payment_in_flight'; end if;
  update public.orders set is_paid=true,payment_method='pay_at_restaurant',status='delivered',delivered_at=now() where id=v_order.id;
  insert into public.order_payments(order_id,amount,method,collected_by,collected_at) values(v_order.id,v_order.total,'cash','restaurant',now());
  insert into public.order_status_history(order_id,status,by_name,note) values(v_order.id,'delivered','Dining room','Cash payment recorded');
  update public.dining_sessions set status='closed',closed_at=now() where id=v_session.id;
  update public.dining_guests set status='expired' where session_id=v_session.id;
  update public.restaurant_tables set status='available' where id=v_session.table_id and status='occupied';
  return v_order.id;
end $$;
revoke all on function public.close_dining_cash(uuid,uuid) from public,anon,authenticated;
grant execute on function public.close_dining_cash(uuid,uuid) to service_role;



alter table public.orders add column if not exists payment_started_at timestamptz;
create or replace function public.claim_dining_payment(p_order_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_claimed uuid;
begin
  update public.orders o set payment_started_at=now()
  where o.id=p_order_id and o.status='awaiting_customer' and not o.is_paid
    and (o.payment_started_at is null or o.payment_started_at < now()-interval '5 minutes')
    and exists(select 1 from public.dining_sessions s where s.order_id=o.id and s.status='payment_requested')
  returning o.id into v_claimed;
  return v_claimed is not null;
end $$;
revoke all on function public.claim_dining_payment(uuid) from public,anon,authenticated;
grant execute on function public.claim_dining_payment(uuid) to service_role;
