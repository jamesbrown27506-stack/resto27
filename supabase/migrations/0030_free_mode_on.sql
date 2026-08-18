-- ═══════════════════════════════════════════════════════════════════════════
--  0030 — Free mode on: the platform is completely free for now
--
--  `platform_free_mode` (seeded `false` in 0005) grants every tenant the
--  PAID-TIER limits — not Starter — for as long as it stays `true`. This
--  migration flips it on: subscriptions cost nothing until an admin turns it
--  back off in /a/settings → Billing.
--
--  The flag is read by `fetchPlanLimits()` (entitlements: menu/tables/
--  promotions ceilings, analytics, staff management) and by the plan-gate
--  screens, which are suppressed while free mode is on. Suspension still
--  overrides everything (§5).
--
--  Turning it off later is a single `update` in the SQL editor, or the toggle
--  in the admin settings form — nothing in this migration needs reverting.
-- ═══════════════════════════════════════════════════════════════════════════

update public.settings
set value = 'true'
where key = 'platform_free_mode';

-- ── Verify ────────────────────────────────────────────────────────────────

select key, value
from public.settings
where key in ('platform_free_mode', 'platform_free_mode_until')
order by key;