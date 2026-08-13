-- ═══════════════════════════════════════════════════════════════════════════
--  0025 — Reservation deposits
--
--  The no-show problem, made payable: a restaurant can require an acompte to
--  hold a table. 0 = no deposit required.
--
--    · restaurants.deposit_amount      — the default the restaurant asks for,
--      set from the manager reservations screen.
--    · reservations.deposit_amount     — snapshotted at booking time (the
--      restaurant may change its price after the customer booked).
--    · reservations.deposit_paid       — true once the money has actually been
--      received. Marking it collected credits the restaurant's wallet through
--      the same credit path every payment uses (migration 0024).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.restaurants
  add column if not exists deposit_amount integer not null default 0 check (deposit_amount >= 0);

alter table public.reservations
  add column if not exists deposit_amount integer not null default 0 check (deposit_amount >= 0),
  add column if not exists deposit_paid boolean not null default false;
