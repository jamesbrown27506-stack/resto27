-- ═══════════════════════════════════════════════════════════════════════════
--  0006 — Everything the restaurant needs
--
--  The manager and their staff: who works here, what is on the menu, who is
--  booked in tonight, and what is on offer.
--
--  Run this AFTER 0005. It is idempotent — every object is created with
--  `if not exists` or dropped first, so re-running repairs a partial run
--  rather than failing on the first duplicate.
--
--  ─────────────────────────────────────────────────────────────────────────
--   THE ONE IDEA THIS FILE IS BUILT ON (§2)
--
--   `profiles.role = 'manager'` means ONLY "this person works at a
--   restaurant". It grants nothing. Real permission comes from
--   restaurant_staff.role, PER BRANCH — the same person can be owner in Akwa
--   and waiter in Bonapriso, and the two must never be flattened onto their
--   account. Every policy below reads restaurant_staff, never profiles.role.
--  ─────────────────────────────────────────────────────────────────────────
--
--  Money is INTEGER, whole francs. XAF has no minor unit; a numeric price
--  column invites 2 500,50 FCFA, which does not exist.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  1. Who is asking? — helpers used by every policy below
--
--  SECURITY DEFINER on purpose. A policy on restaurant_staff that queries
--  restaurant_staff recurses infinitely; running the lookup as the definer
--  steps outside RLS and breaks the cycle. `set search_path` is not optional
--  on a definer function — without it, a caller can shadow `public` with their
--  own schema and have the function resolve their tables instead of ours.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  -- auth.uid() is a uuid; profiles.auth_user_id is TEXT, deliberately (0001):
  -- keeping the provider's id as text is what makes swapping identity
  -- providers a one-column change. The cast is therefore permanent, not a
  -- workaround — every policy in 0001 does the same.
  select id from public.profiles
  where auth_user_id = auth.uid()::text and deleted_at is null
  limit 1;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where auth_user_id = auth.uid()::text
      and role = 'admin'
      and status = 'active'
      and deleted_at is null
  );
$$;

-- The three BRANCH-ROLE helpers live in section 2.5, after the table they
-- read. `language sql` bodies are parsed when the function is created, so
-- declaring them here would fail on a fresh database with "relation
-- public.restaurant_staff does not exist". The two above only touch
-- `profiles`, which 0001 already created.


-- ═══════════════════════════════════════════════════════════════════════════
--  2. Staff
--
--  A row is a PERSON AT A BRANCH. Three states, and the difference matters:
--
--    invited    — an email has been sent, no account has claimed it yet.
--                 profile_id is null. This is why profile_id is nullable.
--    active     — working here now.
--    suspended  — kept, not deleted. Removing the row would orphan every
--                 order and status change they recorded (§12 rule 7); the
--                 history has to keep naming someone.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.restaurant_staff (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,

  -- Null until an invitation is accepted. on delete cascade is right here and
  -- nowhere else in this file: an employment record for a deleted person is
  -- not history worth keeping, and the orders they touched snapshot their name
  -- rather than referencing this row.
  profile_id     uuid references public.profiles(id) on delete cascade,

  role           text not null default 'waiter'
                   check (role in ('owner', 'manager', 'kitchen', 'cashier', 'waiter')),
  status         text not null default 'invited'
                   check (status in ('invited', 'active', 'suspended')),

  -- ── Invitation ──
  -- The address invited, kept even after acceptance: it is how the invite is
  -- matched, and it answers "who did we send this to" months later.
  invited_email  text,
  invited_by     uuid references public.profiles(id) on delete set null,
  -- Single-use and expiring. Long-lived invite links get forwarded.
  invite_token   text unique,
  invite_expires timestamptz,
  invited_at     timestamptz,
  accepted_at    timestamptz,

  -- Snapshot, for the staff list to render before an invite is accepted.
  display_name   text,

  last_active_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- One row per person per branch. Two roles at the same branch is not a state
  -- the capability matrix can answer.
  unique (restaurant_id, profile_id)
);

