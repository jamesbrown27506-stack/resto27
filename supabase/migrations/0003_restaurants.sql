-- ═══════════════════════════════════════════════════════════════════════════
--  0003 — The restaurant domain
--
--  Replaces src/lib/fixtures/restaurants.ts. Six tables:
--
--    service_areas      city / currency / timezone
--    quartiers          neighbourhoods within a service area
--    cuisines           the cuisine list
--    restaurants        tenants — AND branches (§3)
--    restaurant_hours   opening hours per weekday
--    restaurant_tables  physical tables (manager-only, not public)
--
--  `cuisines` and `quartiers` exist as TABLES rather than as the hardcoded
--  arrays the fixture used, because both are edited from the admin panel and
--  both are used in address forms. A constant in a TypeScript file cannot be
--  edited by an administrator at 9pm on a Friday.
--
--  Run this in the Supabase SQL editor. Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

-- Postgres has no ON UPDATE CURRENT_TIMESTAMP (§16), so it is a trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  1. Lookups
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.service_areas (
  id                 uuid primary key default gen_random_uuid(),
  city               text        not null,
  country            text        not null default 'CM',
  -- Kept per-area, not global: opening a second country means a second
  -- currency, and money is stored in whole minor units of *some* currency.
  currency           text        not null default 'XAF',
  timezone           text        not null default 'Africa/Douala',
  accepting_signups  boolean     not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (city, country)
);

create table if not exists public.quartiers (
  id               uuid primary key default gen_random_uuid(),
  service_area_id  uuid        not null references public.service_areas(id) on delete cascade,
  name             text        not null,
  sort_order       integer     not null default 0,
  is_active        boolean     not null default true,
  created_at       timestamptz not null default now(),
  unique (service_area_id, name)
);

create table if not exists public.cuisines (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null unique,
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);


