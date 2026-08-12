-- ═══════════════════════════════════════════════════════════════════════════
--  0011 — Customers, reviews and reports, computed in the database
--
--  ─────────────────────────────────────────────────────────────────────────
--   WHY THESE ARE SQL FUNCTIONS AND NOT QUERIES IN TYPESCRIPT.
--
--   PostgREST cannot express GROUP BY. Every screen added here is a GROUP BY:
--   spend per customer, revenue per month, orders per hour, quantity per
--   dish. The only alternative is to SELECT every order and every order line
--   for the period and fold them in Node — which means a restaurant with a
--   year of history ships tens of thousands of rows over the wire to compute
--   twelve numbers, on the mobile connections this audience is on.
--
--   So the aggregation happens where the rows already are.
--  ─────────────────────────────────────────────────────────────────────────
--
--  ─────────────────────────────────────────────────────────────────────────
--   TWO RULES EVERY FUNCTION BELOW OBEYS.
--
--   1. p_restaurant IS THE TENANT BOUNDARY. Every function filters on it and
--      none of them read the session. The caller passes the id it got from
--      requireBranch(), exactly as the TypeScript read layer does — the rule
--      is the same one, moved down a level, not a new one.
--
--   2. GRANTED TO service_role ONLY. `create function` grants EXECUTE to
--      PUBLIC by default, which would put "total spend of every customer of
--      any restaurant, by id" one anon POST away. The revoke at the bottom is
--      not tidying up; it is the access control.
--  ─────────────────────────────────────────────────────────────────────────
--
--  Run after 0010. Idempotent — safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  1. Reviews — who replied
-- ═══════════════════════════════════════════════════════════════════════════

-- `replyToReview` has always written this column and the table never had it,
-- so every reply failed with "column replied_by does not exist". Snapshotted
-- as text like every other actor field in this schema (audit_log, refunds):
-- the person who answered a customer in public should still be nameable after
-- they leave the restaurant.
alter table public.reviews
  add column if not exists replied_by text;


-- ═══════════════════════════════════════════════════════════════════════════
--  2. Shared definitions
--
--  REVENUE = total - delivery_fee, and CANCELLED ORDERS DO NOT COUNT.
--
--  The delivery fee is the rider's, not the kitchen's; leaving it in makes a
--  restaurant that delivers look like it out-earns one that does not at the
--  same volume. Both report screens and the customer list use this same
--  definition, so the figures reconcile across pages.
--
--  Times are bucketed in Africa/Douala (UTC+1, no DST). "Peak hours" computed
--  in UTC would put a Cameroonian dinner rush at 17:00.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  3. Customers — one row per person who has ordered here
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.manager_customers(uuid);

create function public.manager_customers(p_restaurant uuid)
returns table (
  customer_id    uuid,
  name           text,
  email          text,
  phone          text,
  order_count    bigint,
  total_spent    bigint,
  first_order_at timestamptz,
  last_order_at  timestamptz,
  is_registered  boolean
)
language sql
stable
as $$
  select
    o.customer_id,
    -- A guest checkout has no profile, so the delivery name is the only name
    -- there is. Showing that beats showing nothing.
    coalesce(max(p.name), max(o.delivery_name), '')            as name,
    coalesce(max(p.email), '')                                 as email,
    coalesce(max(p.phone), max(o.delivery_phone), '')          as phone,
    count(*)::bigint                                           as order_count,
    coalesce(sum(o.total - o.delivery_fee), 0)::bigint         as total_spent,
    min(o.created_at)                                          as first_order_at,
    max(o.created_at)                                          as last_order_at,
    (o.customer_id is not null)                                as is_registered
  from public.orders o
  left join public.profiles p on p.id = o.customer_id
  where o.restaurant_id = p_restaurant
    and o.status <> 'cancelled'
    -- Dine-in tickets rung up by a waiter identify nobody. Counting them as
    -- one giant anonymous "customer" would dominate every total on the page.
    and (o.customer_id is not null or nullif(btrim(coalesce(o.delivery_phone, '')), '') is not null)
  -- Grouping on customer_id first makes it selectable directly; the coalesced
  -- key is what actually separates guests, and it maps 1:1 onto customer_id
  -- (null for every guest row, the id itself otherwise).
  group by o.customer_id, coalesce(o.customer_id::text, btrim(o.delivery_phone))
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  4. Reports
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Headline figures ──
drop function if exists public.manager_sales_summary(uuid, timestamptz, timestamptz);

create function public.manager_sales_summary(
  p_restaurant uuid,
  p_from       timestamptz,
  p_to         timestamptz
)
returns table (
  order_count    bigint,
  revenue        bigint,
  customer_count bigint,
  cancelled      bigint
)
language sql
stable
as $$
  select
    (count(*) filter (where o.status <> 'cancelled'))::bigint,
    (coalesce(sum(o.total - o.delivery_fee) filter (where o.status <> 'cancelled'), 0))::bigint,
    (count(distinct coalesce(o.customer_id::text, btrim(o.delivery_phone)))
      filter (where o.status <> 'cancelled'))::bigint,
    (count(*) filter (where o.status = 'cancelled'))::bigint
  from public.orders o
  where o.restaurant_id = p_restaurant
    and o.created_at >= p_from
    and o.created_at <  p_to
$$;


-- ── Revenue over time ──
-- One function for day/week/month rather than three, because the caller picks
-- the bucket from the length of the range it asked for.
drop function if exists public.manager_sales_series(uuid, timestamptz, timestamptz, text);

