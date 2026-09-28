-- 0069 — customizable dishes: "prix confirmé par le restaurant"
--
-- ─────────────────────────────────────────────────────────────────────────
--  Many Cameroonian dishes are put together to order — BHB with or without
--  bouillie, eru with fufu or garri, an extra piece of meat — and a price
--  per option is too much setup for a restaurant with twenty such dishes.
--
--  So a dish can be marked `price_to_confirm`: its `price` becomes the
--  MINIMUM, `price_max` the ceiling, and the customer says what they want in
--  the line's note. The restaurant sets the real price when it ACCEPTS the
--  order — which is before anyone pays (payment-first, 0059) — within that
--  range, the same way the delivery fee ceiling is enforced. The customer
--  sees the confirmed total and pays, or lets the order lapse.
--
--  At the table (Enterprise QR), the waiter sets the price when accepting
--  the dish; a waiter entering the order sets it on the line.
--
--  order_items keeps the range it was sold under (price_min / price_max) and
--  when the price was confirmed — snapshots, like every other order column.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.menu_items
  add column if not exists price_to_confirm boolean not null default false,
  add column if not exists price_max integer;
alter table public.menu_items drop constraint if exists menu_items_price_max_check;
alter table public.menu_items add constraint menu_items_price_max_check
  check (price_max is null or price_max >= price);

alter table public.order_items
  add column if not exists price_to_confirm boolean not null default false,
  add column if not exists price_min integer,
  add column if not exists price_max integer,
  add column if not exists price_confirmed_at timestamptz;

alter table public.dining_round_items
  add column if not exists price_to_confirm boolean not null default false,
  add column if not exists price_max integer;

