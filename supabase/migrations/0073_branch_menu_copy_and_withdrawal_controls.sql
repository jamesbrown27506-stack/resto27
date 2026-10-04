-- ═══════════════════════════════════════════════════════════════════════════
--  0073 — Copy a menu into a branch; who may withdraw, with what, to where
--
--  Run after 0072. Idempotent. Before it is run the menu copy reports that it
--  is unavailable, and WITHDRAWALS ARE REFUSED — deliberately: the controls
--  below fail closed, so a missing PIN table never means "no PIN asked".
--  Run it together with the deploy.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  1. copy_restaurant_menu — the main's menu, into one of its branches
--
--  ─────────────────────────────────────────────────────────────────────────
--   ONE TRANSACTION, OR NOTHING. Categories, dishes, option groups and
--   options are four inserts that reference each other; done from the app
--   they would be four round trips with no rollback, and a failure halfway
--   leaves a branch with dishes missing their sizes or sides. Here it is all
--   or none.
--
--   WHAT IS COPIED: the menu as designed — names, prices, descriptions,
--   photos (the same file; nothing deletes dish photos, so sharing is safe),
--   courses, price-to-confirm, options and their surcharges, order.
--   WHAT IS NOT: what belongs to one location's service. Every dish and
--   option starts AVAILABLE (the main's "sold out tonight" is not the
--   branch's), and a dish that tracks stock starts at 0 — stock is counted
--   per location, and inventing the main's count would sell food the branch
--   does not have.
--
--   ONLY INTO AN EMPTY MENU, ONLY FROM ITS OWN MAIN. A copy is a starting
--   point, never a merge: copying into a menu that already has dishes would
--   duplicate them. Any empty default categories the branch was given on its
--   first visit to /m/menu are replaced by the main's.
--  ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.copy_restaurant_menu(p_source uuid, p_target uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dishes integer;
begin
  if not exists (select 1 from public.restaurants where id = p_target and parent_id = p_source) then
    raise exception 'menu_copy_not_a_branch';
  end if;
  if exists (select 1 from public.menu_items where restaurant_id = p_target) then
    raise exception 'menu_copy_target_not_empty';
  end if;

  create temp table _menu_copy_categories on commit drop as
    select id as old_id, gen_random_uuid() as new_id
    from public.menu_categories where restaurant_id = p_source;

  create temp table _menu_copy_items on commit drop as
    select id as old_id, gen_random_uuid() as new_id
    from public.menu_items where restaurant_id = p_source;

  create temp table _menu_copy_groups on commit drop as
    select g.id as old_id, gen_random_uuid() as new_id
    from public.menu_option_groups g
    join public.menu_items i on i.id = g.menu_item_id
    where i.restaurant_id = p_source;

  -- Empty by the check above: only the default categories can be here.
  delete from public.menu_categories where restaurant_id = p_target;

  insert into public.menu_categories (id, restaurant_id, name, icon, sort_order, is_active)
  select m.new_id, p_target, c.name, c.icon, c.sort_order, c.is_active
  from public.menu_categories c
  join _menu_copy_categories m on m.old_id = c.id;

  insert into public.menu_items (
    id, restaurant_id, category_id, name, description, price, image_url,
    is_available, is_featured, prep_minutes,
    track_stock, stock_quantity, low_stock_threshold,
    dietary_tags, allergens, sort_order,
    price_to_confirm, price_max, course
  )
  select
    im.new_id, p_target, cm.new_id, i.name, i.description, i.price, i.image_url,
    true, i.is_featured, i.prep_minutes,
    i.track_stock, case when i.track_stock then 0 else null end, i.low_stock_threshold,
    i.dietary_tags, i.allergens, i.sort_order,
    i.price_to_confirm, i.price_max, i.course
  from public.menu_items i
  join _menu_copy_items im on im.old_id = i.id
  left join _menu_copy_categories cm on cm.old_id = i.category_id;

  get diagnostics v_dishes = row_count;

  insert into public.menu_option_groups (id, menu_item_id, name, min_select, max_select, is_required, sort_order)
  select gm.new_id, im.new_id, g.name, g.min_select, g.max_select, g.is_required, g.sort_order
  from public.menu_option_groups g
  join _menu_copy_groups gm on gm.old_id = g.id
  join _menu_copy_items im on im.old_id = g.menu_item_id;

  insert into public.menu_options (group_id, name, price_delta, is_available, sort_order)
  select gm.new_id, o.name, o.price_delta, true, o.sort_order
  from public.menu_options o
  join _menu_copy_groups gm on gm.old_id = o.group_id;

  return v_dishes;
end;
$$;

-- The app calls it with the service key, after checking the caller owns the
-- main. Nobody else may.
revoke all on function public.copy_restaurant_menu(uuid, uuid) from public, anon, authenticated;
grant execute on function public.copy_restaurant_menu(uuid, uuid) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
--  2. Withdrawal controls
--
--  ─────────────────────────────────────────────────────────────────────────
--   Until now a withdrawal was: anyone with `finance.manage` (owner OR
--   manager) types an amount and ANY number, and the money leaves at once.
--   Nothing recorded it for the owner, nothing asked who was holding the
--   phone. Three controls close that (rules in lib/wallet/withdraw-rules.ts):
--
--     · THE RIGHT  — the owner always; a manager only if an owner granted it
--                    to that person at that branch, optionally capped per day.
--     · THE PIN    — every withdrawal is unlocked by the person's own 4–6
--                    digit code, set with their account password; five wrong
--                    tries lock it for 30 minutes.
--     · THE NUMBER — money only goes to a number the owner saved, with the
--                    holder name the operator confirmed. A delegate cannot
--                    send the wallet to their own Mobile Money.
--
--   ALL THREE TABLES ARE SERVICE-ROLE ONLY (RLS on, no policy), like every
--   money table. Not columns on restaurant_staff: that table is readable by
--   colleagues and writable by managers through PostgREST (0006 policies),
--   and a manager must not be able to grant themselves the right — or read
--   anyone's PIN hash.
--  ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

-- One PIN per PERSON, whatever branch they withdraw at.
create table if not exists public.withdrawal_pins (
  profile_id       uuid primary key references public.profiles(id) on delete cascade,
  pin_hash         text not null,                       -- scrypt$N$r$p$salt$hash
  failed_attempts  integer not null default 0 check (failed_attempts >= 0),
  locked_until     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.withdrawal_pins enable row level security;
drop trigger if exists set_updated_at on public.withdrawal_pins;
create trigger set_updated_at before update on public.withdrawal_pins
  for each row execute function public.set_updated_at();

-- The owner's grant, per person per branch. Revoking deletes the row; the
-- audit log keeps who granted and revoked what, and when.
create table if not exists public.withdrawal_permissions (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  daily_limit    integer check (daily_limit is null or daily_limit > 0),   -- whole XAF; null = no ceiling
  granted_by     uuid references public.profiles(id) on delete set null,
  granted_at     timestamptz not null default now(),
  unique (restaurant_id, profile_id)
);
alter table public.withdrawal_permissions enable row level security;

-- Numbers the money may go to, for the whole restaurant (its main and every
-- branch): keyed by the MAIN restaurant, the account that owns the brand.
create table if not exists public.payout_accounts (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.restaurants(id) on delete cascade,
  phone        text not null,
  holder_name  text,           -- as the operator answered; null if added in sandbox
  label        text,
  added_by     uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  removed_at   timestamptz
);
alter table public.payout_accounts enable row level security;
create unique index if not exists payout_accounts_live_idx
  on public.payout_accounts (account_id, phone) where removed_at is null;

-- What the owner reads in the history: who withdrew, as what, to whom.
alter table public.withdrawal_requests
  add column if not exists recipient_name text,
  add column if not exists requester_role text,
  add column if not exists payout_account_id uuid references public.payout_accounts(id) on delete set null;

create index if not exists withdrawal_requests_restaurant_idx
  on public.withdrawal_requests (restaurant_id, requested_at desc);
create index if not exists withdrawal_requests_requester_idx
  on public.withdrawal_requests (requested_by, requested_at desc);


-- ═══════════════════════════════════════════════════════════════════════════
--  Verify
-- ═══════════════════════════════════════════════════════════════════════════

-- Expect three rows, rowsecurity true on each.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('withdrawal_pins', 'withdrawal_permissions', 'payout_accounts');

-- Expect one row: copy_restaurant_menu, executable by service_role only.
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can_run
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'copy_restaurant_menu';
