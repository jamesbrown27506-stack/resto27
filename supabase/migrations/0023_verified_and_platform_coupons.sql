-- ═══════════════════════════════════════════════════════════════════════════
--  0023 — Verified badge + platform coupon codes
--
--  Two small trust / growth features in one file:
--
--   1. restaurants.is_verified — the platform marks a restaurant as verified
--      (a public badge), toggled by an admin from /a/restaurants. A badge is
--      earned, never bought, so it is a boolean an admin sets — not a plan
--      perk. Defaults to false.
--
--   2. platform_coupons — codes the PLATFORM runs, unlike the restaurant
--      promotions table (0006) which a branch owns. Applied at checkout as a
--      fallback when no restaurant code matches, and only while the
--      `platform_coupons_enabled` setting is true (an on/off kill switch for
--      the whole programme).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Verified badge ───────────────────────────────────────────────────

alter table public.restaurants
  add column if not exists is_verified boolean not null default false;

-- ── 2. Platform coupons ─────────────────────────────────────────────────

create table if not exists public.platform_coupons (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  label          text not null default '',

  discount_type  text not null check (discount_type in ('percent', 'fixed')),
  -- Percent: 1–100. Fixed: whole XAF. One column — a coupon has one value.
  discount_value integer not null check (discount_value > 0),

  min_order      integer not null default 0 check (min_order >= 0),
  -- Caps a percentage discount in francs. Null = uncapped.
  max_discount   integer check (max_discount > 0),

  starts_at      timestamptz,
  ends_at        timestamptz,
  usage_limit    integer check (usage_limit > 0),
  used_count     integer not null default 0 check (used_count >= 0),
  is_active      boolean not null default true,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists platform_coupons_active_idx on public.platform_coupons (code) where is_active;

alter table public.platform_coupons enable row level security;

-- No policies on purpose: the publishable key can touch nothing here. Every
-- read (checkout validation) and write (the /a/coupons admin screens) goes
-- through the service-role client, exactly like promotions.

insert into public.settings (key, value, value_type, category, label, description)
values
  ('platform_coupons_enabled', 'false', 'boolean', 'payments', 'Platform coupon codes',
   'Off = only restaurant-owned promotions apply. On = platform codes (e.g. WELCOME10) are also accepted at checkout.')
on conflict (key) do nothing;

-- ── Verify ────────────────────────────────────────────────────────────────

-- Expect one row, with rowsecurity = true.
select count(*) as platform_coupons_rls
from pg_tables
where schemaname = 'public' and tablename = 'platform_coupons' and rowsecurity;
