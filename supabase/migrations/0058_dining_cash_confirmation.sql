-- Require a fresh, explicit whole-table receipt before recording on-site cash.
create or replace function public.close_dining_cash_confirmed(
  p_session_id uuid, p_staff_id uuid, p_order_id uuid, p_amount integer,
  p_item_ids uuid[], p_guest_ids uuid[], p_confirm_all boolean
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_session public.dining_sessions%rowtype;
  v_order public.orders%rowtype;
  v_item_ids uuid[];
  v_guest_ids uuid[];
  v_cash_total integer;
begin
  if p_confirm_all is distinct from true then raise exception 'confirmation_required'; end if;
  select * into v_session from public.dining_sessions where id=p_session_id and status in ('open','payment_requested') for update;
  if not found or v_session.order_id is null or v_session.order_id is distinct from p_order_id then raise exception 'session_changed'; end if;
  if not exists(select 1 from public.restaurant_staff where restaurant_id=v_session.restaurant_id and profile_id=p_staff_id and status='active' and role in ('owner','manager','cashier')) then raise exception 'staff_forbidden'; end if;
  select * into v_order from public.orders where id=v_session.order_id for update;
  if v_order.is_paid then raise exception 'already_paid'; end if;
  if exists(select 1 from public.dining_round_items i join public.dining_rounds r on r.id=i.round_id where r.session_id=v_session.id and i.status='pending') then raise exception 'undecided_dishes'; end if;
  if exists(select 1 from public.dining_guests where session_id=v_session.id and status='pending') then raise exception 'pending_guests'; end if;
  if exists(select 1 from public.payment_attempts where raw_response->>'orderId'=v_order.id::text and status in ('pending','succeeded') and settled_at is null) then raise exception 'payment_in_flight'; end if;
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_item_ids from public.order_items where order_id=v_order.id;
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_guest_ids from public.dining_guests where session_id=v_session.id and status='approved';
  v_cash_total := v_order.total - coalesce(v_order.service_charge,0);
  if v_cash_total <= 0 or v_item_ids = array[]::uuid[] or v_guest_ids = array[]::uuid[] then raise exception 'empty_bill'; end if;
  if p_amount is distinct from v_cash_total or
     (select coalesce(array_agg(id order by id),array[]::uuid[]) from unnest(coalesce(p_item_ids,array[]::uuid[])) id) is distinct from v_item_ids or
     (select coalesce(array_agg(id order by id),array[]::uuid[]) from unnest(coalesce(p_guest_ids,array[]::uuid[])) id) is distinct from v_guest_ids
  then raise exception 'bill_changed'; end if;
  update public.orders set is_paid=true,payment_method='pay_at_restaurant',status='delivered',delivered_at=now(),service_charge=0,service_charge_percent=0,total=v_cash_total where id=v_order.id;
  insert into public.order_payments(order_id,amount,method,collected_by,collected_at) values(v_order.id,v_cash_total,'cash','restaurant',now());
  insert into public.order_status_history(order_id,status,by_name,note) values(v_order.id,'delivered','Dining room','Whole-table cash payment confirmed');
  update public.dining_sessions set status='closed',closed_at=now() where id=v_session.id;
  update public.dining_guests set status='expired' where session_id=v_session.id;
  update public.restaurant_tables set status='available' where id=v_session.table_id and status='occupied';
  return v_order.id;
end $$;
revoke all on function public.close_dining_cash(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.close_dining_cash_confirmed(uuid,uuid,uuid,integer,uuid[],uuid[],boolean) from public,anon,authenticated;
grant execute on function public.close_dining_cash_confirmed(uuid,uuid,uuid,integer,uuid[],uuid[],boolean) to service_role;