create index if not exists restaurant_staff_restaurant_idx on public.restaurant_staff (restaurant_id);
create index if not exists restaurant_staff_profile_idx    on public.restaurant_staff (profile_id);
create index if not exists restaurant_staff_token_idx      on public.restaurant_staff (invite_token)
  where invite_token is not null;

-- One OPEN invite per address per branch. The unique constraint above cannot
-- cover this: profile_id is null while an invite is outstanding, and NULL
-- never conflicts with NULL. Without this, clicking "Invite" twice sends two
-- links and creates two rows the acceptance flow would then race over.
create unique index if not exists restaurant_staff_open_invite_idx
  on public.restaurant_staff (restaurant_id, lower(invited_email))
  where status = 'invited' and invited_email is not null;

drop trigger if exists set_updated_at on public.restaurant_staff;
create trigger set_updated_at before update on public.restaurant_staff
  for each row execute function public.set_updated_at();


/**
 * The owner is staff of their own restaurant, automatically.
 *
 * Without this, a freshly approved restaurant has an owner_id and NO staff
 * row — so `staff_role_at()` returns null and the owner is locked out of their
 * own dashboard by the very policies meant to protect it. Doing it in a
 * trigger rather than in application code means it cannot be forgotten by a
 * second code path (signup, admin creation, a future import).
 */
create or replace function public.ensure_owner_is_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is not null then
    insert into public.restaurant_staff (restaurant_id, profile_id, role, status, accepted_at)
    values (new.id, new.owner_id, 'owner', 'active', now())
    on conflict (restaurant_id, profile_id) do update
      set role = 'owner', status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_owner_is_staff on public.restaurants;
create trigger ensure_owner_is_staff
  after insert or update of owner_id on public.restaurants
  for each row execute function public.ensure_owner_is_staff();


-- ═══════════════════════════════════════════════════════════════════════════
--  2.5 Who works where? — the branch-role helpers
--
--  Declared HERE, not with the others in section 1, because they read
--  restaurant_staff and a `language sql` body is validated at creation time.
--
--  SECURITY DEFINER is what makes them usable inside RLS at all: a policy ON
--  restaurant_staff that queries restaurant_staff recurses forever. Running
--  the lookup as the definer steps outside RLS and breaks the cycle.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * The caller's role AT ONE BRANCH, or null if they do not work there.
 *
 * Returns null rather than raising for an unknown restaurant: policies read
 * more clearly as `staff_role_at(x) is not null` than as an exception handler.
 */
