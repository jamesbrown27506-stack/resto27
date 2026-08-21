-- ═══════════════════════════════════════════════════════════════════════════
--  0037 — Catch-up: the half of 0031 this database never got
--
--  0033 was meant to be the one-paste catch-up for 0030–0032, and it was run —
--  but only partly. Probing the live database on 2026-08-21 found 0032's
--  columns present and 0031's absent:
--
--    MISSING   restaurants.deposit_type
--    MISSING   reservations.deposit_percent
--    MISSING   payment_attempts.kind
--    MISSING   payment_attempts.reservation_id
--    MISSING   settings.platform_free_mode_days
--    MISSING   settings.payment_mode
--    present   restaurants.has_own_delivery
--    present   restaurants.platform_delivery_fee
--    present   settings.platform_delivery_fee
--
--  WHAT THE ABSENCE ACTUALLY DID.
--
--  `createOwnReservation` selected `deposit_type` alongside `id` and `status`
--  in one query. PostgREST answers a select naming a column that does not
--  exist with 42703 for every row, so the query failed for EVERY restaurant —
--  and the caller collapsed "query failed" and "no such restaurant" into one
--  message. Every attempt to book a table came back "Restaurant introuvable."
--  while the same restaurant's menu was orderable in the next tab.
--
--  The application code has since been made to survive all four of these
--  (see customer-actions.ts): the fee falls back to fixed, and the booking is
--  retried without the percentage snapshot. That keeps bookings working; it
--  does not give the platform percentage fees, live-mode payment attempts, or
--  the free-mode countdown back. Running this does.
--
--  SAFE ON ANY DATABASE, AND SAFE TO RUN MORE THAN ONCE:
--    · every column add is `if not exists`
--    · every settings insert is `on conflict (key) do nothing`, so it never
--      overwrites a value an admin has since changed
--    · the payment_attempts block is guarded by a table-exists check
--
--  Paste the whole file into the Supabase SQL editor and run it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Reservation fee type ───────────────────────────────────────────────────
-- `fixed`   = an amount in FCFA, charged online at booking.
-- `percent` = a share of the final bill, collected at the restaurant.
alter table public.restaurants
  add column if not exists deposit_type text not null default 'fixed'
    check (deposit_type in ('fixed', 'percent'));

-- The percentage SNAPSHOT on the booking itself: a restaurant that changes its
-- rate afterwards must not rewrite what an existing customer booked under.
alter table public.reservations
  add column if not exists deposit_percent integer not null default 0
    check (deposit_percent >= 0 and deposit_percent <= 100);

-- ── Payment attempts settle two kinds of thing ─────────────────────────────
-- A subscription invoice, or a reservation deposit. Guarded so a database
-- missing the table is skipped cleanly rather than aborting the script.
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
-- Insert-if-missing, never an update: a bare update would reverse an admin
-- who had already changed one of these, every time the file is re-run.
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

-- Expect two rows.
select key, value
from public.settings
where key in ('platform_free_mode_days', 'payment_mode')
order by key;
