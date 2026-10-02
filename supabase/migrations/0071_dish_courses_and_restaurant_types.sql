-- 0071 — dish courses and more restaurant types
--
-- ─────────────────────────────────────────────────────────────────────────
--  1. menu_items.course — the platform's four kinds of dish, one vocabulary
--     for every menu so a customer can browse "Boissons" across Douala
--     whatever each restaurant named its own sections:
--
--       light    petit-déjeuner, en-cas, entrées
--       main     plats principaux
--       dessert  desserts & douceurs (après le repas)
--       drink    boissons
--
--     NULL means "not chosen": the app infers it from the dish name and its
--     section (lib/menu/course.ts), so every existing dish is already
--     browsable without anyone re-tagging a menu. The manager's choice, once
--     made, always wins. The app reads and writes this column on its own and
--     keeps working before this migration is run.
--
--  2. Three more restaurant types for the setup wizard's "what kind of
--     place are you?" step, next to the six seeded in 0003: ice cream and
--     desserts, drinks and bar, breakfast and snacks.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.menu_items
  add column if not exists course text;

alter table public.menu_items drop constraint if exists menu_items_course_check;
alter table public.menu_items add constraint menu_items_course_check
  check (course is null or course in ('light', 'main', 'dessert', 'drink'));

insert into public.cuisines (name, sort_order)
values
  ('Glaces & desserts',       7),
  ('Boissons & bar',          8),
  ('Petit-déjeuner & snacks', 9)
on conflict (name) do nothing;

-- Verify
select count(*) filter (where course is not null) as dishes_with_course, count(*) as dishes
from public.menu_items;
select name, sort_order, is_active from public.cuisines order by sort_order;