create or replace function public.staff_role_at(target uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.role
  from public.restaurant_staff s
  where s.restaurant_id = target
    and s.profile_id = public.current_profile_id()
    and s.status = 'active'
  limit 1;
$$;

create or replace function public.is_staff_of(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.staff_role_at(target) is not null;
$$;

/** Owner or manager — the two roles that may change the branch's setup. */
create or replace function public.can_manage(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.staff_role_at(target) in ('owner', 'manager');
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  3. Menu — categories → items → option groups → options (§3)
--
--  OPTIONS ARE TWO LEVELS, and this is the part most ports get wrong.
--  A GROUP ("Taille", "Suppléments") carries min_select / max_select /
--  is_required; each OPTION inside carries a price delta. Flattening this to
--  one list of checkboxes cannot express "choose exactly one size", which is
--  the single most common thing a menu needs to say.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.menu_categories (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  name           text not null,
  -- A lucide icon name. Stored as text rather than an enum so adding an icon
  -- is a data change; an unknown name falls back in the UI.
  icon           text not null default 'UtensilsCrossed',
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, name)
);

create index if not exists menu_categories_restaurant_idx
  on public.menu_categories (restaurant_id, sort_order);

drop trigger if exists set_updated_at on public.menu_categories;
create trigger set_updated_at before update on public.menu_categories
  for each row execute function public.set_updated_at();


create table if not exists public.menu_items (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  -- on delete set null: deleting a category must not delete the food. An
  -- uncategorised item is visible and fixable; a silently deleted menu is not.
  category_id    uuid references public.menu_categories(id) on delete set null,

  name           text not null,
  description    text not null default '',
  price          integer not null check (price >= 0),   -- whole XAF
  image_url      text,

  is_available   boolean not null default true,
  is_featured    boolean not null default false,
  prep_minutes   integer not null default 15 check (prep_minutes >= 0),

  -- ── Stock, optional per item ──
  -- Most Cameroonian menus do not count portions; the ones that do care a
  -- great deal. track_stock off means the two columns below are ignored
  -- entirely rather than quietly meaning zero.
  track_stock          boolean not null default false,
  stock_quantity       integer check (stock_quantity >= 0),
  low_stock_threshold  integer check (low_stock_threshold >= 0),

  -- Comma-separated, DENORMALISED ON PURPOSE (§3). These are display filters
  -- and are never joined on; a junction table for "contient de l'arachide"
  -- buys nothing and costs a query.
  dietary_tags   text not null default '',
  allergens      text not null default '',

  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists menu_items_restaurant_idx on public.menu_items (restaurant_id, sort_order);
create index if not exists menu_items_category_idx   on public.menu_items (category_id);
create index if not exists menu_items_available_idx  on public.menu_items (restaurant_id)
  where is_available;
-- The manager's "running low" panel reads exactly this.
create index if not exists menu_items_low_stock_idx  on public.menu_items (restaurant_id)
  where track_stock;

drop trigger if exists set_updated_at on public.menu_items;
create trigger set_updated_at before update on public.menu_items
  for each row execute function public.set_updated_at();


create table if not exists public.menu_option_groups (
  id            uuid primary key default gen_random_uuid(),
  menu_item_id  uuid not null references public.menu_items(id) on delete cascade,
  name          text not null,

  min_select    integer not null default 0 check (min_select >= 0),
  max_select    integer not null default 1 check (max_select >= 1),
  is_required   boolean not null default false,

  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- max below min is not a menu, it is a form nobody can submit.
  constraint menu_option_groups_range check (max_select >= min_select)
);

create index if not exists menu_option_groups_item_idx
  on public.menu_option_groups (menu_item_id, sort_order);

drop trigger if exists set_updated_at on public.menu_option_groups;
create trigger set_updated_at before update on public.menu_option_groups
  for each row execute function public.set_updated_at();


create table if not exists public.menu_options (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.menu_option_groups(id) on delete cascade,
  name          text not null,

  -- MAY BE NEGATIVE — "sans viande, −500 F" is a real menu line. No `>= 0`
  -- check here, deliberately.
  price_delta   integer not null default 0,

  is_available  boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists menu_options_group_idx on public.menu_options (group_id, sort_order);


-- ═══════════════════════════════════════════════════════════════════════════
--  4. Reservations
--
--  The guest details are SNAPSHOTTED, not joined. A booking is taken over the
--  phone as often as through the app, so customer_id is frequently null — and
--  even when it is set, the name on the door is the name given at the time.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.reservations (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique,

  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  customer_id    uuid references public.profiles(id) on delete set null,
  -- set null, not cascade: retiring a table must not erase tonight's bookings.
  table_id       uuid references public.restaurant_tables(id) on delete set null,

  guest_name     text not null,
  guest_phone    text not null,
  guest_email    text,

  party_size     integer not null check (party_size > 0),
  reserved_for   timestamptz not null,
  duration_min   integer not null default 90 check (duration_min > 0),

  status         text not null default 'pending'
                   check (status in ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show')),

  notes          text,
  -- Why it was refused, in the restaurant's own words. A rejection with no
  -- reason is the thing guests complain about.
  decided_by     text,
  decided_at     timestamptz,
  decline_reason text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists reservations_restaurant_idx on public.reservations (restaurant_id, reserved_for);
create index if not exists reservations_customer_idx   on public.reservations (customer_id, reserved_for desc);
-- The "needs a decision" queue.
create index if not exists reservations_pending_idx    on public.reservations (restaurant_id, reserved_for)
  where status = 'pending';

drop trigger if exists set_updated_at on public.reservations;
create trigger set_updated_at before update on public.reservations
  for each row execute function public.set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
--  5. Promotions
--
--  restaurant_id NULL means a PLATFORM-WIDE code, which only an admin can
--  create. That is why the column is nullable and why the write policy checks
--  for it explicitly — a restaurant must not be able to mint a code that
--  discounts everybody else's food.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.promotions (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid references public.restaurants(id) on delete cascade,

  code           text not null,
  label          text not null default '',

  discount_type  text not null check (discount_type in ('percent', 'fixed')),
  -- Percent: 1–100. Fixed: whole XAF. One column, because a promotion has
  -- exactly one value and two nullable columns would let both be set.
  discount_value integer not null check (discount_value > 0),

  min_order      integer not null default 0 check (min_order >= 0),
  -- Caps a percentage discount in francs. Null = uncapped. Without this, "20%
  -- off" on a 200 000 F group booking is a 40 000 F gift nobody approved.
  max_discount   integer check (max_discount > 0),

  starts_at      timestamptz not null default now(),
  ends_at        timestamptz,

  usage_limit    integer check (usage_limit > 0),
  used_count     integer not null default 0 check (used_count >= 0),
  per_customer_limit integer check (per_customer_limit > 0),

  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Unique PER RESTAURANT, so two restaurants may both run "RENTREE20".
  -- Platform codes (restaurant_id null) are made unique by the partial index
  -- below, because NULL never conflicts with NULL in a unique constraint.
  constraint promotions_scoped_code unique (restaurant_id, code),
  constraint promotions_percent_range
    check (discount_type <> 'percent' or discount_value between 1 and 100),
  constraint promotions_window check (ends_at is null or ends_at > starts_at)
);

create unique index if not exists promotions_platform_code_idx
  on public.promotions (code) where restaurant_id is null;

create index if not exists promotions_restaurant_idx on public.promotions (restaurant_id)
  where is_active;

drop trigger if exists set_updated_at on public.promotions;
create trigger set_updated_at before update on public.promotions
  for each row execute function public.set_updated_at();


-- Which codes were actually used, and by whom. Enforces per_customer_limit and
-- is the only honest answer to "did this campaign do anything".
create table if not exists public.promotion_redemptions (
  id            uuid primary key default gen_random_uuid(),
  promotion_id  uuid not null references public.promotions(id) on delete cascade,
  order_id      uuid references public.orders(id) on delete set null,
  customer_id   uuid references public.profiles(id) on delete set null,
  amount        integer not null check (amount >= 0),
  created_at    timestamptz not null default now()
);

create index if not exists promotion_redemptions_promo_idx
  on public.promotion_redemptions (promotion_id, created_at desc);
create index if not exists promotion_redemptions_customer_idx
  on public.promotion_redemptions (promotion_id, customer_id);


-- ═══════════════════════════════════════════════════════════════════════════
--  6. Columns the restaurant dashboard needs on existing tables
-- ═══════════════════════════════════════════════════════════════════════════

-- The pause switch. Distinct from `status`: status is the platform's verdict
-- (approved / suspended), this is the restaurant saying "not tonight". A
-- kitchen that is swamped needs to stop the queue without being unpublished.
alter table public.restaurants
  add column if not exists is_accepting_orders boolean not null default true;

-- Set when a restaurant pauses, so the public page can say why instead of
-- silently hiding the order button.
alter table public.restaurants
  add column if not exists paused_reason text;

-- Who replied to a review, snapshotted. `reply` and `replied_at` already exist.
alter table public.reviews
  add column if not exists replied_by text;


-- ═══════════════════════════════════════════════════════════════════════════
--  7. Row Level Security — deny by default (B.1)
--
--  Every table gets RLS enabled. The only policies granted are:
--
--    · PUBLIC READ on the menu of an ACTIVE restaurant. A menu is public
--      information; this is what lets the customer-facing page be read
--      directly rather than proxied through the server for no reason.
--
--    · STAFF READ/WRITE on their own branch, scoped by staff_role_at().
--
--  Everything else — orders, money, staff records — stays server-only, reached
--  with the service-role key. A policy is not written here unless something
--  genuinely needs to read the table with the publishable key, which ships
--  inside the JavaScript bundle.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.restaurant_staff       enable row level security;
alter table public.menu_categories        enable row level security;
alter table public.menu_items             enable row level security;
alter table public.menu_option_groups     enable row level security;
alter table public.menu_options           enable row level security;
alter table public.reservations           enable row level security;
alter table public.promotions             enable row level security;
alter table public.promotion_redemptions  enable row level security;


-- ── Menu: public read when the restaurant is live ──────────────────────────

drop policy if exists "menu categories are public" on public.menu_categories;
create policy "menu categories are public" on public.menu_categories
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.restaurants r
      where r.id = menu_categories.restaurant_id and r.status = 'active'
    )
  );

-- Note the absence of `and is_available`: an item that has run out must still
-- be READABLE, so the page can show it greyed out with "épuisé". Hiding it
-- makes a customer think the dish was removed.
drop policy if exists "menu items are public" on public.menu_items;
create policy "menu items are public" on public.menu_items
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.restaurants r
      where r.id = menu_items.restaurant_id and r.status = 'active'
    )
  );

drop policy if exists "option groups follow their item" on public.menu_option_groups;
create policy "option groups follow their item" on public.menu_option_groups
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.menu_items i
      join public.restaurants r on r.id = i.restaurant_id
      where i.id = menu_option_groups.menu_item_id and r.status = 'active'
    )
  );

