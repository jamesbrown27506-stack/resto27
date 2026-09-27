-- 0068 — from reservation to on-site
--
-- ─────────────────────────────────────────────────────────────────────────
--  1. TABLE SERVICE V2 (Enterprise, 25 000 FCFA).
--
--     A TABLE HOLDS MANY BILLS. The QR used to open ONE session per table,
--     so three strangers sharing a big table shared one bill, and the waiter's
--     own orders lived outside it. A session is now a BILL:
--       · "Seul"          — kind 'solo', nobody else can join it;
--       · "Avec d'autres" — kind 'group', carries a 4-character join code the
--                           friends type after scanning the same table.
--     Any number of active bills per table (the old one-per-table unique
--     index is dropped). The waiter confirms presence ONCE per bill; people
--     who join a confirmed bill with its code are approved automatically.
--
--     ORDER BEFORE APPROVAL. A guest may browse and send dishes while the
--     waiter has not yet confirmed them; those dishes wait, and cannot reach
--     the kitchen, until presence is confirmed (decide_dining_item refuses a
--     dish whose guest is not approved).
--
--     THE BILL IS PAID IN PARTS. dining_payments holds every payment against
--     a bill: online (Mobile Money: everything / my dishes / equal split / an
--     amount, with an optional tip) or cash recorded by staff. Each online
--     payment carries the payment service fee (setting service_charge_percent)
--     on share + tip — the gateway takes its percentage on every Mobile Money
--     payment. The bill closes itself when what was paid covers what is due
--     (food − booking deposit) and no dish is still waiting for a decision.
--
--     LATER ROUNDS REACH THE KITCHEN. Accepting a dish on an order the kitchen
--     had already marked served ('shipped') moved nothing, so round 2 never
--     appeared on the kitchen screen (it lists confirmed + preparing). The
--     order now goes back to 'preparing' when new dishes are accepted.
--
--  2. BOOKING VOUCHERS (every plan). Every reservation gets a code
--     (R237-XXXX-XXXX) and a QR code opening /v/<code>. Valid from two hours
--     before the booking to the end of that day; redeemed once, atomically,
--     by staff of that restaurant. Redeeming seats the booking and, when a
--     bill is open, deducts the deposit from it.
--
--  3. BOOKINGS: several tables per booking (reservation_tables), table zones
--     and a seating preference, a maximum party size per restaurant (above it
--     the booking is a "group request" handled by hand), a cap on arrivals per
--     half-hour, closures, occasion, booking changes, phone bookings, guest
--     notes, a waitlist, and admin limits on how far ahead a table can be
--     booked and a delivery or pickup scheduled.
--
--  4. AFTER THE MEAL: anonymous table guests can review the restaurant, and
--     anyone can leave optional feedback about the platform itself.
--
--  Apply by hand in the Supabase SQL editor after 0067. Every new table has
--  RLS enabled and no browser policy: the server reads through the service
--  role, as for the rest of table service.
-- ─────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
--  0. Settings (Admin → Settings → Orders & bookings)
-- ═════════════════════════════════════════════════════════════════════════
insert into public.settings (key, value, value_type, category, label, description)
values
  ('reservation_max_days_ahead', '60', 'integer', 'orders',
   'How far ahead a table can be booked (days)',
   'Customers cannot request a table further in the future than this many days.'),
  ('order_schedule_max_days', '7', 'integer', 'orders',
   'How far ahead a delivery or pickup can be scheduled (days)',
   'Customers can schedule a delivery or a pickup up to this many days ahead, never further.')
on conflict (key) do nothing;

-- ═════════════════════════════════════════════════════════════════════════
--  1. Restaurant and table settings
-- ═════════════════════════════════════════════════════════════════════════
alter table public.restaurants
  add column if not exists tips_enabled boolean not null default false,
  add column if not exists reservation_max_party integer not null default 12,
  add column if not exists reservation_max_arrivals integer;

alter table public.restaurants drop constraint if exists restaurants_reservation_max_party_check;
alter table public.restaurants add constraint restaurants_reservation_max_party_check
  check (reservation_max_party between 1 and 200);
alter table public.restaurants drop constraint if exists restaurants_reservation_max_arrivals_check;
alter table public.restaurants add constraint restaurants_reservation_max_arrivals_check
  check (reservation_max_arrivals is null or reservation_max_arrivals between 1 and 100);

alter table public.restaurant_tables add column if not exists zone text;
alter table public.restaurant_tables drop constraint if exists restaurant_tables_zone_check;
alter table public.restaurant_tables add constraint restaurant_tables_zone_check
  check (zone is null or length(zone) between 1 and 40);

-- ═════════════════════════════════════════════════════════════════════════
--  2. Reservations: vouchers, occasion, preference, changes, source, fee
-- ═════════════════════════════════════════════════════════════════════════
alter table public.reservations
  add column if not exists voucher_code text,
  add column if not exists voucher_redeemed_at timestamptz,
  add column if not exists voucher_redeemed_by uuid references public.profiles(id) on delete set null,
  add column if not exists occasion text,
  add column if not exists seating_preference text,
  add column if not exists is_group_request boolean not null default false,
  add column if not exists pending_change jsonb,
  add column if not exists source text not null default 'online',
  -- The payment service fee charged on top of an online deposit (kept by the
  -- platform, which pays the gateway). 0 for bookings paid before 0068.
  add column if not exists deposit_fee integer not null default 0;

alter table public.reservations drop constraint if exists reservations_occasion_check;
alter table public.reservations add constraint reservations_occasion_check
  check (occasion is null or occasion in ('birthday','anniversary','business','date','family','celebration','other'));
alter table public.reservations drop constraint if exists reservations_source_check;
alter table public.reservations add constraint reservations_source_check
  check (source in ('online','phone','walk_in'));
alter table public.reservations drop constraint if exists reservations_deposit_fee_check;
alter table public.reservations add constraint reservations_deposit_fee_check check (deposit_fee >= 0);
alter table public.reservations drop constraint if exists reservations_seating_preference_check;
alter table public.reservations add constraint reservations_seating_preference_check
  check (seating_preference is null or length(seating_preference) between 1 and 40);

create unique index if not exists reservations_voucher_code_idx
  on public.reservations (voucher_code) where voucher_code is not null;

-- R237-XXXX-XXXX from an unambiguous alphabet (no 0/O, 1/I, 5/S, 8/B, 2/Z).
-- The randomness comes from gen_random_uuid() (a v4 UUID: 122 random bits).
create or replace function public.new_voucher_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  v_alphabet constant text := 'ACDEFGHJKLMNPQRTUVWXY34679';
  v_bytes bytea;
  v_code text;
  i integer;
