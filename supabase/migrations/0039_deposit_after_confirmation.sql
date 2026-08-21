-- ═══════════════════════════════════════════════════════════════════════════
--  0039 — Take the deposit AFTER the restaurant says yes, and repair
--         customer_preferences
--
--  RUN THIS AS WELL AS 0038. Both are idempotent and order does not matter.
--
--  ⚠ AGAINST THE PROJECT THE APP TALKS TO. Check first:
--      select current_database(), count(*) from public.restaurants;
--
--  ─────────────────────────────────────────────────────────────────────────
--  1. `awaiting_payment` — CHARGING BEFORE A TABLE EXISTS IS THE BUG.
--
--  The booking flow took the customer's money the moment they pressed the
--  button, while the request was still `pending` and nobody at the restaurant
--  had seen it. So a restaurant that was full declined a booking it had never
--  agreed to — and the customer had already paid for it. That leaves a refund
--  to chase for a table that never existed, which is the worst possible first
--  experience of the platform and a support cost on every single decline.
--
--  The order is now: request (free) → the restaurant decides → if it says yes
--  AND asks for a deposit, the booking becomes `awaiting_payment` and the
--  customer is told to pay → paying makes it `confirmed`. A decline costs
--  nobody anything, because nothing was ever taken.
--
--  `awaiting_payment` counts against a table's availability exactly like
--  `pending` and `confirmed` do: the restaurant has committed the seat and is
--  waiting to be paid for it, so it must not be sold twice in the meantime.
--  ─────────────────────────────────────────────────────────────────────────
--  2. `customer_preferences.push_enabled` — MISSING, AND SILENTLY SO.
--
--  Migration 0018 adds it. It is absent from the live database, and both the
--  read and the write name it — so `fetchCustomerPreferences` fell back to the
--  defaults on every load and `saveOwnPreferences` failed on every save with
--  42703. The table is empty because no customer's notification preference has
--  ever been stored, and the screen showed defaults each time rather than
--  admitting it had saved nothing.
--
--  The application code no longer depends on the column — the per-topic push
--  answer lives inside notification_json now — but it is still written for the
--  benefit of any older build pointed at the same database, so it has to
--  exist.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The new reservation status ──────────────────────────────────────────
-- Dropped and recreated rather than added: 0006 created it inline with six
-- values, so there is already a constraint of this name to replace.
alter table public.reservations
  drop constraint if exists reservations_status_check;

alter table public.reservations
  add constraint reservations_status_check
    check (status in (
      'pending',
      'awaiting_payment',
      'confirmed',
      'seated',
      'completed',
      'cancelled',
      'no_show'
    ));

-- ── 2. The column every customer preference save was failing on ────────────
alter table public.customer_preferences
  add column if not exists push_enabled boolean not null default true;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect one row, and its definition must mention awaiting_payment.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.reservations'::regclass
  and conname = 'reservations_status_check';

-- Expect one row.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'customer_preferences'
  and column_name = 'push_enabled';