drop policy if exists "options follow their group" on public.menu_options;
create policy "options follow their group" on public.menu_options
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.menu_option_groups g
      join public.menu_items i     on i.id = g.menu_item_id
      join public.restaurants r    on r.id = i.restaurant_id
      where g.id = menu_options.group_id and r.status = 'active'
    )
  );


-- ── Menu: staff manage their own ───────────────────────────────────────────
--
--  `menu.edit` belongs to owner and manager only (see lib/capabilities), which
--  is what can_manage() encodes. Kitchen staff read the menu through the
--  public policy above; they do not price it.

drop policy if exists "staff manage their categories" on public.menu_categories;
create policy "staff manage their categories" on public.menu_categories
  for all to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));

drop policy if exists "staff manage their items" on public.menu_items;
create policy "staff manage their items" on public.menu_items
  for all to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));

-- Option groups and options carry no restaurant_id of their own, so the check
-- walks up to the item. Repeating the id on them would be faster and would
-- also be a second copy of the truth, free to drift when an item is moved.
drop policy if exists "staff manage their option groups" on public.menu_option_groups;
create policy "staff manage their option groups" on public.menu_option_groups
  for all to authenticated
  using (
    exists (select 1 from public.menu_items i
            where i.id = menu_option_groups.menu_item_id
              and public.can_manage(i.restaurant_id))
  )
  with check (
    exists (select 1 from public.menu_items i
            where i.id = menu_option_groups.menu_item_id
              and public.can_manage(i.restaurant_id))
  );

