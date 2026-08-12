-- ═══════════════════════════════════════════════════════════════════════════
--  0009 — Plan prices
--
--  0004 seeded these with `on conflict (tier) do nothing`, so the rows already
--  exist and re-running 0004 will not change them. This sets the real prices.
--
--    Starter       0 FCFA   free forever
--    Professional  10 000 FCFA / month
--    Enterprise    25 000 FCFA / month
--
--  Whole francs. XAF has no minor unit (§4).
--
--  Commission rates are UNCHANGED and deliberately fall as the plan rises:
--  a tenant paying more per month pays less per order, which is the whole
--  argument for upgrading.
-- ═══════════════════════════════════════════════════════════════════════════

update public.subscription_plans set monthly_price = 0     where tier = 'starter';
update public.subscription_plans set monthly_price = 10000  where tier = 'professional';
update public.subscription_plans set monthly_price = 25000  where tier = 'enterprise';

-- Enterprise is the flagship, so it carries the badge on /pricing.
update public.subscription_plans set is_featured = (tier = 'professional');


-- What each plan gives. Adjust freely — these are read live by /pricing,
-- /m/billing and the limit checks, so changing a number here changes the
-- product with no deploy.
select tier, name, monthly_price, commission_rate,
       menu_item_limit, table_limit, promotion_limit,
       staff_management, analytics
from public.subscription_plans
order by sort_order;
