-- ═══════════════════════════════════════════════════════════════════════════
--  0038 — Reservation fee per seat, and everything 0037 was going to do
--
--  RUN THIS ONE. IT REPLACES 0037.
--
--  0037 was written to be pasted into the SQL editor and never was — the first
--  attempt went to a different Supabase project and failed on statement one
--  with `42P01: relation "public.restaurants" does not exist`. The editor runs
--  a script as a single transaction, so that attempt rolled back whole: nothing
--  from 0037 is half-applied anywhere, and this file can safely restate it.
--
--  Everything here is `if not exists` or `on conflict do nothing`, so running
--  it after 0037 is a no-op and running it twice is harmless.
--
--  ⚠ RUN IT AGAINST THE PROJECT THE APP TALKS TO. Check first:
--
--      select current_database(), count(*) from public.restaurants;
--
--  If that errors, the project picker is on the wrong project.
--
--  ─────────────────────────────────────────────────────────────────────────
--  WHAT IS NEW HERE: 'per_seat'.
--
--  A reservation fee had two shapes, and neither fits how a dining room is
--  actually held. A FIXED fee charges the same to hold a two-top as a table of
--  ten, so it is either too small to deter a no-show on the big table or too
--  large to bother booking the small one. A PERCENT fee cannot be charged at
--  booking at all, because the bill does not exist yet.
--
--  'per_seat' is an amount in FCFA MULTIPLIED BY THE PARTY SIZE, charged
--  online at booking like a fixed fee and deducted from the final bill the
--  same way. It scales with exactly the thing the restaurant is risking: the
--  seats it is holding empty.
--  ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Reservation fee type ───────────────────────────────────────────────────
-- `fixed`    = an amount in FCFA, charged online at booking.
-- `per_seat` = an amount in FCFA per guest, × party size, charged online.
-- `percent`  = a share of the final bill, collected at the restaurant.
alter table public.restaurants
  add column if not exists deposit_type text not null default 'fixed';

-- The constraint is dropped and recreated rather than added, because 0031 and
-- 0037 both create it WITHOUT 'per_seat'. `if exists` covers the database that
-- never had it; naming it explicitly means a re-run replaces it rather than
-- accumulating a second one.
alter table public.restaurants
  drop constraint if exists restaurants_deposit_type_check;

alter table public.restaurants
  add constraint restaurants_deposit_type_check
    check (deposit_type in ('fixed', 'percent', 'per_seat'));

-- The percentage SNAPSHOT on the booking itself: a restaurant that changes its
-- rate afterwards must not rewrite what an existing customer booked under.
-- (`deposit_amount` on the booking already snapshots the CHARGED total, which
-- for a per-seat fee is the per-guest rate multiplied by the party size.)
alter table public.reservations
  add column if not exists deposit_percent integer not null default 0
    check (deposit_percent >= 0 and deposit_percent <= 100);

-- ── Payment attempts settle two kinds of thing ─────────────────────────────
-- A subscription invoice, or a reservation deposit. Until these exist EVERY
-- payment attempt fails to record — subscription invoices included, not just
-- reservation deposits — because initiatePaymentAttempt writes both columns
-- unconditionally. Guarded so a database missing the table is skipped cleanly
-- rather than aborting everything after it.
do $$
begin
  if to_regclass('public.payment_attempts') is not null then
    alter table public.payment_attempts alter column invoice_id drop not null;

    alter table public.payment_attempts
      add column if not exists kind text not null default 'subscription'
        check (kind in ('subscription', 'reservation'));

    alter table public.payment_attempts
      add column if not exists reservation_id uuid
        references public.reservations(id) on delete cascade;

    create index if not exists payment_attempts_reservation_idx
      on public.payment_attempts (reservation_id)
      where reservation_id is not null;
  end if;
end $$;

-- ── Settings 0031 introduced ───────────────────────────────────────────────
-- Insert-if-missing, never an update: a bare update would reverse an admin who
-- had already changed one of these, every time the file is re-run.
delete from public.settings where key = 'platform_free_mode_until';

insert into public.settings (key, value, value_type, category, label, description)
values
  ('platform_free_mode_days', '30', 'integer', 'billing',
   'Free mode duration (days)',
   'The platform is free until this many days after the value was last saved. 0 = no countdown.'),
  ('payment_mode', 'sandbox', 'string', 'payments',
   'Payment mode',
   'sandbox = simulated payments (no money moves). live = real charges through CamerPay. Switch to live only once the provider is verified end to end.')
on conflict (key) do nothing;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect four rows.
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'reservations'     and column_name = 'deposit_percent') or
    (table_name = 'restaurants'      and column_name = 'deposit_type') or
    (table_name = 'payment_attempts' and column_name in ('kind', 'reservation_id'))
  )
order by table_name, column_name;

-- Expect one row, and it must mention per_seat.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.restaurants'::regclass
  and conname = 'restaurants_deposit_type_check';

-- Expect two rows.
select key, value
from public.settings
where key in ('platform_free_mode_days', 'payment_mode')
order by key;