begin
  loop
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := 'R237-';
    for i in 0..7 loop
      if i = 4 then v_code := v_code || '-'; end if;
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % length(v_alphabet)), 1);
    end loop;
    exit when not exists (select 1 from public.reservations where voucher_code = v_code);
  end loop;
  return v_code;
end $$;
revoke all on function public.new_voucher_code() from public, anon, authenticated;

create or replace function public.reservations_voucher_default()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.voucher_code is null then new.voucher_code := public.new_voucher_code(); end if;
  return new;
end $$;

drop trigger if exists reservations_voucher_default on public.reservations;
create trigger reservations_voucher_default before insert on public.reservations
  for each row execute function public.reservations_voucher_default();

update public.reservations set voucher_code = public.new_voucher_code()
where voucher_code is null and status in ('pending','awaiting_payment','confirmed','seated');

-- ── Several tables per booking ───────────────────────────────────────────
create table if not exists public.reservation_tables (
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  primary key (reservation_id, table_id)
);
create index if not exists reservation_tables_table_idx on public.reservation_tables (table_id);
alter table public.reservation_tables enable row level security;

insert into public.reservation_tables (reservation_id, table_id)
select id, table_id from public.reservations where table_id is not null
on conflict do nothing;

-- ── Closures (holidays, private events) ──────────────────────────────────
create table if not exists public.restaurant_closures (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text check (reason is null or length(reason) <= 120),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists restaurant_closures_idx on public.restaurant_closures (restaurant_id, ends_on);
alter table public.restaurant_closures enable row level security;

-- ── Waitlist for a full slot ─────────────────────────────────────────────
create table if not exists public.reservation_waitlist (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  wanted_date date not null,
  wanted_time text not null check (wanted_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  party_size integer not null check (party_size between 1 and 200),
  status text not null default 'waiting' check (status in ('waiting','notified','booked','cancelled','expired')),
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists reservation_waitlist_once_idx
  on public.reservation_waitlist (restaurant_id, customer_id, wanted_date, wanted_time)
  where status in ('waiting','notified');
create index if not exists reservation_waitlist_day_idx
  on public.reservation_waitlist (restaurant_id, wanted_date) where status = 'waiting';
alter table public.reservation_waitlist enable row level security;

-- ── Staff notes about a regular guest ────────────────────────────────────
create table if not exists public.restaurant_guest_notes (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  note text not null check (length(note) between 1 and 1000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, customer_id)
);
alter table public.restaurant_guest_notes enable row level security;

-- ═════════════════════════════════════════════════════════════════════════
--  3. Table service v2 — bills, presence, payments
-- ═════════════════════════════════════════════════════════════════════════
drop index if exists public.dining_sessions_active_table_idx;
create index if not exists dining_sessions_table_active_idx
  on public.dining_sessions (table_id)
  where status in ('awaiting_staff','open','payment_requested');

alter table public.dining_sessions
  add column if not exists kind text not null default 'group',
  add column if not exists join_code text,
  add column if not exists label text,
  add column if not exists presence_confirmed_at timestamptz,
  add column if not exists reservation_id uuid references public.reservations(id) on delete set null,
  add column if not exists extra_table_ids uuid[] not null default '{}',
  add column if not exists deposit_credit integer not null default 0,
  add column if not exists opened_by_staff boolean not null default false;

alter table public.dining_sessions drop constraint if exists dining_sessions_kind_check;
alter table public.dining_sessions add constraint dining_sessions_kind_check check (kind in ('solo','group'));
alter table public.dining_sessions drop constraint if exists dining_sessions_deposit_credit_check;
alter table public.dining_sessions add constraint dining_sessions_deposit_credit_check check (deposit_credit >= 0);
alter table public.dining_sessions drop constraint if exists dining_sessions_label_check;
alter table public.dining_sessions add constraint dining_sessions_label_check
  check (label is null or length(label) between 1 and 60);

create unique index if not exists dining_sessions_join_code_idx
  on public.dining_sessions (restaurant_id, join_code)
  where join_code is not null and status in ('awaiting_staff','open','payment_requested');

-- Sessions opened before 0068 were confirmed when their first guest was.
update public.dining_sessions
set presence_confirmed_at = coalesce(opened_at, now())
where status in ('open','payment_requested') and presence_confirmed_at is null;

-- A waiter's own round has no guest behind it.
alter table public.dining_rounds alter column guest_id drop not null;
alter table public.dining_rounds
  add column if not exists added_by_staff uuid references public.profiles(id) on delete set null;

alter table public.orders add column if not exists tip_amount integer not null default 0;
alter table public.orders drop constraint if exists orders_tip_amount_check;
alter table public.orders add constraint orders_tip_amount_check check (tip_amount >= 0);

create table if not exists public.dining_payments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.dining_sessions(id) on delete cascade,
  guest_id uuid references public.dining_guests(id) on delete set null,
  method text not null check (method in ('mobile_money','cash')),
  split_mode text not null default 'all' check (split_mode in ('all','mine','equal','amount')),
  -- The part of the bill this payment settles (food, after the deposit).
  amount integer not null check (amount > 0),
  tip integer not null default 0 check (tip >= 0),
  service_fee integer not null default 0 check (service_fee >= 0),
  status text not null default 'pending' check (status in ('pending','succeeded','failed','refunded')),
  attempt_id uuid references public.payment_attempts(id) on delete set null,
  phone text,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists dining_payments_session_idx on public.dining_payments (session_id, created_at);
create index if not exists dining_payments_pending_idx on public.dining_payments (created_at) where status = 'pending';
alter table public.dining_payments enable row level security;
revoke all on public.dining_payments from public, anon, authenticated;

-- ── Small helpers (internal) ─────────────────────────────────────────────

-- A 4-character join code, unique among the restaurant's active bills.
create or replace function public.new_dining_code(p_restaurant_id uuid)
returns text language plpgsql volatile set search_path = public as $$
declare
  v_alphabet constant text := 'ACDEFGHJKLMNPQRTUVWXY34679';
  v_bytes bytea;
  v_code text;
  i integer;
begin
  loop
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := '';
    for i in 0..3 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % length(v_alphabet)), 1);
    end loop;
    exit when not exists (
      select 1 from public.dining_sessions
      where restaurant_id = p_restaurant_id and join_code = v_code
        and status in ('awaiting_staff','open','payment_requested')
    );
  end loop;
  return v_code;
end $$;

-- What the bill still asks for, before any payment: food − booking deposit.
create or replace function public.dining_bill_due(p_session_id uuid)
returns integer language sql stable set search_path = public as $$
  select greatest(coalesce(o.subtotal, 0) - s.deposit_credit, 0)::integer
  from public.dining_sessions s
  left join public.orders o on o.id = s.order_id
  where s.id = p_session_id
$$;

create or replace function public.dining_paid(p_session_id uuid)
returns integer language sql stable set search_path = public as $$
  select coalesce(sum(amount), 0)::integer from public.dining_payments
  where session_id = p_session_id and status = 'succeeded'
$$;

-- Online payments started in the last 16 minutes (the longest gateway
-- confirmation window is 15) — money that may still arrive.
create or replace function public.dining_in_flight(p_session_id uuid)
returns integer language sql stable set search_path = public as $$
  select coalesce(sum(amount), 0)::integer from public.dining_payments
  where session_id = p_session_id and status = 'pending'
    and created_at > now() - interval '16 minutes'
$$;

create or replace function public.dining_is_staff(p_restaurant_id uuid, p_staff_id uuid, p_roles text[])
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.restaurant_staff
    where restaurant_id = p_restaurant_id and profile_id = p_staff_id
      and status = 'active' and role = any(p_roles)
  )
