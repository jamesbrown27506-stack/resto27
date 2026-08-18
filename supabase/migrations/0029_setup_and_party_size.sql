-- ═══════════════════════════════════════════════════════════════════════════
--  0029 — First-login setup + table order party size
--
--  Two unrelated changes, one migration:
--
--   1. `restaurants.setup_done_at` — a brand-new restaurant (approved, but
--      with no tables yet) is sent through a short setup wizard on its first
--      visit to /m before the dashboard. The flag marks the wizard finished;
--      `null` means "still needs it".
--
--      EXISTING TENANTS ARE BACKFILLED, not sent through the wizard: a
--      restaurant that already has tables or dishes is clearly operating, and
--      forcing onboarding on them would be a nag, not a welcome.
--
--   2. `orders.party_size` — how many people are sitting at the table when a
--      waiter takes a dine-in order. The table itself stays a single unit
--      (a party of 3 at a 5-seat table IS the table — the free seats are not
--      separately sellable), but the kitchen, the ticket and the floor
--      overview benefit from knowing the count.
--
--  RLS: no policy changes — columns on tables already locked down.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.restaurants
  add column if not exists setup_done_at timestamptz;

-- Backfill: anyone already running (tables OR dishes) is done with setup.
update public.restaurants
set setup_done_at = now()
where setup_done_at is null
  and (
    exists (select 1 from public.restaurant_tables t where t.restaurant_id = public.restaurants.id)
    or exists (select 1 from public.menu_items i where i.restaurant_id = public.restaurants.id)
  );

alter table public.orders
  add column if not exists party_size integer check (party_size > 0);

-- ── Verify ────────────────────────────────────────────────────────────────

-- Expect one row with the new column.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'restaurants' and column_name = 'setup_done_at';

-- Expect one row with the new column.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'orders' and column_name = 'party_size';

-- Expect zero rows: every active tenant is marked done.
select count(*) as pending_setup
from public.restaurants
where status = 'active' and setup_done_at is null;