drop policy if exists "staff manage their options" on public.menu_options;
create policy "staff manage their options" on public.menu_options
  for all to authenticated
  using (
    exists (select 1 from public.menu_option_groups g
            join public.menu_items i on i.id = g.menu_item_id
            where g.id = menu_options.group_id
              and public.can_manage(i.restaurant_id))
  )
  with check (
    exists (select 1 from public.menu_option_groups g
            join public.menu_items i on i.id = g.menu_item_id
            where g.id = menu_options.group_id
              and public.can_manage(i.restaurant_id))
  );


-- ── Staff list ─────────────────────────────────────────────────────────────
--
--  Anyone working at a branch may SEE the roster — you need to know who is on
--  shift. Only owner and manager may change it (`staff.manage`).

drop policy if exists "staff see their colleagues" on public.restaurant_staff;
create policy "staff see their colleagues" on public.restaurant_staff
  for select to authenticated
  using (public.is_staff_of(restaurant_id));

drop policy if exists "managers edit the roster" on public.restaurant_staff;
create policy "managers edit the roster" on public.restaurant_staff
  for all to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));


-- ── Reservations ───────────────────────────────────────────────────────────

drop policy if exists "staff see their reservations" on public.reservations;
create policy "staff see their reservations" on public.reservations
  for all to authenticated
  using (public.is_staff_of(restaurant_id))
  with check (public.is_staff_of(restaurant_id));