$$;

-- A table is free only when no active bill sits on it any more.
create or replace function public.dining_release_tables(p_session_id uuid)
returns void language plpgsql set search_path = public as $$
declare v_session public.dining_sessions%rowtype; v_table uuid;
begin
  select * into v_session from public.dining_sessions where id = p_session_id;
  if not found then return; end if;
  foreach v_table in array (array[v_session.table_id] || coalesce(v_session.extra_table_ids, '{}')) loop
    if not exists (
      select 1 from public.dining_sessions s
      where s.id <> v_session.id and s.status in ('awaiting_staff','open','payment_requested')
        and (s.table_id = v_table or v_table = any(s.extra_table_ids))
    ) then
      update public.restaurant_tables set status = 'available' where id = v_table and status = 'occupied';
    end if;
  end loop;
end $$;

create or replace function public.dining_occupy_tables(p_session_id uuid)
returns void language plpgsql set search_path = public as $$
declare v_session public.dining_sessions%rowtype;
begin
  select * into v_session from public.dining_sessions where id = p_session_id;
  if not found then return; end if;
  update public.restaurant_tables set status = 'occupied'
  where id = any(array[v_session.table_id] || coalesce(v_session.extra_table_ids, '{}'))
    and status in ('available','reserved');
end $$;

-- Helpers are internal: only the security-definer functions below call them.
revoke all on function public.new_dining_code(uuid) from public, anon, authenticated;
revoke all on function public.dining_bill_due(uuid) from public, anon, authenticated;
revoke all on function public.dining_paid(uuid) from public, anon, authenticated;
revoke all on function public.dining_in_flight(uuid) from public, anon, authenticated;
revoke all on function public.dining_is_staff(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.dining_release_tables(uuid) from public, anon, authenticated;
revoke all on function public.dining_occupy_tables(uuid) from public, anon, authenticated;
grant execute on function public.dining_bill_due(uuid) to service_role;
grant execute on function public.dining_paid(uuid) to service_role;

-- ── Guest: open a new bill ───────────────────────────────────────────────
create or replace function public.open_dining_bill(
  p_table_token uuid, p_token_hash text, p_display_name text, p_kind text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_table public.restaurant_tables%rowtype;
  v_session public.dining_sessions%rowtype;
  v_guest uuid;
  v_name text := left(coalesce(nullif(trim(p_display_name), ''), 'Client'), 60);
begin
  if p_kind not in ('solo','group') then raise exception 'invalid_kind'; end if;
  select t.* into v_table from public.restaurant_tables t
  join public.restaurants r on r.id = t.restaurant_id and r.status = 'active'
  where t.public_token = p_table_token and t.status <> 'out_of_service';
  if not found then raise exception 'table_unavailable'; end if;
  if not exists (
    select 1 from public.subscription_state s join public.subscription_plans p on p.id = s.plan_id
    where s.restaurant_id = v_table.restaurant_id and s.state in ('active','grace') and p.tier = 'enterprise'
  ) then raise exception 'feature_unavailable'; end if;

  insert into public.dining_sessions (restaurant_id, table_id, kind, join_code, label)
  values (v_table.restaurant_id, v_table.id, p_kind,
          case when p_kind = 'group' then public.new_dining_code(v_table.restaurant_id) end,
          v_name)
  returning * into v_session;

  insert into public.dining_guests (session_id, token_hash, display_name)
  values (v_session.id, p_token_hash, v_name) returning id into v_guest;
  insert into public.dining_messages (session_id, guest_id, sender_kind, kind, body)
  values (v_session.id, v_guest, 'system', 'message',
          case when p_kind = 'solo' then 'Nouvelle addition (seul)' else 'Nouvelle addition de groupe' end);

  return jsonb_build_object('guestId', v_guest, 'sessionId', v_session.id, 'status', 'pending',
                            'code', v_session.join_code);
end $$;
revoke all on function public.open_dining_bill(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.open_dining_bill(uuid, text, text, text) to service_role;

-- ── Guest: join a group bill with its code ───────────────────────────────
create or replace function public.join_dining_bill(
  p_table_token uuid, p_code text, p_token_hash text, p_display_name text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_table public.restaurant_tables%rowtype;
  v_session public.dining_sessions%rowtype;
  v_guest uuid;
  v_status text;
  v_name text := left(coalesce(nullif(trim(p_display_name), ''), 'Client'), 60);
begin
  select t.* into v_table from public.restaurant_tables t
  join public.restaurants r on r.id = t.restaurant_id and r.status = 'active'
  where t.public_token = p_table_token and t.status <> 'out_of_service';
  if not found then raise exception 'table_unavailable'; end if;
  if not exists (
    select 1 from public.subscription_state s join public.subscription_plans p on p.id = s.plan_id
    where s.restaurant_id = v_table.restaurant_id and s.state in ('active','grace') and p.tier = 'enterprise'
  ) then raise exception 'feature_unavailable'; end if;

  -- The code only works on a table the bill actually sits on: a code seen
  -- across the room does not open someone else's bill from another table.
  select * into v_session from public.dining_sessions
  where restaurant_id = v_table.restaurant_id
    and join_code = upper(trim(p_code))
    and kind = 'group'
    and status in ('awaiting_staff','open')
    and (table_id = v_table.id or v_table.id = any(extra_table_ids))
  for update;
  if not found then raise exception 'code_not_found'; end if;

  v_status := case when v_session.presence_confirmed_at is not null then 'approved' else 'pending' end;
  insert into public.dining_guests (session_id, token_hash, display_name, status, approved_at)
  values (v_session.id, p_token_hash, v_name, v_status,
          case when v_status = 'approved' then now() end)
  returning id into v_guest;
  insert into public.dining_messages (session_id, guest_id, sender_kind, kind, body)
  values (v_session.id, v_guest, 'system', 'message', v_name || ' a rejoint l’addition');

  return jsonb_build_object('guestId', v_guest, 'sessionId', v_session.id, 'status', v_status,
                            'code', v_session.join_code);
end $$;
revoke all on function public.join_dining_bill(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.join_dining_bill(uuid, text, text, text) to service_role;

-- ── Staff: confirm (or refuse) the people behind a bill ──────────────────
create or replace function public.confirm_dining_presence(
  p_session_id uuid, p_staff_id uuid, p_approve boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session public.dining_sessions%rowtype;
  v_ids uuid[];
begin
  select * into v_session from public.dining_sessions
  where id = p_session_id and status in ('awaiting_staff','open') for update;
  if not found then raise exception 'session_not_open'; end if;
  if not public.dining_is_staff(v_session.restaurant_id, p_staff_id,
       array['owner','manager','kitchen','cashier','waiter']) then
    raise exception 'staff_forbidden';
  end if;

  if p_approve then
    with changed as (
      update public.dining_guests set status = 'approved', approved_by = p_staff_id, approved_at = now()
      where session_id = v_session.id and status = 'pending'
      returning id
    ) select coalesce(array_agg(id), '{}') into v_ids from changed;
    update public.dining_sessions set status = 'open',
      presence_confirmed_at = coalesce(presence_confirmed_at, now()),
      opened_by = coalesce(opened_by, p_staff_id), opened_at = coalesce(opened_at, now())
    where id = v_session.id;
    perform public.dining_occupy_tables(v_session.id);
  else
    with changed as (
      update public.dining_guests set status = 'rejected'
      where session_id = v_session.id and status = 'pending'
      returning id
    ) select coalesce(array_agg(id), '{}') into v_ids from changed;
    if not exists (select 1 from public.dining_guests where session_id = v_session.id and status = 'approved') then
      update public.dining_sessions set status = 'cancelled', closed_at = now() where id = v_session.id;
      -- Dishes the refused guests had sent never reach anyone.
      update public.dining_round_items i set status = 'rejected', rejection_reason = 'Présence non confirmée',
        decided_by = p_staff_id, decided_at = now()
      from public.dining_rounds r
      where r.id = i.round_id and r.session_id = v_session.id and i.status = 'pending';
      update public.dining_rounds set status = 'rejected', decided_by = p_staff_id, decided_at = now()
      where session_id = v_session.id and status = 'pending';
    end if;
  end if;
  return jsonb_build_object('sessionId', v_session.id, 'guestIds', to_jsonb(v_ids));
end $$;
revoke all on function public.confirm_dining_presence(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.confirm_dining_presence(uuid, uuid, boolean) to service_role;

-- Single-guest decisions still exist (a late joiner on an unconfirmed bill,
-- removing one person); approving one now also confirms the bill.
create or replace function public.decide_dining_guest(
  p_guest_id uuid, p_staff_id uuid, p_approve boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_guest public.dining_guests%rowtype; v_session public.dining_sessions%rowtype;
begin
  select * into v_guest from public.dining_guests where id = p_guest_id and status = 'pending' for update;
  if not found then raise exception 'guest_not_pending'; end if;
  select * into v_session from public.dining_sessions
  where id = v_guest.session_id and status in ('awaiting_staff','open') for update;
  if not found then raise exception 'session_not_open'; end if;
  if not public.dining_is_staff(v_session.restaurant_id, p_staff_id,
       array['owner','manager','kitchen','cashier','waiter']) then
    raise exception 'staff_forbidden';
  end if;

  update public.dining_guests set
    status = case when p_approve then 'approved' else 'rejected' end,
    approved_by = case when p_approve then p_staff_id else null end,
    approved_at = case when p_approve then now() else null end
  where id = v_guest.id;

  if p_approve then
    update public.dining_sessions set status = 'open',
      presence_confirmed_at = coalesce(presence_confirmed_at, now()),
      opened_by = coalesce(opened_by, p_staff_id), opened_at = coalesce(opened_at, now())
    where id = v_session.id;
    perform public.dining_occupy_tables(v_session.id);
  else
    update public.dining_round_items i set status = 'rejected', rejection_reason = 'Présence non confirmée',
      decided_by = p_staff_id, decided_at = now()
    from public.dining_rounds r
    where r.id = i.round_id and r.guest_id = v_guest.id and i.status = 'pending';
    update public.dining_rounds set status = 'rejected', decided_by = p_staff_id, decided_at = now()
    where guest_id = v_guest.id and status = 'pending';
    if not exists (
      select 1 from public.dining_guests where session_id = v_session.id and status in ('pending','approved')
    ) and v_session.status = 'awaiting_staff' then
      update public.dining_sessions set status = 'cancelled', closed_at = now() where id = v_session.id;
    end if;
  end if;
  return v_session.id;
end $$;
revoke all on function public.decide_dining_guest(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.decide_dining_guest(uuid, uuid, boolean) to service_role;

-- ── Guest: send dishes (allowed before presence is confirmed) ────────────
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
    insert into public.dining_round_items (round_id, menu_item_id, name, unit_price, quantity, options_label)
    values (v_round, v_item.id, v_item.name, v_unit, v_qty, v_labels);
    v_subtotal := v_subtotal + v_unit * v_qty;
  end loop;
  update public.dining_rounds set subtotal = v_subtotal where id = v_round;
  update public.dining_guests set last_seen_at = now() where id = v_guest.id;
  return v_round;
end $$;
revoke all on function public.submit_dining_round(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_dining_round(text, jsonb, text) to service_role;

-- ── Internal: put one accepted dish on the bill and in the kitchen ───────
create or replace function public.dining_append_item(p_item_id uuid, p_staff_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_item public.dining_round_items%rowtype;
  v_round public.dining_rounds%rowtype;
  v_session public.dining_sessions%rowtype;
  v_table public.restaurant_tables%rowtype;
  v_order public.orders%rowtype;
  v_menu public.menu_items%rowtype;
  v_line_total integer;
  v_created boolean := false;
begin
  select * into v_item from public.dining_round_items where id = p_item_id and status = 'pending' for update;
  if not found then raise exception 'item_not_pending'; end if;
  select * into v_round from public.dining_rounds where id = v_item.round_id;
  select * into v_session from public.dining_sessions where id = v_round.session_id and status = 'open' for update;
  if not found then raise exception 'session_not_open'; end if;

  v_line_total := v_item.unit_price * v_item.quantity;
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

  insert into public.order_items (order_id, menu_item_id, name, unit_price, quantity, options_label)
  values (v_order.id, v_item.menu_item_id, v_item.name, v_item.unit_price, v_item.quantity, v_item.options_label);
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
revoke all on function public.dining_append_item(uuid, uuid) from public, anon, authenticated;

-- ── Staff: accept or decline one guest dish ──────────────────────────────
create or replace function public.decide_dining_item(
  p_item_id uuid, p_staff_id uuid, p_approve boolean, p_reason text default null
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
    v_result := public.dining_append_item(v_item.id, p_staff_id);
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

  -- A bill the guests already paid closes once its last dish is decided.
  -- Only after a real payment: a bill covered by a booking deposit alone must
  -- not close on its first accepted dish — the waiter closes that one.
  if exists (select 1 from public.dining_payments where session_id = v_session.id and status = 'succeeded') then
    perform public.dining_try_close(v_session.id);
  end if;

  return v_result || jsonb_build_object('guestId', v_round.guest_id, 'sessionId', v_session.id,
    'itemName', v_item.name, 'quantity', v_item.quantity,
    'amount', v_item.unit_price * v_item.quantity, 'approved', p_approve, 'reason', v_reason);
end $$;
revoke all on function public.decide_dining_item(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.decide_dining_item(uuid, uuid, boolean, text) to service_role;

-- ── Staff: add dishes to a bill directly (waiter's order) ────────────────
create or replace function public.staff_add_dining_items(
  p_session_id uuid, p_staff_id uuid, p_lines jsonb, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session public.dining_sessions%rowtype;
  v_round uuid; v_line jsonb; v_item public.menu_items%rowtype; v_qty integer;
  v_unit integer; v_labels text; v_subtotal integer := 0; v_row uuid;
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
    insert into public.dining_round_items (round_id, menu_item_id, name, unit_price, quantity, options_label)
    values (v_round, v_item.id, v_item.name, v_unit, v_qty, v_labels) returning id into v_row;
    v_subtotal := v_subtotal + v_unit * v_qty;
    v_result := public.dining_append_item(v_row, p_staff_id);
  end loop;
  update public.dining_rounds set subtotal = v_subtotal where id = v_round;
  return v_result || jsonb_build_object('total', v_subtotal);
end $$;
revoke all on function public.staff_add_dining_items(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.staff_add_dining_items(uuid, uuid, jsonb, text) to service_role;

-- ── Staff: open a bill for a walk-in or a seated booking ─────────────────
create or replace function public.staff_open_dining_bill(
  p_table_id uuid, p_staff_id uuid, p_label text, p_reservation_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_table public.restaurant_tables%rowtype;
  v_session public.dining_sessions%rowtype;
  v_extra uuid[] := '{}';
begin
  select * into v_table from public.restaurant_tables where id = p_table_id and status <> 'out_of_service';
  if not found then raise exception 'table_unavailable'; end if;
  if not public.dining_is_staff(v_table.restaurant_id, p_staff_id,
       array['owner','manager','cashier','waiter']) then
    raise exception 'staff_forbidden';
  end if;
  if p_reservation_id is not null then
    select coalesce(array_agg(table_id), '{}') into v_extra from public.reservation_tables
    where reservation_id = p_reservation_id and table_id <> p_table_id;
  end if;

  insert into public.dining_sessions (restaurant_id, table_id, status, kind, join_code, label,
    presence_confirmed_at, opened_by, opened_at, opened_by_staff, reservation_id, extra_table_ids)
  values (v_table.restaurant_id, v_table.id, 'open', 'group', public.new_dining_code(v_table.restaurant_id),
    left(coalesce(nullif(trim(p_label), ''), 'Table ' || v_table.number), 60),
    now(), p_staff_id, now(), true, p_reservation_id, v_extra)
  returning * into v_session;
  insert into public.dining_messages (session_id, sender_kind, kind, body)
  values (v_session.id, 'system', 'message', 'Addition ouverte par le personnel');
  perform public.dining_occupy_tables(v_session.id);
  return jsonb_build_object('sessionId', v_session.id, 'code', v_session.join_code);
end $$;
revoke all on function public.staff_open_dining_bill(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.staff_open_dining_bill(uuid, uuid, text, uuid) to service_role;

-- ── Internal: close a bill that is fully covered ─────────────────────────
create or replace function public.dining_try_close(p_session_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_session public.dining_sessions%rowtype;
  v_order public.orders%rowtype;
  v_due integer;
  v_fees integer;
  v_tips integer;
  v_cash boolean;
  v_percent numeric;
begin
  select * into v_session from public.dining_sessions
  where id = p_session_id and status in ('open','payment_requested') for update;
  if not found then return false; end if;
  if exists (
    select 1 from public.dining_round_items i join public.dining_rounds r on r.id = i.round_id
    where r.session_id = v_session.id and i.status = 'pending'
  ) then return false; end if;
  if v_session.order_id is null then return false; end if;

  v_due := public.dining_bill_due(v_session.id);
  if public.dining_paid(v_session.id) < v_due then return false; end if;
  if public.dining_in_flight(v_session.id) > 0 then return false; end if;

  select coalesce(sum(service_fee), 0), coalesce(sum(tip), 0), coalesce(bool_or(method = 'cash'), false)
  into v_fees, v_tips, v_cash
  from public.dining_payments where session_id = v_session.id and status = 'succeeded';
  select coalesce(nullif(value, '')::numeric, 0) into v_percent from public.settings where key = 'service_charge_percent';

  select * into v_order from public.orders where id = v_session.order_id for update;
  if not v_order.is_paid then
    update public.orders set
      is_paid = true,
      status = 'delivered',
      delivered_at = now(),
      discount_amount = least(v_session.deposit_credit, subtotal),
      service_charge = v_fees,
      service_charge_percent = case when v_fees > 0 then coalesce(v_percent, 0) else 0 end,
      tip_amount = v_tips,
      total = greatest(subtotal - v_session.deposit_credit, 0) + v_fees,
      payment_method = case when v_cash then 'pay_at_restaurant' else 'mobile_money' end
    where id = v_order.id;
    insert into public.order_status_history (order_id, status, by_name, note)
    values (v_order.id, 'delivered', 'Dining room', 'Bill settled');
  end if;

  update public.dining_sessions set status = 'closed', closed_at = now() where id = v_session.id;
  update public.dining_guests set status = 'expired' where session_id = v_session.id and status in ('pending','approved');
  perform public.dining_release_tables(v_session.id);
  if v_session.reservation_id is not null then
    update public.reservations set status = 'completed'
    where id = v_session.reservation_id and status in ('confirmed','seated');
  end if;
  return true;
end $$;
revoke all on function public.dining_try_close(uuid) from public, anon, authenticated;
grant execute on function public.dining_try_close(uuid) to service_role;

-- ── Guest: start an online payment for part (or all) of the bill ─────────
create or replace function public.start_dining_payment(
  p_token_hash text, p_mode text, p_amount integer, p_parts integer, p_tip integer, p_phone text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_guest public.dining_guests%rowtype;
  v_session public.dining_sessions%rowtype;
  v_order public.orders%rowtype;
  v_due integer; v_paid integer; v_flight integer; v_remaining integer;
  v_share integer; v_tip integer; v_fee integer; v_percent numeric; v_mine integer;
  v_tips_enabled boolean;
  v_payment uuid;
begin
  if p_mode not in ('all','mine','equal','amount') then raise exception 'invalid_mode'; end if;
  select * into v_guest from public.dining_guests where token_hash = p_token_hash and status = 'approved';
  if not found then raise exception 'guest_not_approved'; end if;
  select * into v_session from public.dining_sessions
  where id = v_guest.session_id and status in ('open','payment_requested') for update;
  if not found or v_session.order_id is null then raise exception 'session_not_payable'; end if;
  select * into v_order from public.orders where id = v_session.order_id;
  if v_order.is_paid then raise exception 'order_already_paid'; end if;

  -- Payments nobody confirmed within the window will not arrive any more.
  update public.dining_payments set status = 'failed'
  where session_id = v_session.id and status = 'pending' and created_at <= now() - interval '16 minutes';

  v_due := public.dining_bill_due(v_session.id);
  v_paid := public.dining_paid(v_session.id);
  v_flight := public.dining_in_flight(v_session.id);
  v_remaining := v_due - v_paid - v_flight;
  if v_remaining <= 0 then
    if v_flight > 0 then raise exception 'payment_in_progress'; end if;
    raise exception 'nothing_to_pay';
  end if;

  if p_mode = 'all' then
    v_share := v_remaining;
  elsif p_mode = 'mine' then
    select coalesce(sum(i.unit_price * i.quantity), 0) into v_mine
    from public.dining_round_items i join public.dining_rounds r on r.id = i.round_id
    where r.guest_id = v_guest.id and i.status = 'accepted';
    -- Minus what this guest already paid (or is paying) for their own dishes.
    v_mine := v_mine - coalesce((select sum(amount) from public.dining_payments
      where guest_id = v_guest.id and split_mode = 'mine'
        and (status = 'succeeded' or (status = 'pending' and created_at > now() - interval '16 minutes'))), 0);
    v_share := least(v_mine, v_remaining);
    if v_share <= 0 then raise exception 'nothing_mine'; end if;
  elsif p_mode = 'equal' then
    if p_parts is null or p_parts < 2 or p_parts > 50 then raise exception 'invalid_parts'; end if;
    v_share := least(ceil(v_due::numeric / p_parts)::integer, v_remaining);
  else
    if p_amount is null or p_amount < 100 or p_amount > v_remaining then raise exception 'invalid_amount'; end if;
    v_share := p_amount;
  end if;

  select coalesce(tips_enabled, false) into v_tips_enabled from public.restaurants where id = v_session.restaurant_id;
  v_tip := case when v_tips_enabled then greatest(coalesce(p_tip, 0), 0) else 0 end;
  if v_tip > v_share then raise exception 'tip_too_large'; end if;

  select coalesce(nullif(value, '')::numeric, 0) into v_percent from public.settings where key = 'service_charge_percent';
  v_fee := round((v_share + v_tip) * greatest(coalesce(v_percent, 0), 0) / 100.0);

  insert into public.dining_payments (session_id, guest_id, method, split_mode, amount, tip, service_fee, status, phone)
  values (v_session.id, v_guest.id, 'mobile_money', p_mode, v_share, v_tip, v_fee, 'pending', left(p_phone, 20))
  returning id into v_payment;

  return jsonb_build_object('paymentId', v_payment, 'share', v_share, 'tip', v_tip, 'fee', v_fee,
    'total', v_share + v_tip + v_fee, 'reference', v_order.reference, 'restaurantId', v_session.restaurant_id,
    'sessionId', v_session.id);
end $$;
revoke all on function public.start_dining_payment(text, text, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.start_dining_payment(text, text, integer, integer, integer, text) to service_role;

-- ── Settlement of one online table payment (called by lib/payments/collect)
create or replace function public.settle_dining_payment(p_payment_id uuid, p_amount integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payment public.dining_payments%rowtype;
  v_session public.dining_sessions%rowtype;
  v_order public.orders%rowtype;
  v_table text;
  v_remaining integer;
  v_closed boolean;
begin
  select * into v_payment from public.dining_payments where id = p_payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if v_payment.status = 'succeeded' then
    return jsonb_build_object('alreadySettled', true, 'sessionId', v_payment.session_id);
  end if;
  if v_payment.status = 'refunded' or v_payment.method <> 'mobile_money' then raise exception 'not_payable'; end if;
  if p_amount is distinct from (v_payment.amount + v_payment.tip + v_payment.service_fee) then
    raise exception 'amount_mismatch';
  end if;

  select * into v_session from public.dining_sessions
  where id = v_payment.session_id and status in ('open','payment_requested') for update;
  if not found or v_session.order_id is null then raise exception 'not_payable'; end if;
  select * into v_order from public.orders where id = v_session.order_id for update;
  if v_order.is_paid then raise exception 'not_payable'; end if;

  -- A late payment may never push the bill past what it owes.
  v_remaining := public.dining_bill_due(v_session.id) - public.dining_paid(v_session.id);
  if v_payment.amount > v_remaining then raise exception 'not_payable'; end if;

  select number into v_table from public.restaurant_tables where id = v_session.table_id;
  perform public.wallet_credit(v_session.restaurant_id, v_payment.amount + v_payment.tip, 'payment',
    'Table ' || coalesce(v_table, '?') || ' — ' || v_order.reference ||
      case when v_payment.tip > 0 then ' (pourboire ' || v_payment.tip || ')' else '' end,
    v_order.reference);
  if v_payment.service_fee > 0 then
    insert into public.platform_revenue_ledger (source_type, source_id, restaurant_id, gross, amount, reference, note)
    values ('online_payment_fee', v_payment.id, v_session.restaurant_id,
      v_payment.amount + v_payment.tip + v_payment.service_fee, v_payment.service_fee,
      v_order.reference, 'Table payment service fee')
    on conflict (source_type, source_id) do nothing;
  end if;

  update public.dining_payments set status = 'succeeded', settled_at = now() where id = v_payment.id;
  insert into public.order_payments (order_id, amount, method, collected_by)
  values (v_order.id, v_payment.amount + v_payment.tip + v_payment.service_fee, 'mobile_money', 'gateway');

  v_closed := public.dining_try_close(v_session.id);
  return jsonb_build_object('alreadySettled', false, 'sessionId', v_session.id, 'closed', v_closed,
    'orderId', v_order.id, 'amount', v_payment.amount, 'tip', v_payment.tip, 'guestId', v_payment.guest_id);
end $$;
revoke all on function public.settle_dining_payment(uuid, integer) from public, anon, authenticated;
grant execute on function public.settle_dining_payment(uuid, integer) to service_role;

-- ── Staff: the rest of the bill was paid in cash ─────────────────────────
create or replace function public.record_dining_cash(
  p_session_id uuid, p_staff_id uuid, p_amount integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session public.dining_sessions%rowtype;
  v_remaining integer;
  v_closed boolean;
begin
  select * into v_session from public.dining_sessions
  where id = p_session_id and status in ('open','payment_requested') for update;
  if not found then raise exception 'session_not_open'; end if;
  if not public.dining_is_staff(v_session.restaurant_id, p_staff_id,
       array['owner','manager','cashier','waiter']) then
    raise exception 'staff_forbidden';
  end if;
  if v_session.order_id is null then raise exception 'empty_bill'; end if;
  if exists (
    select 1 from public.dining_round_items i join public.dining_rounds r on r.id = i.round_id
    where r.session_id = v_session.id and i.status = 'pending'
  ) then raise exception 'undecided_dishes'; end if;
  if public.dining_in_flight(v_session.id) > 0 then raise exception 'payment_in_flight'; end if;

  v_remaining := public.dining_bill_due(v_session.id) - public.dining_paid(v_session.id);
  -- The waiter confirms the exact figure on screen; a bill that moved since
  -- (a dish accepted, a phone payment landed) is refused, not guessed at.
  if p_amount is distinct from greatest(v_remaining, 0) then raise exception 'bill_changed'; end if;

  if v_remaining > 0 then
    insert into public.dining_payments (session_id, method, split_mode, amount, status, recorded_by, settled_at)
    values (v_session.id, 'cash', 'all', v_remaining, 'succeeded', p_staff_id, now());
    insert into public.order_payments (order_id, amount, method, collected_by)
    values (v_session.order_id, v_remaining, 'cash', 'restaurant');
  end if;

  v_closed := public.dining_try_close(v_session.id);
  if not v_closed then raise exception 'bill_changed'; end if;
  return jsonb_build_object('sessionId', v_session.id, 'amount', greatest(v_remaining, 0));
end $$;
revoke all on function public.record_dining_cash(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.record_dining_cash(uuid, uuid, integer) to service_role;

-- ── Staff: close a bill with nothing on it ───────────────────────────────
create or replace function public.close_empty_dining_bill(p_session_id uuid, p_staff_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_session public.dining_sessions%rowtype;
begin
  select * into v_session from public.dining_sessions
  where id = p_session_id and status in ('awaiting_staff','open') for update;
  if not found then raise exception 'session_not_open'; end if;
  if not public.dining_is_staff(v_session.restaurant_id, p_staff_id,
       array['owner','manager','cashier','waiter']) then
    raise exception 'staff_forbidden';
  end if;
  if v_session.order_id is not null then raise exception 'bill_not_empty'; end if;
  update public.dining_round_items i set status = 'rejected', rejection_reason = 'Addition fermée',
    decided_by = p_staff_id, decided_at = now()
  from public.dining_rounds r where r.id = i.round_id and r.session_id = v_session.id and i.status = 'pending';
  update public.dining_rounds set status = 'rejected' where session_id = v_session.id and status = 'pending';
  update public.dining_sessions set status = 'cancelled', closed_at = now() where id = v_session.id;
  update public.dining_guests set status = 'expired' where session_id = v_session.id and status in ('pending','approved');
  perform public.dining_release_tables(v_session.id);
  return v_session.id;
end $$;
revoke all on function public.close_empty_dining_bill(uuid, uuid) from public, anon, authenticated;
grant execute on function public.close_empty_dining_bill(uuid, uuid) to service_role;

-- Legacy whole-table payment (0054) now releases a table only when no other
-- bill sits on it.
create or replace function public.settle_online_order_payment(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype; v_restaurant_amount integer; v_restaurant_balance integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.status <> 'awaiting_customer' then raise exception 'order_not_payable'; end if;
  if v_order.is_paid then
    select balance into v_restaurant_balance from public.restaurant_wallets where restaurant_id = v_order.restaurant_id;
    return jsonb_build_object('alreadySettled', true,
      'restaurantAmount', greatest(v_order.total - v_order.service_charge, 0),
      'restaurantBalance', coalesce(v_restaurant_balance, 0));
  end if;
  v_restaurant_amount := greatest(v_order.total - v_order.service_charge, 0);
  perform public.wallet_credit(v_order.restaurant_id, v_restaurant_amount, 'payment',
    'Online order ' || v_order.reference, v_order.reference);
  if v_order.service_charge > 0 then
    insert into public.platform_revenue_ledger (source_type, source_id, restaurant_id, gross, amount, reference, note)
    values ('online_payment_fee', v_order.id, v_order.restaurant_id, v_order.total, v_order.service_charge,
      v_order.reference, 'Online payment service fee')
    on conflict (source_type, source_id) do nothing;
  end if;
  update public.orders set is_paid = true,
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
  return jsonb_build_object('alreadySettled', false, 'restaurantAmount', v_restaurant_amount,
    'restaurantBalance', coalesce(v_restaurant_balance, 0));
end $$;
revoke all on function public.settle_online_order_payment(uuid) from public, anon, authenticated;
grant execute on function public.settle_online_order_payment(uuid) to service_role;

-- ═════════════════════════════════════════════════════════════════════════
--  4. Voucher redemption
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.redeem_reservation_voucher(
  p_code text, p_staff_id uuid, p_session_id uuid default null, p_open_table_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_booking public.reservations%rowtype;
  v_session public.dining_sessions%rowtype;
  v_credit integer;
  v_day_end timestamptz;
  v_opened jsonb;
  v_session_id uuid;
begin
  select * into v_booking from public.reservations where voucher_code = upper(trim(p_code)) for update;
  if not found then raise exception 'voucher_not_found'; end if;
  if not public.dining_is_staff(v_booking.restaurant_id, p_staff_id,
       array['owner','manager','cashier','waiter']) then
    raise exception 'staff_forbidden';
  end if;
  if v_booking.voucher_redeemed_at is not null then raise exception 'voucher_used'; end if;
  if v_booking.status in ('cancelled','no_show','completed') then raise exception 'voucher_cancelled'; end if;
  if v_booking.status not in ('confirmed','seated') then raise exception 'voucher_not_confirmed'; end if;
  v_day_end := (date_trunc('day', v_booking.reserved_for at time zone 'Africa/Douala') + interval '1 day')
               at time zone 'Africa/Douala';
  if now() >= v_day_end then raise exception 'voucher_expired'; end if;
  if now() < v_booking.reserved_for - interval '2 hours' then raise exception 'voucher_too_early'; end if;

  -- A percentage deposit is collected at the table, so nothing was prepaid.
  v_credit := case when v_booking.deposit_paid and coalesce(v_booking.deposit_percent, 0) = 0
                   then greatest(coalesce(v_booking.deposit_amount, 0), 0) else 0 end;

  update public.reservations set voucher_redeemed_at = now(), voucher_redeemed_by = p_staff_id,
    status = 'seated'
  where id = v_booking.id;

  if p_session_id is not null then
    select * into v_session from public.dining_sessions
    where id = p_session_id and restaurant_id = v_booking.restaurant_id
      and status in ('awaiting_staff','open') for update;
    if not found then raise exception 'session_not_open'; end if;
    v_session_id := v_session.id;
  elsif p_open_table_id is not null then
    v_opened := public.staff_open_dining_bill(p_open_table_id, p_staff_id, v_booking.guest_name, v_booking.id);
    v_session_id := (v_opened->>'sessionId')::uuid;
  end if;

  if v_session_id is not null then
    update public.dining_sessions set deposit_credit = deposit_credit + v_credit,
      reservation_id = coalesce(reservation_id, v_booking.id)
    where id = v_session_id;
  end if;

  update public.restaurant_tables set status = 'occupied'
  where status in ('available','reserved') and (
    id = v_booking.table_id or id in (select table_id from public.reservation_tables where reservation_id = v_booking.id)
  );

  return jsonb_build_object('reservationId', v_booking.id, 'reference', v_booking.reference,
    'guestName', v_booking.guest_name, 'partySize', v_booking.party_size, 'credit', v_credit,
    'customerId', v_booking.customer_id, 'sessionId', v_session_id,
    'code', coalesce(v_opened->>'code', null));
end $$;
revoke all on function public.redeem_reservation_voucher(text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.redeem_reservation_voucher(text, uuid, uuid, uuid) to service_role;

-- ═════════════════════════════════════════════════════════════════════════
--  5. Reviews from a table visit, platform feedback
-- ═════════════════════════════════════════════════════════════════════════
alter table public.reviews
  add column if not exists dining_guest_id uuid references public.dining_guests(id) on delete set null,
  add column if not exists reservation_id uuid references public.reservations(id) on delete set null;
create unique index if not exists reviews_dining_guest_idx
  on public.reviews (dining_guest_id) where dining_guest_id is not null;
create unique index if not exists reviews_reservation_idx
  on public.reviews (reservation_id) where reservation_id is not null;

create table if not exists public.platform_feedback (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('dining','reservation','order','other')),
  rating integer check (rating is null or rating between 1 and 5),
  body text not null check (length(body) between 1 and 2000),
  restaurant_id uuid references public.restaurants(id) on delete set null,
  customer_id uuid references public.profiles(id) on delete set null,
  dining_guest_id uuid references public.dining_guests(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists platform_feedback_created_idx on public.platform_feedback (created_at desc);
alter table public.platform_feedback enable row level security;

-- ═════════════════════════════════════════════════════════════════════════
--  6. Live back office: new bills and payments bump the branch signal
-- ═════════════════════════════════════════════════════════════════════════
drop trigger if exists dining_sessions_signal on public.dining_sessions;
create trigger dining_sessions_signal
  after insert or update of status on public.dining_sessions
  for each row execute function public.signal_from_row();

create or replace function public.signal_from_dining_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.bump_restaurant_signal(
    (select s.restaurant_id from public.dining_sessions s where s.id = new.session_id)
  );
  return null;
end $$;

drop trigger if exists dining_payments_signal on public.dining_payments;
create trigger dining_payments_signal
  after insert or update of status on public.dining_payments
  for each row execute function public.signal_from_dining_payment();

-- ═════════════════════════════════════════════════════════════════════════
--  7. Platform reset (0067) knows the new activity tables — TRUNCATE
--     refuses a table still referenced by one it does not empty.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.platform_reset_activity(p_confirm text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_before jsonb;
  v_tables text[] := array[
    'order_items', 'order_payments', 'order_status_history', 'orders',
    'payment_attempts', 'payment_webhook_events', 'payments', 'camerpay_requests',
    'refunds', 'invoices', 'plan_changes', 'commission_statements',
    'notifications', 'broadcasts',
    'conversation_messages', 'conversations', 'support_messages',
    'reservation_tables', 'reservation_waitlist', 'reservations', 'review_photos', 'reviews',
    'loyalty_ledger', 'promotion_redemptions',
    'wallet_ledger', 'withdrawal_requests', 'withdrawal_fees',
    'customer_wallet_ledger', 'customer_wallets',
    'platform_fees', 'platform_revenue_ledger', 'platform_feedback',
    'dining_payments', 'dining_messages', 'dining_round_items', 'dining_rounds', 'dining_guests',
    'dining_guest_push_subscriptions', 'dining_guest_fcm_subscriptions', 'dining_sessions'
  ];
  v_existing text[] := '{}';
  v_table text;
begin
  if p_confirm is distinct from 'RESET' then
    raise exception 'confirmation_required';
  end if;

  v_before := public.platform_activity_counts();

  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is not null then
      v_existing := v_existing || format('public.%I', v_table);
    end if;
  end loop;

  execute 'truncate table ' || array_to_string(v_existing, ', ') || ' restart identity';

  update public.restaurant_wallets set balance = 0, updated_at = now() where balance <> 0;
  update public.restaurants set rating = 0, review_count = 0 where rating <> 0 or review_count <> 0;
  update public.restaurant_tables set status = 'available' where status = 'occupied';
  update public.promotions set used_count = 0 where used_count <> 0;
  if to_regclass('public.platform_coupons') is not null then
    execute 'update public.platform_coupons set used_count = 0 where used_count <> 0';
  end if;

  return jsonb_build_object('wiped', v_before, 'tables', array_length(v_existing, 1));
end
$$;
revoke all on function public.platform_reset_activity(text) from public, anon, authenticated;
grant execute on function public.platform_reset_activity(text) to service_role;

notify pgrst, 'reload schema';

-- Verify:
--   select key, value from public.settings where key in ('reservation_max_days_ahead','order_schedule_max_days');
--   select count(*) filter (where voucher_code is null) as missing_codes from public.reservations
--     where status in ('pending','awaiting_payment','confirmed','seated');   -- 0
--   select proname from pg_proc where proname in ('open_dining_bill','join_dining_bill','start_dining_payment',
--     'settle_dining_payment','record_dining_cash','redeem_reservation_voucher');   -- 6 rows