-- ── Guest round: snapshot the range ──────────────────────────────────────
create or replace function public.submit_dining_round(
  p_token_hash text, p_lines jsonb, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_guest public.dining_guests%rowtype; v_session public.dining_sessions%rowtype;
  v_round uuid; v_line jsonb; v_item public.menu_items%rowtype; v_qty integer;
  v_unit integer; v_labels text; v_subtotal integer := 0;
begin
  select * into v_guest from public.dining_guests
  where token_hash = p_token_hash and status in ('pending','approved') for update;
  if not found then raise exception 'guest_not_approved'; end if;
  select * into v_session from public.dining_sessions
  where id = v_guest.session_id and status in ('awaiting_staff','open') for update;
  if not found then raise exception 'session_not_open'; end if;
  if jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 40 then raise exception 'invalid_lines'; end if;
  insert into public.dining_rounds (session_id, guest_id, notes)
  values (v_session.id, v_guest.id, left(nullif(trim(p_notes), ''), 500)) returning id into v_round;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::integer;
    if v_qty < 1 or v_qty > 50 then raise exception 'invalid_quantity'; end if;
    select * into v_item from public.menu_items where id = (v_line->>'menuItemId')::uuid
      and restaurant_id = v_session.restaurant_id and is_available for share;
    if not found then raise exception 'item_unavailable'; end if;
    v_unit := v_item.price; v_labels := null;
    if jsonb_array_length(coalesce(v_line->'optionIds', '[]'::jsonb)) > 0 then
      select v_item.price + coalesce(sum(o.price_delta), 0), string_agg(o.name, ' · ' order by o.sort_order)
      into v_unit, v_labels from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
      where g.menu_item_id = v_item.id and o.is_available
        and o.id in (select value::text::uuid from jsonb_array_elements_text(v_line->'optionIds'));
    end if;
    if v_unit < 0 then raise exception 'invalid_price'; end if;
    insert into public.dining_round_items (round_id, menu_item_id, name, unit_price, quantity, options_label,
      price_to_confirm, price_max)
    values (v_round, v_item.id, v_item.name, v_unit, v_qty, v_labels,
      v_item.price_to_confirm,
      case when v_item.price_to_confirm then coalesce(v_item.price_max, v_item.price) + (v_unit - v_item.price) end);
    v_subtotal := v_subtotal + v_unit * v_qty;
  end loop;
  update public.dining_rounds set subtotal = v_subtotal where id = v_round;
  update public.dining_guests set last_seen_at = now() where id = v_guest.id;
  return v_round;
end $$;
revoke all on function public.submit_dining_round(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_dining_round(text, jsonb, text) to service_role;

-- ── Internal: one accepted dish onto the bill — with its confirmed price ─
-- The old two-argument version is dropped: an overload beside it would make
-- every named call ambiguous.
drop function if exists public.dining_append_item(uuid, uuid);
create or replace function public.dining_append_item(p_item_id uuid, p_staff_id uuid, p_unit_price integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_item public.dining_round_items%rowtype;
  v_round public.dining_rounds%rowtype;
  v_session public.dining_sessions%rowtype;
  v_table public.restaurant_tables%rowtype;
  v_order public.orders%rowtype;
  v_menu public.menu_items%rowtype;
  v_line_total integer;
  v_min integer;
  v_unit integer;
  v_created boolean := false;
begin
  select * into v_item from public.dining_round_items where id = p_item_id and status = 'pending' for update;
  if not found then raise exception 'item_not_pending'; end if;
  select * into v_round from public.dining_rounds where id = v_item.round_id;
  select * into v_session from public.dining_sessions where id = v_round.session_id and status = 'open' for update;
  if not found then raise exception 'session_not_open'; end if;

  -- PRICE CONFIRMED BY THE RESTAURANT: within the dish's range, never outside.
  v_min := v_item.unit_price;
  v_unit := v_item.unit_price;
  if v_item.price_to_confirm then
    if p_unit_price is null then raise exception 'price_required'; end if;
    if p_unit_price < v_min or p_unit_price > coalesce(v_item.price_max, v_min) then
      raise exception 'price_out_of_range';
    end if;
    update public.dining_round_items set unit_price = p_unit_price where id = v_item.id;
    v_unit := p_unit_price;
  end if;

  v_line_total := v_unit * v_item.quantity;
  if v_item.menu_item_id is not null then
    select * into v_menu from public.menu_items where id = v_item.menu_item_id for update;
    if v_menu.track_stock and coalesce(v_menu.stock_quantity, 0) < v_item.quantity then
      raise exception 'insufficient_stock:%', v_item.name;
    end if;
    if v_menu.track_stock then
      update public.menu_items set stock_quantity = stock_quantity - v_item.quantity where id = v_menu.id;
    end if;
  end if;

  select * into v_table from public.restaurant_tables where id = v_session.table_id;
  if v_session.order_id is null then
    insert into public.orders (reference, restaurant_id, type, status, subtotal, service_charge_percent,
      service_charge, total, table_number, payment_method, dining_session_id)
    values ('CMD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
      v_session.restaurant_id, 'dine_in', 'confirmed', v_line_total, 0, 0, v_line_total,
      v_table.number, 'pay_at_restaurant', v_session.id)
    returning * into v_order;
    update public.dining_sessions set order_id = v_order.id where id = v_session.id;
    insert into public.order_status_history (order_id, status, by_name, note)
    values (v_order.id, 'confirmed', 'Dining room', 'Table ' || v_table.number || ' — first dish accepted');
    v_created := true;
  else
    select * into v_order from public.orders where id = v_session.order_id for update;
    if v_order.status in ('awaiting_customer','delivered','cancelled') then raise exception 'order_not_open'; end if;
    -- LATER ROUNDS REACH THE KITCHEN: a served ticket goes back to preparing.
    update public.orders set subtotal = subtotal + v_line_total, total = total + v_line_total,
      status = case when status = 'shipped' then 'preparing' else status end
    where id = v_order.id returning * into v_order;
    insert into public.order_status_history (order_id, status, by_name, note)
    values (v_order.id, v_order.status, 'Dining room', 'Dish added: ' || v_item.quantity || '× ' || v_item.name);
  end if;

  insert into public.order_items (order_id, menu_item_id, name, unit_price, quantity, options_label,
    price_to_confirm, price_min, price_max, price_confirmed_at)
  values (v_order.id, v_item.menu_item_id, v_item.name, v_unit, v_item.quantity, v_item.options_label,
    v_item.price_to_confirm,
    case when v_item.price_to_confirm then v_min end,
    case when v_item.price_to_confirm then v_item.price_max end,
    case when v_item.price_to_confirm then now() end);
  update public.dining_round_items set status = 'accepted', decided_by = p_staff_id, decided_at = now()
  where id = v_item.id;
  perform public.dining_occupy_tables(v_session.id);

  if not exists (select 1 from public.dining_round_items where round_id = v_round.id and status = 'pending') then
    update public.dining_rounds set
      status = case when exists (select 1 from public.dining_round_items where round_id = v_round.id and status = 'accepted')
                    then 'accepted' else 'rejected' end,
      decided_by = p_staff_id, decided_at = now()
    where id = v_round.id;
  end if;

  return jsonb_build_object('orderId', v_order.id, 'reference', v_order.reference,
    'created', v_created, 'amount', v_line_total, 'sessionId', v_session.id);
end $$;
revoke all on function public.dining_append_item(uuid, uuid, integer) from public, anon, authenticated;

-- ── Staff: accept (with the price, when it is to confirm) or decline ─────
drop function if exists public.decide_dining_item(uuid, uuid, boolean, text);
create or replace function public.decide_dining_item(
  p_item_id uuid, p_staff_id uuid, p_approve boolean, p_reason text default null, p_unit_price integer default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_item public.dining_round_items%rowtype;
  v_round public.dining_rounds%rowtype;
  v_session public.dining_sessions%rowtype;
  v_result jsonb := '{}'::jsonb;
  v_reason text;
begin
  select * into v_item from public.dining_round_items where id = p_item_id and status = 'pending' for update;
  if not found then raise exception 'item_not_pending'; end if;
  select * into v_round from public.dining_rounds where id = v_item.round_id for update;
  select * into v_session from public.dining_sessions where id = v_round.session_id and status = 'open' for update;
  if not found then raise exception 'session_not_open'; end if;
  if not public.dining_is_staff(v_session.restaurant_id, p_staff_id,
       array['owner','manager','cashier','waiter','kitchen']) then
    raise exception 'staff_forbidden';
  end if;

  if p_approve then
    -- ORDER BEFORE APPROVAL: the dish waits until the waiter has seen the guest.
    if v_round.guest_id is not null and not exists (
      select 1 from public.dining_guests where id = v_round.guest_id and status = 'approved'
    ) then raise exception 'guest_not_confirmed'; end if;
    v_result := public.dining_append_item(v_item.id, p_staff_id, p_unit_price);
    select * into v_item from public.dining_round_items where id = p_item_id;
  else
    v_reason := nullif(trim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 5 or length(v_reason) > 240 then
      raise exception 'reason_required';
    end if;
    update public.dining_round_items set status = 'rejected', rejection_reason = v_reason,
      decided_by = p_staff_id, decided_at = now() where id = v_item.id;
    if not exists (select 1 from public.dining_round_items where round_id = v_round.id and status = 'pending') then
      update public.dining_rounds set
        status = case when exists (select 1 from public.dining_round_items where round_id = v_round.id and status = 'accepted')
                      then 'accepted' else 'rejected' end,
        decided_by = p_staff_id, decided_at = now()
      where id = v_round.id;
    end if;
  end if;

  if exists (select 1 from public.dining_payments where session_id = v_session.id and status = 'succeeded') then
    perform public.dining_try_close(v_session.id);
  end if;

  return v_result || jsonb_build_object('guestId', v_round.guest_id, 'sessionId', v_session.id,
    'itemName', v_item.name, 'quantity', v_item.quantity,
    'amount', v_item.unit_price * v_item.quantity, 'unitPrice', v_item.unit_price,
    'priceToConfirm', v_item.price_to_confirm, 'approved', p_approve, 'reason', v_reason);
end $$;
revoke all on function public.decide_dining_item(uuid, uuid, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.decide_dining_item(uuid, uuid, boolean, text, integer) to service_role;

-- ── Staff: a waiter's order onto a bill; a line may carry its price ──────
create or replace function public.staff_add_dining_items(
  p_session_id uuid, p_staff_id uuid, p_lines jsonb, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session public.dining_sessions%rowtype;
  v_round uuid; v_line jsonb; v_item public.menu_items%rowtype; v_qty integer;
  v_unit integer; v_labels text; v_subtotal integer := 0; v_row uuid;
  v_price integer; v_max integer;
  v_result jsonb := '{}'::jsonb;
begin
  select * into v_session from public.dining_sessions where id = p_session_id and status = 'open' for update;
  if not found then raise exception 'session_not_open'; end if;
  if not public.dining_is_staff(v_session.restaurant_id, p_staff_id,
       array['owner','manager','cashier','waiter']) then
    raise exception 'staff_forbidden';
  end if;
  if jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 40 then raise exception 'invalid_lines'; end if;

  insert into public.dining_rounds (session_id, guest_id, notes, added_by_staff)
  values (v_session.id, null, left(nullif(trim(p_notes), ''), 500), p_staff_id) returning id into v_round;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::integer;
    if v_qty < 1 or v_qty > 50 then raise exception 'invalid_quantity'; end if;
    select * into v_item from public.menu_items where id = (v_line->>'menuItemId')::uuid
      and restaurant_id = v_session.restaurant_id and is_available;
    if not found then raise exception 'item_unavailable'; end if;
    v_unit := v_item.price; v_labels := null;
    if jsonb_array_length(coalesce(v_line->'optionIds', '[]'::jsonb)) > 0 then
      select v_item.price + coalesce(sum(o.price_delta), 0), string_agg(o.name, ' · ' order by o.sort_order)
      into v_unit, v_labels from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
      where g.menu_item_id = v_item.id and o.is_available
        and o.id in (select value::text::uuid from jsonb_array_elements_text(v_line->'optionIds'));
    end if;
    v_max := case when v_item.price_to_confirm then coalesce(v_item.price_max, v_item.price) + (v_unit - v_item.price) end;
    -- The waiter's price for a dish to confirm; the minimum when none was given.
    v_price := case when v_item.price_to_confirm
                    then coalesce(nullif(v_line->>'unitPrice', '')::integer, v_unit) end;
    insert into public.dining_round_items (round_id, menu_item_id, name, unit_price, quantity, options_label,
      price_to_confirm, price_max)
    values (v_round, v_item.id, v_item.name, v_unit, v_qty, v_labels, v_item.price_to_confirm, v_max)
    returning id into v_row;
    v_result := public.dining_append_item(v_row, p_staff_id, v_price);
    v_subtotal := v_subtotal + coalesce(v_price, v_unit) * v_qty;
  end loop;
  update public.dining_rounds set subtotal = v_subtotal where id = v_round;
  return v_result || jsonb_build_object('total', v_subtotal);
end $$;
revoke all on function public.staff_add_dining_items(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.staff_add_dining_items(uuid, uuid, jsonb, text) to service_role;

notify pgrst, 'reload schema';

-- Verify:
--   select column_name from information_schema.columns
--   where table_name in ('menu_items','order_items') and column_name like 'price_%';   -- price_to_confirm, price_max, price_min, price_confirmed_at
