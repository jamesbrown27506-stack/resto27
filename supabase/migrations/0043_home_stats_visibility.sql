-- ═══════════════════════════════════════════════════════════════════════════
--  0043 — Per-figure visibility for the landing page statistics
--
--  Safe to run more than once; every insert is `on conflict (key) do nothing`,
--  so it never overwrites a choice an admin has since made.
--
--  ⚠ AGAINST THE PROJECT THE APP TALKS TO. Check first:
--      select current_database(), count(*) from public.restaurants;
--
--  ─────────────────────────────────────────────────────────────────────────
--  "1 RESTAURANT" IS AN HONEST NUMBER THAT TALKS PEOPLE OUT OF ORDERING.
--
--  The homepage advertises four figures. Two of them measure the SIZE of the
--  platform — how many restaurants, how many orders delivered — and two
--  measure its QUALITY: the average rating and the average delivery time.
--  Only the second pair reads well while the directory is small.
--
--  FOUR ROWS, NOT ONE MASTER SWITCH. The problem is per-figure. A single
--  switch would force an admin to throw away the two numbers that flatter in
--  order to suppress the two that do not, which is the exact bind this is
--  fixing. Four rows also mean the restaurant count returns on its own merits
--  the day there are twenty of them, with no second gate to remember.
--
--  "Hide the whole band" needs no row of its own: it is all four being off,
--  and the strip then renders nothing rather than an empty bordered band.
--
--  SEEDED OFF FOR THE COUNTS, ON FOR THE AVERAGES — the state the platform
--  actually wants on the day this ships, so the migration itself fixes the
--  complaint with no admin action. The same defaults are compiled into
--  src/lib/home-stats.ts, so a database that never runs this renders the
--  identical homepage; it just offers no switches.
--
--  New category `homepage`. `settings.category` is free text and the admin
--  screen builds its tab strip from the categories present, so this adds a
--  "Home page" tab beside the existing ones with no code change.
--  ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.settings (key, value, value_type, category, label, description)
values
  ('home_stat_restaurants', 'false', 'boolean', 'homepage',
   'Show the restaurant count',
   'The number of active restaurants, on the landing page. Off while the directory is small — a visitor who learns there is one restaurant has learned something true and unhelpful.'),

  ('home_stat_orders', 'false', 'boolean', 'homepage',
   'Show the delivered-order count',
   'How many orders have been delivered, on the landing page. Off until the number is one worth advertising.'),

  ('home_stat_rating', 'true', 'boolean', 'homepage',
   'Show the average rating',
   'The mean rating across active restaurants. Good marketing at any scale, so this is on by default.'),

  ('home_stat_delivery', 'true', 'boolean', 'homepage',
   'Show the average delivery time',
   'The mean delivery estimate across restaurants that deliver. Good marketing at any scale, so this is on by default.')
on conflict (key) do nothing;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect four rows: two false, two true.
select key, value, category
from public.settings
where key like 'home\_stat\_%'
order by key;
