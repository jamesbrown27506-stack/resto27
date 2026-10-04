-- ═══════════════════════════════════════════════════════════════════════════
--  0074 — Shared rate limits, scheduled payouts, pushing the menu to branches
--
--  Run after 0073. Idempotent. The app keeps working before it is run: the
--  rate limiter falls back to per-instance memory, scheduled payouts stay
--  off, and the branch menu update reports that it is unavailable.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  1. Rate limits that every server instance shares
--
--  ─────────────────────────────────────────────────────────────────────────
--   The limiter lived in each instance's memory; on Vercel a request can
--   land on any of many short-lived instances, so a limit of 5 was really
--   "5 per instance" and a cold start forgot it. One row per key per window
--   here, incremented atomically, is the same count for everyone.
--
--   A FIXED window (it resets on the boundary): one row per key, no list of
--   timestamps to trim, and the worst case is 2× the limit straddling a
--   boundary — still a limit. Old windows are swept by the daily job.
--  ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.rate_limit_buckets (
  key           text        not null,
  window_start  timestamptz not null,
  hits          integer     not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limit_buckets enable row level security;
create index if not exists rate_limit_buckets_window_idx on public.rate_limit_buckets (window_start);

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_ms integer)
returns table (allowed boolean, retry_after_ms integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ms      bigint := greatest(coalesce(p_window_ms, 0), 1000);
  v_now_ms  bigint := floor(extract(epoch from clock_timestamp()) * 1000);
  v_start   timestamptz;
  v_hits    integer;
begin
  v_start := to_timestamp(((v_now_ms / v_ms) * v_ms) / 1000.0);

  insert into public.rate_limit_buckets (key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = public.rate_limit_buckets.hits + 1
  returning hits into v_hits;

  allowed := v_hits <= p_limit;
  retry_after_ms := case
    when allowed then 0
    else greatest(0, ((v_now_ms / v_ms) * v_ms + v_ms - v_now_ms))::integer
  end;
  return next;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
--  2. Scheduled payouts (Enterprise)
--
--  ─────────────────────────────────────────────────────────────────────────
--   `subscription_plans.scheduled_payouts` was advertised on the Enterprise
--   card and the pricing page, and nothing implemented it. Now an OWNER sets
--   a schedule (with their PIN): every day, every week on a given day, or on
--   the 1st of the month, the nightly job sends what the wallet holds above a
--   reserve the owner keeps, to one of the owner's saved numbers — through
--   the very same path as a withdrawal made by hand.
--
--   The schedule names the owner who set it: the payout is theirs, recorded
--   as theirs, and it stops on its own if they stop being an owner there, if
--   the number is removed, or if the plan no longer includes the feature.
--  ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.scheduled_payouts (
  restaurant_id      uuid primary key references public.restaurants(id) on delete cascade,
  enabled            boolean     not null default true,
  frequency          text        not null check (frequency in ('daily', 'weekly', 'monthly')),
  -- weekly: 0 = Sunday … 6 = Saturday (Douala time). Ignored otherwise.
  weekday            integer     check (weekday is null or weekday between 0 and 6),
  payout_account_id  uuid        not null references public.payout_accounts(id) on delete cascade,
  -- Left in the wallet every time, for refunds and the day's change.
  keep_amount        integer     not null default 0 check (keep_amount >= 0),
  -- Below this, no payout that day: a 600 FCFA transfer is mostly fee.
  min_amount         integer     not null default 5000 check (min_amount >= 500),
  set_by             uuid        not null references public.profiles(id) on delete cascade,
  last_run_at        timestamptz,
  last_result        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.scheduled_payouts enable row level security;
drop trigger if exists set_updated_at on public.scheduled_payouts;
create trigger set_updated_at before update on public.scheduled_payouts
  for each row execute function public.set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
--  3. sync_branch_menu — bring a branch's menu up to the main's
--
--  ─────────────────────────────────────────────────────────────────────────
--   copy_restaurant_menu (0073) only fills an EMPTY menu. After that, a price
--   change at the main had to be retyped at every branch. This brings the
--   main's menu over again, as a MERGE, in one transaction:
--
--     · dishes both have (same name): the main's price, price range,
--       description, photo, course, tags and preparation time win;
--     · dishes only the main has: added, with their options, into the
--       category of the same name (created if the branch lacks it);
--     · dishes only the branch has: left exactly as they are.
--
--   Never touched: each location's availability and stock, and the options
--   of dishes the branch already had (it may have tuned them).
--
--   `p_max_new` caps the dishes added (the plan's dish ceiling, from the
--   app); null = no cap.
--  ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.sync_branch_menu(p_source uuid, p_target uuid, p_max_new integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_added   integer := 0;
begin
  if not exists (select 1 from public.restaurants where id = p_target and parent_id = p_source) then
    raise exception 'menu_sync_not_a_branch';
  end if;

  -- Categories the branch lacks, by name.
  insert into public.menu_categories (restaurant_id, name, icon, sort_order, is_active)
  select p_target, c.name, c.icon, c.sort_order, c.is_active
  from public.menu_categories c
  where c.restaurant_id = p_source
    and not exists (
      select 1 from public.menu_categories t
      where t.restaurant_id = p_target and lower(t.name) = lower(c.name)
    );

  -- Dishes both have: the main's terms.
  update public.menu_items t
  set price = s.price,
      price_to_confirm = s.price_to_confirm,
      price_max = s.price_max,
      description = s.description,
      image_url = s.image_url,
      course = s.course,
      dietary_tags = s.dietary_tags,
      allergens = s.allergens,
      prep_minutes = s.prep_minutes
  from public.menu_items s
  where s.restaurant_id = p_source
    and t.restaurant_id = p_target
    and lower(t.name) = lower(s.name)
    and (t.price, t.price_to_confirm, t.price_max, t.description, t.image_url, t.course,
         t.dietary_tags, t.allergens, t.prep_minutes)
        is distinct from
        (s.price, s.price_to_confirm, s.price_max, s.description, s.image_url, s.course,
         s.dietary_tags, s.allergens, s.prep_minutes);
  get diagnostics v_updated = row_count;

  -- Dishes only the main has.
  create temp table _menu_sync_items on commit drop as
    select s.id as old_id, gen_random_uuid() as new_id
    from public.menu_items s
    where s.restaurant_id = p_source
      and not exists (
        select 1 from public.menu_items t
        where t.restaurant_id = p_target and lower(t.name) = lower(s.name)
      )
    order by s.sort_order, s.created_at
    limit coalesce(p_max_new, 100000);

  insert into public.menu_items (
    id, restaurant_id, category_id, name, description, price, image_url,
    is_available, is_featured, prep_minutes,
    track_stock, stock_quantity, low_stock_threshold,
    dietary_tags, allergens, sort_order,
    price_to_confirm, price_max, course
  )
  select
    m.new_id, p_target,
    (select tc.id from public.menu_categories tc
       where tc.restaurant_id = p_target and lower(tc.name) = lower(sc.name)
       order by tc.sort_order limit 1),
    s.name, s.description, s.price, s.image_url,
    true, s.is_featured, s.prep_minutes,
    s.track_stock, case when s.track_stock then 0 else null end, s.low_stock_threshold,
    s.dietary_tags, s.allergens, s.sort_order,
    s.price_to_confirm, s.price_max, s.course
  from public.menu_items s
  join _menu_sync_items m on m.old_id = s.id
  left join public.menu_categories sc on sc.id = s.category_id;
  get diagnostics v_added = row_count;

  create temp table _menu_sync_groups on commit drop as
    select g.id as old_id, gen_random_uuid() as new_id, m.new_id as new_item_id
    from public.menu_option_groups g
    join _menu_sync_items m on m.old_id = g.menu_item_id;

  insert into public.menu_option_groups (id, menu_item_id, name, min_select, max_select, is_required, sort_order)
  select gm.new_id, gm.new_item_id, g.name, g.min_select, g.max_select, g.is_required, g.sort_order
  from public.menu_option_groups g
  join _menu_sync_groups gm on gm.old_id = g.id;

  insert into public.menu_options (group_id, name, price_delta, is_available, sort_order)
  select gm.new_id, o.name, o.price_delta, true, o.sort_order
  from public.menu_options o
  join _menu_sync_groups gm on gm.old_id = o.group_id;

  return jsonb_build_object('updated', v_updated, 'added', v_added);
end;
$$;

revoke all on function public.sync_branch_menu(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.sync_branch_menu(uuid, uuid, integer) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
--  Verify
-- ═══════════════════════════════════════════════════════════════════════════

-- Expect allowed = true, retry_after_ms = 0 (one hit on a throwaway key).
select * from public.rate_limit_hit('verify:0074', 5, 60000);
delete from public.rate_limit_buckets where key = 'verify:0074';

-- Expect two rows, rowsecurity true.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('rate_limit_buckets', 'scheduled_payouts');
