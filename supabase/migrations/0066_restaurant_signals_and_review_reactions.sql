-- 0066 — live "something changed" signal per restaurant; review read/reactions;
--        colour palette setting
--
-- ─────────────────────────────────────────────────────────────────────────
--  1. RESTAURANT SIGNALS (Vercel CPU).
--
--  The back office polled Vercel on a clock: nav badges every 15 s, the
--  orders queue every 30 s, the kitchen every 15 s — ~360 function calls an
--  hour for ONE open screen, most of them answering "nothing new". That was
--  the single biggest line in the CPU budget.
--
--  Now the DATABASE says when to look. `restaurant_signals` holds one row per
--  restaurant with a counter; triggers bump it whenever something the back
--  office counts changes (orders, bookings, table requests, chats). Screens
--  subscribe to their branch's row through Supabase Realtime — which costs
--  Vercel nothing — and re-read only when it moves. A quiet hour is zero
--  calls; the old polling stays only as a slow safety net.
--
--  The row carries NO business data (an id, a number, a time), and RLS lets
--  only that branch's active staff read it (is_staff_of, 0034). The orders
--  table itself stays unreadable to browsers, as before.
--
--  2. REVIEWS: "read" and quick reactions.
--
--  The dashboard's "N avis sans réponse" only cleared with a written reply.
--  `restaurant_seen_at` lets staff acknowledge a review; `restaurant_reaction`
--  (heart / thanks / like) is a one-tap public answer the customer is told
--  about. A reaction answers a 3★+ review; a 1–2★ review still wants a
--  written reply or an explicit "read".
--
--  3. `color_palette` — classic | ndole (Appearance → Palette).
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Signals ────────────────────────────────────────────────────────────
create table if not exists public.restaurant_signals (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  version bigint not null default 0,
  changed_at timestamptz not null default now()
);

alter table public.restaurant_signals enable row level security;

drop policy if exists "staff read their restaurant signal" on public.restaurant_signals;
create policy "staff read their restaurant signal" on public.restaurant_signals
  for select to authenticated
  using (public.is_staff_of(restaurant_id));

create or replace function public.bump_restaurant_signal(p_restaurant_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_restaurant_id is null then return; end if;
  insert into public.restaurant_signals (restaurant_id, version, changed_at)
  values (p_restaurant_id, 1, now())
  on conflict (restaurant_id) do update
    set version = public.restaurant_signals.version + 1, changed_at = now();
end
$$;
revoke all on function public.bump_restaurant_signal(uuid) from public, anon, authenticated;

-- Direct tables: the row names its restaurant.
create or replace function public.signal_from_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- NEW does not exist on DELETE, OLD not on INSERT: pick by operation.
  if tg_op = 'DELETE' then
    perform public.bump_restaurant_signal(old.restaurant_id);
  else
    perform public.bump_restaurant_signal(new.restaurant_id);
  end if;
  return null;
end
$$;

-- Table service: guests and dish requests reach the restaurant via the session.
create or replace function public.signal_from_dining_guest()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_session uuid;
begin
  -- Only the executed branch touches NEW or OLD.
  if tg_op = 'DELETE' then
    v_session := old.session_id;
  else
    v_session := new.session_id;
  end if;
  perform public.bump_restaurant_signal(
    (select s.restaurant_id from public.dining_sessions s where s.id = v_session)
  );
  return null;
end
$$;

create or replace function public.signal_from_dining_item()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_round uuid;
begin
  if tg_op = 'DELETE' then
    v_round := old.round_id;
  else
    v_round := new.round_id;
  end if;
  perform public.bump_restaurant_signal(
    (select s.restaurant_id
     from public.dining_rounds r
     join public.dining_sessions s on s.id = r.session_id
     where r.id = v_round)
  );
  return null;
end
$$;

drop trigger if exists orders_signal on public.orders;
create trigger orders_signal
  after insert or delete or update of status, is_paid, delivery_fee_set_at on public.orders
  for each row execute function public.signal_from_row();

drop trigger if exists reservations_signal on public.reservations;
create trigger reservations_signal
  after insert or delete or update of status, deposit_paid, table_id on public.reservations
  for each row execute function public.signal_from_row();

drop trigger if exists conversations_signal on public.conversations;
create trigger conversations_signal
  after insert or update of staff_unread, status on public.conversations
  -- Insert/update only, so NEW always exists (an INSERT trigger may not
  -- mention OLD). Platform threads (restaurant_id null) signal nobody.
  for each row when (new.restaurant_id is not null)
  execute function public.signal_from_row();

do $$
begin
  if to_regclass('public.dining_guests') is not null then
    execute 'drop trigger if exists dining_guests_signal on public.dining_guests';
    execute 'create trigger dining_guests_signal after insert or update of status on public.dining_guests
             for each row execute function public.signal_from_dining_guest()';
  end if;
  if to_regclass('public.dining_round_items') is not null then
    execute 'drop trigger if exists dining_items_signal on public.dining_round_items';
    execute 'create trigger dining_items_signal after insert or update of status on public.dining_round_items
             for each row execute function public.signal_from_dining_item()';
  end if;
end
$$;

-- Realtime delivers changes of this table (and only this new one).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'restaurant_signals'
     ) then
    alter publication supabase_realtime add table public.restaurant_signals;
  end if;
end
$$;

-- ── 2. Review read / reactions ────────────────────────────────────────────
alter table public.reviews
  add column if not exists restaurant_seen_at timestamptz,
  add column if not exists restaurant_reaction text,
  add column if not exists restaurant_reacted_at timestamptz;

alter table public.reviews drop constraint if exists reviews_restaurant_reaction_check;
alter table public.reviews add constraint reviews_restaurant_reaction_check
  check (restaurant_reaction is null or restaurant_reaction in ('heart', 'thanks', 'like'));

-- ── 3. Palette setting ────────────────────────────────────────────────────
insert into public.settings (key, value, value_type, category, label, description)
values ('color_palette', 'classic', 'string', 'appearance', 'Colour palette',
        'classic = original sage; ndole = appetite palette (chilli orange actions, deep green brand). Change it in Appearance → Palette.')
on conflict (key) do nothing;

-- The API (PostgREST) caches the column list: without a reload it can keep
-- answering "column not found" (PGRST204) for the new review columns.
notify pgrst, 'reload schema';

-- Verify:
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime';  -- includes restaurant_signals
--   select column_name from information_schema.columns where table_name = 'reviews' and column_name like 'restaurant_%';