create function public.manager_sales_series(
  p_restaurant uuid,
  p_from       timestamptz,
  p_to         timestamptz,
  p_bucket     text default 'day'
)
returns table (
  bucket      timestamptz,
  revenue     bigint,
  order_count bigint
)
language sql
stable
as $$
  select
    date_trunc(
      -- Whitelisted, not interpolated. date_trunc takes its unit as text, and
      -- passing the caller's string through unchecked is how a report filter
      -- becomes an error message that names your schema.
      case lower(p_bucket) when 'month' then 'month' when 'week' then 'week' else 'day' end,
      o.created_at at time zone 'Africa/Douala'
    ) at time zone 'Africa/Douala'                       as bucket,
    coalesce(sum(o.total - o.delivery_fee), 0)::bigint   as revenue,
    count(*)::bigint                                     as order_count
  from public.orders o
  where o.restaurant_id = p_restaurant
    and o.status <> 'cancelled'
    and o.created_at >= p_from
    and o.created_at <  p_to
  group by 1
  order by 1
$$;


-- ── Which days of the week actually sell ──
drop function if exists public.manager_sales_by_weekday(uuid, timestamptz, timestamptz);

create function public.manager_sales_by_weekday(
  p_restaurant uuid,
  p_from       timestamptz,
  p_to         timestamptz
)
returns table (
  dow         integer,   -- 0 = Sunday, matching JS getDay()
  revenue     bigint,
  order_count bigint
)
language sql
stable
as $$
  select
    extract(dow from (o.created_at at time zone 'Africa/Douala'))::integer,
    coalesce(sum(o.total - o.delivery_fee), 0)::bigint,
    count(*)::bigint
  from public.orders o
  where o.restaurant_id = p_restaurant
    and o.status <> 'cancelled'
    and o.created_at >= p_from
    and o.created_at <  p_to
  group by 1
  order by 1
$$;


-- ── When the rush is ──
drop function if exists public.manager_peak_hours(uuid, timestamptz, timestamptz);

create function public.manager_peak_hours(
  p_restaurant uuid,
  p_from       timestamptz,
  p_to         timestamptz
)
returns table (
  -- Not named `hour`: an output-parameter name that collides with the field
  -- token in `extract(hour from …)` is the kind of thing that parses on one
  -- Postgres minor version and not the next.
  hour_of_day integer,   -- 0–23, Africa/Douala
  revenue     bigint,
  order_count bigint
)
language sql
stable
as $$
  select
    extract(hour from (o.created_at at time zone 'Africa/Douala'))::integer,
    coalesce(sum(o.total - o.delivery_fee), 0)::bigint,
    count(*)::bigint
  from public.orders o
  where o.restaurant_id = p_restaurant
    and o.status <> 'cancelled'
    and o.created_at >= p_from
    and o.created_at <  p_to
  group by 1
  order by 1
$$;


-- ── Delivery vs pickup vs dining room ──
drop function if exists public.manager_order_mix(uuid, timestamptz, timestamptz);

create function public.manager_order_mix(
  p_restaurant uuid,
  p_from       timestamptz,
  p_to         timestamptz
)
returns table (
  order_type  text,
  revenue     bigint,
  order_count bigint
)
language sql
stable
as $$
  select
    o.type,
    coalesce(sum(o.total - o.delivery_fee), 0)::bigint,
    count(*)::bigint
  from public.orders o
  where o.restaurant_id = p_restaurant
    and o.status <> 'cancelled'
    and o.created_at >= p_from
    and o.created_at <  p_to
  group by 1
  order by 3 desc
$$;


-- ── What sells ──
-- Grouped on the SNAPSHOTTED NAME, not menu_item_id. order_items keeps the
-- name and price the dish was sold under (§12), and menu_item_id goes null
-- when a dish is deleted — grouping on the id would silently drop a year of
-- "Poulet DG" from the report the day someone retires it from the menu.
drop function if exists public.manager_top_dishes(uuid, timestamptz, timestamptz, integer);

create function public.manager_top_dishes(
  p_restaurant uuid,
  p_from       timestamptz,
  p_to         timestamptz,
  p_limit      integer default 10
)
returns table (
  name         text,
  quantity     bigint,
  revenue      bigint,
  order_count  bigint
)
language sql
stable
as $$
  select
    oi.name,
    sum(oi.quantity)::bigint,
    sum(oi.unit_price * oi.quantity)::bigint,
    count(distinct oi.order_id)::bigint
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.restaurant_id = p_restaurant
    and o.status <> 'cancelled'
    and o.created_at >= p_from
    and o.created_at <  p_to
  group by oi.name
  order by 2 desc, 3 desc
  limit greatest(1, least(coalesce(p_limit, 10), 100))
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  5. Access — service_role only
--
--  These functions take a restaurant id and answer with that restaurant's
--  money. Nothing inside them checks who is asking, because the caller is
--  always our own server, which has already resolved the branch from the
--  session. Leaving the PUBLIC grant in place would make that assumption
--  false for anyone holding the anon key.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.manager_customers(uuid)',
    'public.manager_sales_summary(uuid, timestamptz, timestamptz)',
    'public.manager_sales_series(uuid, timestamptz, timestamptz, text)',
    'public.manager_sales_by_weekday(uuid, timestamptz, timestamptz)',
    'public.manager_peak_hours(uuid, timestamptz, timestamptz)',
    'public.manager_order_mix(uuid, timestamptz, timestamptz)',
    'public.manager_top_dishes(uuid, timestamptz, timestamptz, integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  6. Indexes the above will lean on
-- ═══════════════════════════════════════════════════════════════════════════

-- Every report is "this restaurant, this date range", in that order.
create index if not exists orders_restaurant_created_idx
  on public.orders (restaurant_id, created_at desc);

-- manager_top_dishes joins from order_items back to orders.
create index if not exists order_items_order_idx
  on public.order_items (order_id);
