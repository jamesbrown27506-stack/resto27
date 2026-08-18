-- ═══════════════════════════════════════════════════════════════════════════
--  0031 — Payments everywhere + free-mode countdown
--
--  Four changes, one migration:
--
--   1. `settings.platform_free_mode_days` — the free mode countdown. The old
--      `platform_free_mode_until` was a free-text string an admin could type
--      anything into; the end date is now COMPUTED: setting the days row
--      stamps its `updated_at`, and the countdown ends exactly
--      `updated_at + days` later. One number to maintain, nothing to mis-type.
--
--   2. `settings.payment_mode` — the sandbox/live switch the whole payment
--      stack reads. `'sandbox'` simulates every charge; `'live'` calls the
--      CamerPay API for real money. Seeded to `'sandbox'`: a fresh deployment
--      must never take real money until an admin says so.
--
--   3. `restaurants.deposit_type` — the reservation fee is either a FIXED
--      amount (existing `deposit_amount`, in FCFA) or a PERCENTAGE of the
--      customer's final bill (the number in `deposit_amount` is then a %).
--      The customer is told the deposit is deducted from their bill.
--
--   4. `payment_attempts.kind` + `reservation_id` — an attempt settles either
--      a subscription (invoice_id) or a reservation deposit (reservation_id),
--      and `invoice_id` is now nullable because a deposit has no invoice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Free mode countdown ────────────────────────────────────────────────

delete from public.settings where key = 'platform_free_mode_until';

insert into public.settings (key, value, value_type, category, label, description)
values (
  'platform_free_mode_days',
  '30',
  'integer',
  'billing',
  'Free mode duration (days)',
  'The platform is free until this many days after the value was last saved. 0 = no countdown.'
)
on conflict (key) do nothing;

-- ── 2. Payment mode ───────────────────────────────────────────────────────

insert into public.settings (key, value, value_type, category, label, description)
values (
  'payment_mode',
  'sandbox',
  'string',
  'payments',
  'Payment mode',
  'sandbox = simulated payments (no money moves). live = real charges through CamerPay. Switch to live only once the provider is verified end to end.'
)
on conflict (key) do nothing;

-- ── 3. Reservation fee type ───────────────────────────────────────────────

alter table public.restaurants
  add column if not exists deposit_type text not null default 'fixed'
    check (deposit_type in ('fixed', 'percent'));

-- The reservation snapshot gets the restaurant's percentage too, so the board
-- still reads the value the customer booked under if the restaurant changes
-- its fee afterwards (same snapshot rule as deposit_amount, migration 0025).
alter table public.reservations
  add column if not exists deposit_percent integer not null default 0
    check (deposit_percent >= 0 and deposit_percent <= 100);

-- ── 4. Payment attempts settle two kinds of thing ─────────────────────────

alter table public.payment_attempts
  alter column invoice_id drop not null;

alter table public.payment_attempts
  add column if not exists kind text not null default 'subscription'
    check (kind in ('subscription', 'reservation')),
  add column if not exists reservation_id uuid references public.reservations(id) on delete cascade;

create index if not exists payment_attempts_reservation_idx
  on public.payment_attempts (reservation_id)
  where reservation_id is not null;

-- ── Verify ────────────────────────────────────────────────────────────────

select key, value, value_type, category
from public.settings
where key in ('platform_free_mode_days', 'payment_mode')
order by key;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('restaurants', 'reservations', 'payment_attempts')
  and column_name in ('deposit_type', 'deposit_percent', 'kind', 'reservation_id', 'invoice_id')
order by table_name, column_name;