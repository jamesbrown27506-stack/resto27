-- ═══════════════════════════════════════════════════════════════════════════
--  0032 — Delivery mode, platform delivery fee, and home page logo
--
--  Three changes:
--
--   1. `restaurants.has_own_delivery` — does this restaurant have its own
--      delivery riders? When false, the platform manages delivery and the
--      admin sets the fee. Shown during onboarding and editable on /m/profile.
--
--   2. `restaurants.platform_delivery_fee` — the admin-set delivery fee for
--      restaurants that do NOT have their own delivery. Whole XAF. 0 = free
--      delivery by the platform. Only meaningful when has_own_delivery = false.
--
--   3. `settings.platform_delivery_fee` — the global default delivery fee
--      for platform-managed delivery. The admin sets this from /a/settings.
--      Individual restaurants can override via the per-restaurant column.
--
--   4. The home page restaurant card will show the logo instead of the cover
--      image — a code change, no migration needed, but documented here for
--      context.
--
--  RLS: no changes — columns on tables already locked down.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.restaurants
  add column if not exists has_own_delivery boolean not null default true;

alter table public.restaurants
  add column if not exists platform_delivery_fee integer not null default 0
    check (platform_delivery_fee >= 0);

-- Backfill existing restaurants: assume they have their own delivery (the
-- current behaviour — the restaurant quotes the fee on confirm). New
-- restaurants get asked during onboarding.
-- No backfill needed — default true matches the existing behavior.

-- Global default delivery fee for platform-managed delivery.
insert into public.settings (key, value, value_type, category, label, description)
values (
  'platform_delivery_fee',
  '1500',
  'integer',
  'operations',
  'Platform delivery fee',
  'Default delivery fee (XAF) for restaurants that use platform delivery. Admin sets this; restaurants without their own riders are charged this amount.'
)
on conflict (key) do nothing;


-- ── Verify ────────────────────────────────────────────────────────────────

-- Expect two rows with the new columns.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'restaurants'
  and column_name in ('has_own_delivery', 'platform_delivery_fee')
order by column_name;

-- Expect one row with the new setting.
select key, value, value_type
from public.settings
where key = 'platform_delivery_fee';
