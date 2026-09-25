-- 0063 — super administrators, and a choice of Cameroon payment gateway
--
-- ─────────────────────────────────────────────────────────────────────────
--  1. SUPER ADMINISTRATORS.
--
--  `profiles.role = 'admin'` runs the platform day to day (restaurants,
--  users, support, reviews). A SUPER admin additionally holds the switches
--  that move money or change how the platform works: payment gateway and
--  mode, fees, refund destination, wallet adjustments, payouts, the cron
--  secret, impersonation — and who is an administrator at all. Enforced in
--  the server actions (lib/auth/session.ts requireSuperAdmin); this column
--  is the flag they read.
--
--  Every administrator that exists when this runs becomes a super admin, so
--  nobody loses access; new administrators start as simple admins unless a
--  super admin says otherwise.
--
--  2. PAYMENT GATEWAYS (Cameroon only).
--
--  Collections (customers paying) and payouts (refunds, restaurant
--  withdrawals) each go through one gateway, chosen here by a super admin:
--    camerpay — the original integration (default).
--    saspay   — docs.saspay.me; keys in SASPAY_API_KEY / SASPAY_WEBHOOK_SECRET.
--  They are separate switches because SasPay payouts require a whitelisted
--  server IP, which Vercel does not provide by default — a platform may well
--  collect through SasPay and pay out through CamerPay.
--  Every attempt, refund and withdrawal remembers the gateway it went
--  through, so flipping a switch never strands money already in flight.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists is_super_admin boolean not null default false;

update public.profiles
set is_super_admin = true
where role = 'admin' and is_super_admin = false;

insert into public.settings (key, value, value_type, category, label, description)
values
  ('payment_provider_collect', 'camerpay', 'string', 'payments',
   'Collection gateway (Cameroon)',
   'Which gateway charges customers: camerpay or saspay. Change it from Payments → Gateways (super admins only).'),
  ('payment_provider_payout', 'camerpay', 'string', 'payments',
   'Payout gateway (Cameroon)',
   'Which gateway sends refunds and restaurant withdrawals: camerpay or saspay. SasPay payouts need the server IP whitelisted in the SasPay dashboard.')
on conflict (key) do nothing;

alter table public.settings
  drop constraint if exists settings_payment_provider_check;
alter table public.settings
  add constraint settings_payment_provider_check
  check (
    key not in ('payment_provider_collect', 'payment_provider_payout')
    or value in ('camerpay', 'saspay')
  );

-- Verify: every admin is super; both gateway rows exist.
select role, is_super_admin, count(*) from public.profiles where role = 'admin' group by 1, 2;
select key, value from public.settings where key like 'payment_provider_%';
