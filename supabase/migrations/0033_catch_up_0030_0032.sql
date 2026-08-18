-- ═══════════════════════════════════════════════════════════════════════════
--  0033 — Catch-up: apply 0030 + 0031 + 0032 in one idempotent pass
--
--  A database that never ran migrations 0030, 0031 and 0032 throws at runtime:
--
--    · [manager:fetchReservations] column reservations.deposit_percent does not exist
--    · the same for deposit_type, has_own_delivery, platform_delivery_fee,
--      payment_mode, platform_free_mode_days …
--
--  because the application code — already deployed — reads and writes those
--  columns and settings. This file re-applies all three migrations at once so
--  there is a single thing to paste into the Supabase SQL editor.
--
--  SAFE ON ANY DATABASE, AND SAFE TO RUN MORE THAN ONCE:
--    · every column add is `if not exists`
--    · every settings insert is `on conflict (key) do nothing`, so it never
--      overwrites a value an admin has since changed
--    · the payment_attempts changes are guarded by a table-exists check, so a
--      database missing that table is skipped rather than aborting the script
--
--  This does NOT supersede 0030–0032; those remain the canonical history. This
--  is only the convenience file for a DB that skipped them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0030 — Free mode on ────────────────────────────────────────────────────
-- Insert-if-missing, never an update: a bare `update … set value = 'true'`
-- would turn a live platform free again every time this catch-up file is
-- pasted into the SQL editor, silently reversing an admin who had switched
-- free mode off. A database that reached 0005 already has the row, so the
-- flip 0030 performed is deliberately NOT repeated here — free mode is a
-- toggle in /a/settings → Billing, and the admin owns it from now on.
insert into public.settings (key, value, value_type, category, label, description)
values (
  'platform_free_mode', 'true', 'boolean', 'billing', 'Free mode',
  'Grants PAID-TIER limits, not Starter. Suspension still overrides it.'
)
on conflict (key) do nothing;

-- ── 0031 — Free-mode countdown + payment mode ──────────────────────────────
-- The old free-text end date is replaced by a days-based countdown.
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

-- ── 0031 — Reservation fee type ────────────────────────────────────────────
alter table public.restaurants
  add column if not exists deposit_type text not null default 'fixed'
    check (deposit_type in ('fixed', 'percent'));

-- THIS is the column whose absence throws [manager:fetchReservations].
alter table public.reservations
  add column if not exists deposit_percent integer not null default 0
    check (deposit_percent >= 0 and deposit_percent <= 100);

-- ── 0031 — Payment attempts settle two kinds of thing ──────────────────────
-- Guarded: only runs if the table exists, so a partial database is skipped
-- cleanly instead of aborting everything after it.
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

-- ── 0032 — Delivery mode + platform delivery fee ───────────────────────────
alter table public.restaurants
  add column if not exists has_own_delivery boolean not null default true;

alter table public.restaurants
  add column if not exists platform_delivery_fee integer not null default 0
    check (platform_delivery_fee >= 0);

insert into public.settings (key, value, value_type, category, label, description)
values
  ('platform_delivery_fee', '1500', 'integer', 'operations',
   'Platform delivery fee',
   'Default delivery fee (XAF) for restaurants that use platform delivery. Admin sets this; restaurants without their own riders are charged this amount.')
on conflict (key) do nothing;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect six rows: reservations.deposit_percent, restaurants.deposit_type,
-- restaurants.has_own_delivery, restaurants.platform_delivery_fee,
-- payment_attempts.kind, payment_attempts.reservation_id.
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'reservations'     and column_name = 'deposit_percent') or
    (table_name = 'restaurants'      and column_name in ('deposit_type', 'has_own_delivery', 'platform_delivery_fee')) or
    (table_name = 'payment_attempts' and column_name in ('kind', 'reservation_id'))
  )
order by table_name, column_name;

-- Expect four rows.
select key, value
from public.settings
where key in ('platform_free_mode', 'platform_free_mode_days', 'payment_mode', 'platform_delivery_fee')
order by key;
