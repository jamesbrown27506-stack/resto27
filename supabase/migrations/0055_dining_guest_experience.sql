-- 0055 — Per-dish table decisions, guest checkout and anonymous table alerts.
-- Apply after 0054. All new writes remain service-role only.
alter table public.dining_guests add column if not exists locale text not null default 'fr' check (locale in ('fr','en'));

alter table public.dining_round_items
  add column if not exists status text not null default 'pending'
    check (status in ('pending','accepted','rejected')),
  add column if not exists rejection_reason text
    check (rejection_reason is null or length(rejection_reason) between 5 and 240),
  add column if not exists decided_by uuid references public.profiles(id) on delete set null,
  add column if not exists decided_at timestamptz;

update public.dining_round_items i set status=r.status, decided_by=r.decided_by, decided_at=r.decided_at
from public.dining_rounds r where r.id=i.round_id and r.status in ('accepted','rejected') and i.status='pending';

create table if not exists public.dining_guest_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.dining_guests(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dining_guest_push_guest_idx on public.dining_guest_push_subscriptions(guest_id);
alter table public.dining_guest_push_subscriptions enable row level security;
revoke all on public.dining_guest_push_subscriptions from public, anon, authenticated;

-- One transaction makes the menu decision, stock movement, bill and kitchen
-- order agree. Refusing one dish never charges for it or changes accepted dishes.
create or replace function public.decide_dining_item(
  p_item_id uuid, p_staff_id uuid, p_approve boolean, p_reason text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_item public.dining_round_items%rowtype;
  v_round public.dining_rounds%rowtype;
  v_session public.dining_sessions%rowtype;
  v_table public.restaurant_tables%rowtype;
  v_order public.orders%rowtype;
  v_menu public.menu_items%rowtype;
  v_reference text;
  v_line_total integer;
  v_reason text;
begin
  select * into v_item from public.dining_round_items where id=p_item_id and status='pending' for update;
  if not found then raise exception 'item_not_pending'; end if;
  select * into v_round from public.dining_rounds where id=v_item.round_id for update;
  select * into v_session from public.dining_sessions where id=v_round.session_id and status='open' for update;
  if not found then raise exception 'session_not_open'; end if;
  if not exists (
    select 1 from public.restaurant_staff where restaurant_id=v_session.restaurant_id
    and profile_id=p_staff_id and status='active'
    and role in ('owner','manager','cashier','waiter','kitchen')
  ) then raise exception 'staff_forbidden'; end if;

  v_line_total := v_item.unit_price*v_item.quantity;
  if p_approve then
    if v_item.menu_item_id is not null then
      select * into v_menu from public.menu_items where id=v_item.menu_item_id for update;
      if v_menu.track_stock and coalesce(v_menu.stock_quantity,0)<v_item.quantity then
        raise exception 'insufficient_stock:%',v_item.name;
      end if;
      if v_menu.track_stock then
        update public.menu_items set stock_quantity=stock_quantity-v_item.quantity where id=v_menu.id;
      end if;
    end if;
    select * into v_table from public.restaurant_tables where id=v_session.table_id;
    if v_session.order_id is null then
      v_reference := 'CMD-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
      insert into public.orders(reference,restaurant_id,type,status,subtotal,service_charge_percent,
        service_charge,total,table_number,payment_method,dining_session_id)
      values(v_reference,v_session.restaurant_id,'dine_in','confirmed',v_line_total,0,
        0,v_line_total,v_table.number,'pay_at_restaurant',v_session.id)
      returning * into v_order;
      update public.dining_sessions set order_id=v_order.id where id=v_session.id;
      insert into public.order_status_history(order_id,status,by_name,note)
        values(v_order.id,'confirmed','Dining room','Table '||v_table.number||' guest dish accepted');
    else
      select * into v_order from public.orders where id=v_session.order_id for update;
      if v_order.status in ('awaiting_customer','delivered','cancelled') then raise exception 'order_not_open'; end if;
      update public.orders set subtotal=subtotal+v_line_total,total=total+v_line_total
        where id=v_order.id returning * into v_order;
      insert into public.order_status_history(order_id,status,by_name,note)
        values(v_order.id,v_order.status,'Dining room','Additional guest dish accepted');
    end if;
    insert into public.order_items(order_id,menu_item_id,name,unit_price,quantity,options_label)
      values(v_order.id,v_item.menu_item_id,v_item.name,v_item.unit_price,v_item.quantity,v_item.options_label);
    update public.restaurant_tables set status='occupied'
      where id=v_session.table_id and status in ('available','reserved');
    update public.dining_round_items set status='accepted',decided_by=p_staff_id,decided_at=now()
      where id=v_item.id;
  else
    v_reason := nullif(trim(coalesce(p_reason,'')),'');
    if v_reason is null or length(v_reason)<5 or length(v_reason)>240 then
      raise exception 'reason_required'; end if;
    update public.dining_round_items set status='rejected',rejection_reason=v_reason,
      decided_by=p_staff_id,decided_at=now() where id=v_item.id;
  end if;

  if not exists(select 1 from public.dining_round_items where round_id=v_round.id and status='pending') then
    update public.dining_rounds set
      status=case when exists(select 1 from public.dining_round_items
        where round_id=v_round.id and status='accepted') then 'accepted' else 'rejected' end,
      decided_by=p_staff_id,decided_at=now()
    where id=v_round.id;
  end if;
  return jsonb_build_object('guestId',v_round.guest_id,'sessionId',v_session.id,
    'orderId',v_order.id,'reference',v_order.reference,'itemName',v_item.name,
    'quantity',v_item.quantity,'amount',v_line_total,'approved',p_approve,
    'reason',v_reason);
end $$;
revoke all on function public.decide_dining_item(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.decide_dining_item(uuid,uuid,boolean,text) to service_role;

-- A guest may choose online payment without asking staff to launch a charge.
-- The server reads the configured fee and locks the bill before changing state.
create or replace function public.guest_request_dining_payment(p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_guest public.dining_guests%rowtype; v_session public.dining_sessions%rowtype;
  v_order public.orders%rowtype; v_percent numeric; v_fee integer;
begin
  select * into v_guest from public.dining_guests
    where token_hash=p_token_hash and status='approved' for update;
  if not found then raise exception 'guest_not_approved'; end if;
  select * into v_session from public.dining_sessions
    where id=v_guest.session_id and status in ('open','payment_requested') for update;
  if not found or v_session.order_id is null then raise exception 'session_not_payable'; end if;
  select * into v_order from public.orders where id=v_session.order_id for update;
  if v_order.is_paid then raise exception 'order_already_paid'; end if;
  if v_session.status='payment_requested' then
    return jsonb_build_object('orderId',v_order.id,'total',v_order.total,'serviceCharge',v_order.service_charge);
  end if;
  if v_order.status not in ('confirmed','preparing','shipped') then raise exception 'order_not_payable'; end if;
  if exists(select 1 from public.dining_round_items i join public.dining_rounds r on r.id=i.round_id
    where r.session_id=v_session.id and i.status='pending') then raise exception 'items_pending'; end if;
  select coalesce(value::numeric,0) into v_percent from public.settings where key='service_charge_percent';
  v_percent := greatest(coalesce(v_percent,0),0);
  v_fee := round(v_order.subtotal*v_percent/100.0);
  update public.orders set payment_method='mobile_money',service_charge_percent=v_percent,
    service_charge=v_fee,total=subtotal+v_fee,status='awaiting_customer',payment_requested_at=now()
    where id=v_order.id returning * into v_order;
  update public.dining_sessions set status='payment_requested',payment_requested_at=now()
    where id=v_session.id;
  insert into public.order_status_history(order_id,status,by_name,note)
    values(v_order.id,'awaiting_customer','Dining room','Guest chose online payment at table');
  return jsonb_build_object('orderId',v_order.id,'total',v_order.total,'serviceCharge',v_fee);
end $$;
revoke all on function public.guest_request_dining_payment(text) from public,anon,authenticated;
grant execute on function public.guest_request_dining_payment(text) to service_role;

-- Every path that moves a table to online checkout must resolve all dishes.
-- This protects the existing staff RPC as well as guest-initiated checkout.
create or replace function public.dining_payment_requires_decided_items()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='payment_requested' and old.status='open'
    and exists (
      select 1 from public.dining_round_items i
      join public.dining_rounds r on r.id=i.round_id
      where r.session_id=new.id and i.status='pending'
    ) then
    raise exception 'items_pending';
  end if;
  return new;
end $$;
drop trigger if exists dining_payment_requires_decided_items on public.dining_sessions;
create trigger dining_payment_requires_decided_items
  before update of status on public.dining_sessions
  for each row execute function public.dining_payment_requires_decided_items();


-- Keep the currently deployed whole-request action safe during rollout.
-- New per-item actions have no pending items when the round status changes.
create or replace function public.sync_legacy_dining_round_decision()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.status='pending' and new.status in ('accepted','rejected') then
    update public.dining_round_items
      set status=new.status, decided_by=new.decided_by, decided_at=coalesce(new.decided_at,now())
    where round_id=new.id and status='pending';
  end if;
  return new;
end $$;
drop trigger if exists sync_legacy_dining_round_decision on public.dining_rounds;
create trigger sync_legacy_dining_round_decision
  after update of status on public.dining_rounds
  for each row execute function public.sync_legacy_dining_round_decision();