-- ═══════════════════════════════════════════════════════════════════════════
--  2. Restaurants
--
--  BRANCHES ARE ROWS HERE, NOT A SEPARATE TABLE (§3). A restaurant with three
--  locations is three rows sharing an owner_id, distinguished by branch_label,
--  one flagged is_primary. Everything downstream — menu, orders, staff,
--  subscription — hangs off a branch, which is what you want: branches
--  genuinely have different menus and different staff.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.restaurants (
  id                     uuid primary key default gen_random_uuid(),

  -- NULLABLE FOR NOW, deliberately.
  -- Manager onboarding does not exist yet, so the seeded restaurants have no
  -- owner. Make this NOT NULL once a manager can claim one — an unowned
  -- restaurant is a tenant nobody can operate.
  -- on delete restrict, never cascade: deleting a user must never take a
  -- restaurant's entire sales history with it (§12 rule 7).
  owner_id               uuid references public.profiles(id) on delete restrict,

  slug                   text        not null unique,
  name                   text        not null,
  branch_label           text        not null default 'Principal',
  is_primary             boolean     not null default true,

  status                 text        not null default 'pending'
                           check (status in ('active', 'pending', 'suspended')),

  cuisine_id             uuid        references public.cuisines(id)     on delete set null,
  quartier_id            uuid        references public.quartiers(id)    on delete set null,
  service_area_id        uuid not null references public.service_areas(id) on delete restrict,

  description            text        not null default '',
  phone                  text,
  address_line           text,
  logo_url               text,
  cover_url              text,

  -- Denormalised, maintained when a review is written. Kept on the row so the
  -- directory can sort by rating without aggregating over reviews per query.
  rating                 numeric(2,1) not null default 0 check (rating >= 0 and rating <= 5),
  review_count           integer      not null default 0 check (review_count >= 0),

  -- INDICATIVE ONLY. The real delivery fee is QUOTED by the restaurant when it
  -- confirms an order (§4) — there is deliberately no fee column here.
  delivery_estimate_min  integer     not null default 30 check (delivery_estimate_min > 0),
  minimum_order          integer     not null default 0 check (minimum_order >= 0),  -- whole XAF

  accepts_delivery       boolean     not null default true,
  accepts_pickup         boolean     not null default true,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists public.restaurant_hours (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid    not null references public.restaurants(id) on delete cascade,
  weekday        integer not null check (weekday between 0 and 6),   -- 0 = Sunday
  -- NULL/NULL means closed that day. Storing a closed day explicitly beats
  -- inferring it from a missing row: "we have no data" and "we are shut" are
  -- different answers.
  opens_at       time,
  closes_at      time,
  unique (restaurant_id, weekday)
);

create table if not exists public.restaurant_tables (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid    not null references public.restaurants(id) on delete cascade,
  number         text    not null,
  capacity       integer not null check (capacity > 0),
  status         text    not null default 'available'
                   check (status in ('available', 'occupied', 'reserved', 'out_of_service')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, number)
);


-- ═══════════════════════════════════════════════════════════════════════════
--  3. Indexes
-- ═══════════════════════════════════════════════════════════════════════════

-- Directory filters.
create index if not exists restaurants_status_idx       on public.restaurants (status);
create index if not exists restaurants_service_area_idx on public.restaurants (service_area_id);
create index if not exists restaurants_quartier_idx     on public.restaurants (quartier_id);
create index if not exists restaurants_cuisine_idx      on public.restaurants (cuisine_id);
create index if not exists restaurants_owner_idx        on public.restaurants (owner_id);
create index if not exists restaurants_rating_idx       on public.restaurants (rating desc);

-- Text search. §16: "LIKE '%x%' search → pg_trgm + GIN. The restaurant search
-- will thank you." A leading-wildcard LIKE cannot use a btree index at all.
create index if not exists restaurants_search_idx
  on public.restaurants
  using gin ((name || ' ' || coalesce(description, '')) gin_trgm_ops);

create index if not exists restaurant_hours_restaurant_idx  on public.restaurant_hours (restaurant_id);
create index if not exists restaurant_tables_restaurant_idx on public.restaurant_tables (restaurant_id);
create index if not exists quartiers_service_area_idx       on public.quartiers (service_area_id);


-- ═══════════════════════════════════════════════════════════════════════════
--  4. updated_at triggers
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists set_updated_at on public.restaurants;
create trigger set_updated_at before update on public.restaurants
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.restaurant_tables;
create trigger set_updated_at before update on public.restaurant_tables
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.service_areas;
create trigger set_updated_at before update on public.service_areas
  for each row execute function public.set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
--  5. Row Level Security
--
--  RLS ON EVERY TABLE, DENY BY DEFAULT (B.1). Tables created by migration do
--  NOT get RLS automatically — only ones made through the dashboard do. Skip
--  this and these tables are readable by anyone holding the publishable key,
--  which is in your JavaScript bundle.
--
--  Read policies below are intentionally narrow. There is no INSERT, UPDATE or
--  DELETE policy anywhere here: all writes go through the server, which uses
--  the connection string or the secret key and bypasses RLS. Authorization
--  lives in lib/auth, not in SQL — expressing 20 capabilities × 5 branch roles
--  as policies would be unreadable, untestable, and duplicated (B.1).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.service_areas     enable row level security;
alter table public.quartiers         enable row level security;
alter table public.cuisines          enable row level security;
alter table public.restaurants       enable row level security;
alter table public.restaurant_hours  enable row level security;
alter table public.restaurant_tables enable row level security;

-- Lookups are public reference data.
drop policy if exists "service areas are public" on public.service_areas;
create policy "service areas are public" on public.service_areas
  for select to anon, authenticated using (true);

drop policy if exists "active quartiers are public" on public.quartiers;
create policy "active quartiers are public" on public.quartiers
  for select to anon, authenticated using (is_active);

drop policy if exists "active cuisines are public" on public.cuisines;
create policy "active cuisines are public" on public.cuisines
  for select to anon, authenticated using (is_active);

-- ONLY ACTIVE RESTAURANTS ARE VISIBLE.
-- A pending application or a suspended tenant must not be discoverable — not
-- in the directory, not by guessing a slug, not in the sitemap.
drop policy if exists "active restaurants are public" on public.restaurants;
create policy "active restaurants are public" on public.restaurants
  for select to anon, authenticated using (status = 'active');

-- Hours follow their restaurant's visibility.
drop policy if exists "hours follow restaurant visibility" on public.restaurant_hours;
create policy "hours follow restaurant visibility" on public.restaurant_hours
  for select to anon, authenticated using (
    exists (
      select 1 from public.restaurants r
      where r.id = restaurant_hours.restaurant_id and r.status = 'active'
    )
  );

-- restaurant_tables gets NO policy. Table occupancy is operational data for
-- staff, not something a diner should be able to read. RLS enabled with no
-- policy = nothing gets through except the server.


-- ═══════════════════════════════════════════════════════════════════════════
--  6. Seed
--
--  Ported from src/lib/fixtures/restaurants.ts so the existing pages render
--  identically against real data.
--
--  The restaurants below are SCAFFOLDING — they exist so the public site has
--  something to show before manager onboarding is built. Delete them once real
--  tenants sign up; §7 at the bottom has the statement.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.service_areas (city, country, currency, timezone, accepting_signups)
values
  ('Douala',  'CM', 'XAF', 'Africa/Douala', true),
  ('Yaoundé', 'CM', 'XAF', 'Africa/Douala', false)
on conflict (city, country) do nothing;

insert into public.cuisines (name, sort_order)
values
  ('Camerounaise', 1),
  ('Grillades',    2),
  ('Poisson',      3),
  ('Continentale', 4),
  ('Fast-food',    5),
  ('Pâtisserie',   6)
on conflict (name) do nothing;

insert into public.quartiers (service_area_id, name, sort_order)
select sa.id, q.name, q.sort_order
from public.service_areas sa
cross join (values
  ('Akwa', 1), ('Bonanjo', 2), ('Bonapriso', 3), ('Bonamoussadi', 4),
  ('Deido', 5), ('Makepe', 6), ('Ndokotti', 7), ('Logbessou', 8)
) as q(name, sort_order)
where sa.city = 'Douala'
on conflict (service_area_id, name) do nothing;

-- Restaurants. Joined to the lookups by name so no UUID is ever hardcoded.
insert into public.restaurants (
  slug, name, branch_label, is_primary, status,
  cuisine_id, quartier_id, service_area_id,
  description, phone,
  rating, review_count, delivery_estimate_min, minimum_order,
  accepts_delivery, accepts_pickup, created_at
)
select
  d.slug, d.name, d.branch_label, d.is_primary, d.status,
  c.id, q.id, sa.id,
  d.description, d.phone,
  d.rating, d.review_count, d.delivery_estimate_min, d.minimum_order,
  d.accepts_delivery, d.accepts_pickup, d.created_at
from (values
  ('chez-marcel-akwa', 'Chez Marcel', 'Akwa', true, 'active',
   'Camerounaise', 'Akwa',
   'La cuisine camerounaise de tous les jours, préparée au feu de bois. Le Poulet DG de Marcel est une institution à Akwa depuis 1998.',
   '+237 6 99 11 22 33', 4.6, 218, 35, 3000, true, true, '2025-03-12T09:00:00Z'::timestamptz),

  ('chez-marcel-bonapriso', 'Chez Marcel', 'Bonapriso', false, 'active',
   'Camerounaise', 'Bonapriso',
   'La deuxième adresse de Marcel, avec une carte plus courte et une terrasse ouverte le soir.',
   '+237 6 99 11 22 34', 4.4, 64, 30, 3000, true, true, '2026-01-08T09:00:00Z'::timestamptz),

  ('le-ndole-dor', 'Le Ndolé d''Or', 'Bonanjo', true, 'active',
   'Camerounaise', 'Bonanjo',
   'Spécialiste du ndolé aux crevettes et du poisson braisé. Service rapide le midi pour les bureaux de Bonanjo.',
   '+237 6 77 45 66 88', 4.8, 341, 25, 2500, true, true, '2025-06-02T09:00:00Z'::timestamptz),

  ('mami-nyanga', 'Mami Nyanga', 'Makepe', true, 'active',
   'Grillades', 'Makepe',
   'Soya, brochettes et poisson braisé au charbon. Ouvert tard, ambiance de quartier.',
   '+237 6 55 09 87 12', 4.3, 127, 40, 2000, true, true, '2025-09-19T09:00:00Z'::timestamptz),

  ('la-terrasse-bonamoussadi', 'La Terrasse', 'Bonamoussadi', true, 'active',
   'Continentale', 'Bonamoussadi',
   'Cuisine continentale et camerounaise revisitée. Cadre calme, idéal pour un déjeuner d''affaires.',
   '+237 6 90 33 44 55', 4.1, 89, 45, 5000, true, false, '2025-11-27T09:00:00Z'::timestamptz),

  ('poisson-braise-deido', 'Poisson Braisé Deido', 'Deido', true, 'active',
   'Poisson', 'Deido',
   'Poisson frais du jour, braisé devant vous. Miondo, plantain et sauce piquante.',
   '+237 6 71 22 88 99', 4.7, 203, 30, 2500, true, true, '2025-04-30T09:00:00Z'::timestamptz),

  -- Deliberately pending: proves the RLS policy hides it from the public site
  -- while it still shows in the admin approval queue.
  ('eru-house', 'Eru House', 'Bonamoussadi', true, 'pending',
   'Camerounaise', 'Bonamoussadi',
   'Spécialités du Sud-Ouest : eru, achu, kwacoco. En attente de validation.',
   '+237 6 78 12 34 90', 0, 0, 40, 3000, true, true, '2026-07-30T14:22:00Z'::timestamptz)
) as d(
  slug, name, branch_label, is_primary, status,
  cuisine_name, quartier_name, description, phone,
  rating, review_count, delivery_estimate_min, minimum_order,
  accepts_delivery, accepts_pickup, created_at
)
join public.service_areas sa on sa.city = 'Douala'
left join public.cuisines  c  on c.name = d.cuisine_name
left join public.quartiers q  on q.name = d.quartier_name and q.service_area_id = sa.id
on conflict (slug) do nothing;

-- Hours: Mon–Thu 11:00–22:30, Fri–Sat 11:00–23:30, Sun 12:00–21:00.
insert into public.restaurant_hours (restaurant_id, weekday, opens_at, closes_at)
select r.id, h.weekday, h.opens_at::time, h.closes_at::time
from public.restaurants r
cross join (values
  (0, '12:00', '21:00'),
  (1, '11:00', '22:30'),
  (2, '11:00', '22:30'),
  (3, '11:00', '22:30'),
  (4, '11:00', '22:30'),
  (5, '11:00', '23:30'),
  (6, '11:00', '23:30')
) as h(weekday, opens_at, closes_at)
on conflict (restaurant_id, weekday) do nothing;

-- Tables, for Chez Marcel Akwa only — enough to exercise the manager screens.
insert into public.restaurant_tables (restaurant_id, number, capacity, status)
select r.id, t.number, t.capacity, t.status
from public.restaurants r
cross join (values
  ('1', 2, 'available'),
  ('2', 2, 'occupied'),
  ('3', 4, 'available'),
  ('4', 4, 'reserved'),
  ('5', 6, 'occupied'),
  ('6', 8, 'available'),
  ('Terrasse 1', 4, 'available'),
  ('Terrasse 2', 4, 'out_of_service')
) as t(number, capacity, status)
where r.slug = 'chez-marcel-akwa'
on conflict (restaurant_id, number) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
--  7. Verify
-- ═══════════════════════════════════════════════════════════════════════════

select
  r.slug,
  r.name,
  r.branch_label,
  r.status,
  c.name as cuisine,
  q.name as quartier,
  r.rating,
  r.minimum_order,
  (select count(*) from public.restaurant_hours h where h.restaurant_id = r.id) as hours_rows
from public.restaurants r
left join public.cuisines  c on c.id = r.cuisine_id
left join public.quartiers q on q.id = r.quartier_id
order by r.name, r.branch_label;
-- Expect 7 rows, 6 active + 1 pending, each with hours_rows = 7.

-- Every table must report rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('service_areas','quartiers','cuisines',
                    'restaurants','restaurant_hours','restaurant_tables')
order by tablename;


-- ═══════════════════════════════════════════════════════════════════════════
--  8. Removing the scaffolding, later
--
--    delete from public.restaurants where owner_id is null;
--
--  Hours and tables cascade. Once real tenants exist, tighten the column:
--
--    alter table public.restaurants alter column owner_id set not null;
-- ═══════════════════════════════════════════════════════════════════════════
