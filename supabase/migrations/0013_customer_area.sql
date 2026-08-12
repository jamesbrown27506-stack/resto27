-- ═══════════════════════════════════════════════════════════════════════════
--  0013 — The customer's own data: addresses, favourites, loyalty
--
--  ─────────────────────────────────────────────────────────────────────────
--   Everything the diner-facing area rendered was a fixture in TypeScript.
--   These are the three tables it needed and never had. Orders, reservations
--   and reviews already exist (0005) and simply were not being read.
--  ─────────────────────────────────────────────────────────────────────────
--
--  Run after 0012. Idempotent — safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  1. Delivery addresses
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.customer_addresses (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete cascade,

  -- "Maison", "Bureau" — the customer's own word for the place.
  label          text not null default 'Domicile',

  -- Snapshotted per address, not read from the profile. Deliveries go to a
  -- receptionist, a spouse, a neighbour; the account holder is often not the
  -- person who takes the bag.
  recipient_name text,
  phone          text,

  address_line   text not null,
  quartier_id    uuid references public.quartiers(id) on delete set null,

  -- ─────────────────────────────────────────────────────────────────────────
  --  THE MOST IMPORTANT COLUMN ON THIS TABLE.
  --
  --  Street addressing in Cameroonian cities is not how people are found. A
  --  rider is directed by what is visible: "en face de la pharmacie Bonamoussadi",
  --  "derrière le carrefour Ndokoti". An address form without this field
  --  produces deliveries that need a phone call every single time.
  -- ─────────────────────────────────────────────────────────────────────────
  landmark       text,

  notes          text,

  is_default     boolean not null default false,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists customer_addresses_profile_idx
  on public.customer_addresses (profile_id, created_at desc);

-- At most ONE default per person, enforced by the database rather than by
-- remembering to clear the old one in application code.
create unique index if not exists customer_addresses_one_default_idx
  on public.customer_addresses (profile_id) where is_default;

drop trigger if exists set_updated_at on public.customer_addresses;
create trigger set_updated_at before update on public.customer_addresses
  for each row execute function public.set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
--  2. Favourites
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.favorites (
  profile_id    uuid not null references public.profiles(id)    on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (profile_id, restaurant_id)
);

-- "Who favourited this restaurant" — for the manager's own counts later.
create index if not exists favorites_restaurant_idx on public.favorites (restaurant_id);


-- ═══════════════════════════════════════════════════════════════════════════
--  3. Loyalty
--
--  ─────────────────────────────────────────────────────────────────────────
--   A LEDGER, NOT A BALANCE COLUMN.
--
--   `orders` already carries loyalty_points_used and loyalty_value, so the
--   scheme was designed for — it just had nowhere to record the other half.
--
--   Storing a single `points` integer on the profile would make the balance
--   unauditable: a customer disputing "I had 400 points" could only be
--   answered with the current number, which is the number they are disputing.
--   Every movement is a row, and the balance is their sum — so the answer to
--   "where did they go" is always on screen.
--
--   Points are SIGNED: earning is positive, redeeming negative. One column,
--   no sign conventions to get backwards in a later query.
--  ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.loyalty_ledger (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,

  -- Where it came from. Both nullable: an administrative goodwill adjustment
  -- belongs to no order and no restaurant.
  order_id      uuid references public.orders(id)      on delete set null,
  restaurant_id uuid references public.restaurants(id) on delete set null,

  points        integer not null check (points <> 0),

  kind          text not null default 'earn'
                  check (kind in ('earn', 'redeem', 'adjust', 'expire', 'refund')),

  -- Human-readable, snapshotted. "Commande CMD-4F2A1B" survives the order row
  -- being anonymised (§12 rule 7).
  note          text not null default '',

  created_at    timestamptz not null default now()
);

create index if not exists loyalty_ledger_profile_idx
  on public.loyalty_ledger (profile_id, created_at desc);

-- One earn row per order, so a retried checkout cannot pay points twice.
create unique index if not exists loyalty_ledger_one_earn_per_order_idx
  on public.loyalty_ledger (order_id) where kind = 'earn' and order_id is not null;


-- ── The balance, summed in the database ──
-- PostgREST cannot express SUM, and a client that fetches the whole ledger to
-- add it up is a client that can be told the wrong number by a slow page.
drop function if exists public.loyalty_balance(uuid);

create function public.loyalty_balance(p_profile uuid)
returns integer
language sql
stable
as $$
  select coalesce(sum(points), 0)::integer
  from public.loyalty_ledger
  where profile_id = p_profile
$$;

revoke all on function public.loyalty_balance(uuid) from public, anon, authenticated;
grant execute on function public.loyalty_balance(uuid) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
--  4. The loyalty rules live in `settings`, not in code
--
--  How many points a thousand francs earns, and what a point is worth back,
--  are commercial dials an administrator turns — not constants that need a
--  deploy. Same table the service charge already uses.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.settings (key, value, value_type, category, label, description)
values
  ('loyalty_enabled', 'true', 'boolean', 'loyalty', 'Programme de fidélité',
   'Active le cumul et l''utilisation des points.'),
  ('loyalty_points_per_1000', '10', 'integer', 'loyalty', 'Points par 1 000 FCFA',
   'Points gagnés pour chaque tranche de 1 000 FCFA dépensée, hors frais de livraison.'),
  ('loyalty_point_value', '5', 'integer', 'loyalty', 'Valeur d''un point (FCFA)',
   'Montant déduit par point utilisé.'),
  ('loyalty_min_redeem', '100', 'integer', 'loyalty', 'Minimum utilisable',
   'Nombre de points minimum pour pouvoir les utiliser.')
on conflict (key) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
--  5. Access
--
--  Deny by default, like every other table here. Reads and writes go through
--  the server with the service-role key, scoped to the profile resolved from
--  the session — the same boundary the manager area uses, one level up.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.customer_addresses enable row level security;
alter table public.favorites          enable row level security;
alter table public.loyalty_ledger     enable row level security;


-- ═══════════════════════════════════════════════════════════════════════════
--  6. Indexes the customer area leans on
-- ═══════════════════════════════════════════════════════════════════════════

-- "My orders", newest first.
create index if not exists orders_customer_created_idx
  on public.orders (customer_id, created_at desc) where customer_id is not null;

-- "My bookings" and "my reviews".
create index if not exists reservations_customer_idx
  on public.reservations (customer_id, reserved_for desc) where customer_id is not null;

create index if not exists reviews_customer_idx
  on public.reviews (customer_id, created_at desc) where customer_id is not null;