-- A customer sees their OWN bookings and nobody else's. Read only: changing a
-- booking goes through the restaurant, which is the whole point of a booking.
drop policy if exists "customers see their own reservations" on public.reservations;
create policy "customers see their own reservations" on public.reservations
  for select to authenticated
  using (customer_id = public.current_profile_id());


-- ── Promotions ─────────────────────────────────────────────────────────────

-- Live codes are readable so the checkout can validate one without a round
-- trip. The window and the active flag are part of the policy, so an expired
-- code cannot even be read, let alone applied.
drop policy if exists "live promotions are readable" on public.promotions;
create policy "live promotions are readable" on public.promotions
  for select to anon, authenticated
  using (
    is_active
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
    and (
      restaurant_id is null
      or exists (
        select 1 from public.restaurants r
        where r.id = promotions.restaurant_id and r.status = 'active'
      )
    )
  );

-- `restaurant_id is not null` in the WITH CHECK is the load-bearing clause: it
-- stops a restaurant creating a platform-wide code that discounts every other
-- tenant's food. Platform codes are created server-side by an admin.
drop policy if exists "managers run their own promotions" on public.promotions;
create policy "managers run their own promotions" on public.promotions
  for all to authenticated
  using (restaurant_id is not null and public.can_manage(restaurant_id))
  with check (restaurant_id is not null and public.can_manage(restaurant_id));


-- ═══════════════════════════════════════════════════════════════════════════
--  8. Backfill
--
--  Restaurants seeded by 0003 have no owner and therefore no staff row. The
--  trigger only fires on insert or on an owner_id change, so anything already
--  owned needs one written by hand — otherwise an existing owner is locked out
--  of the dashboard the moment these policies come into force.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.restaurant_staff (restaurant_id, profile_id, role, status, accepted_at)
select r.id, r.owner_id, 'owner', 'active', now()
from public.restaurants r
where r.owner_id is not null
on conflict (restaurant_id, profile_id) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
--  9. Verify
-- ═══════════════════════════════════════════════════════════════════════════

-- Expect 31 tables, every one with rowsecurity = true.
select count(*) as total_tables,
       count(*) filter (where rowsecurity) as with_rls
from pg_tables where schemaname = 'public';

-- Expect 0. A row here is a table anyone holding the publishable key can read.
select tablename from pg_tables
where schemaname = 'public' and not rowsecurity;

-- Expect one 'owner' row per owned restaurant. A zero here means the owner
-- cannot open their own dashboard.
select r.name, r.status, s.role, s.status as staff_status
from public.restaurants r
left join public.restaurant_staff s on s.restaurant_id = r.id and s.role = 'owner'
order by r.name;

-- Expect all five helpers, all SECURITY DEFINER (prosecdef = true).
select proname, prosecdef
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('current_profile_id', 'is_platform_admin', 'staff_role_at',
                  'is_staff_of', 'can_manage')
order by proname;
