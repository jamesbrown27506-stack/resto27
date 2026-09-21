-- Prevent a QR visitor joining a table whose bill is already being settled.
-- Existing pending requests on such a session can still be declined by staff.
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
  if v_session.status='payment_requested' then raise exception 'table_payment_in_progress'; end if;
  insert into public.dining_guests(session_id,token_hash,display_name)
    values(v_session.id,p_token_hash,left(coalesce(nullif(trim(p_display_name),''),'Guest'),60)) returning id into v_guest;
  insert into public.dining_messages(session_id,guest_id,sender_kind,kind,body)
    values(v_session.id,v_guest,'system','message','Guest access requested');
  return jsonb_build_object('guestId',v_guest,'sessionId',v_session.id,'status','pending');
end $$;

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
    where id=v_guest.session_id and status in ('awaiting_staff','open','payment_requested') for update;
  if not found then raise exception 'session_not_open'; end if;
  if p_approve and v_session.status='payment_requested' then raise exception 'table_payment_in_progress'; end if;
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
