-- ═══════════════════════════════════════════════════════════════════════════
--  0004 — Plans and subscriptions
--
--  Adds the two tables the admin dashboard needs to show which package a
--  restaurant is on and when it expires.
--
--  THE LIMITS LIVE IN THE PLAN ROW, NOT IN CODE (§14.5).
--  In the PHP app they were hardcoded in PHP while /pricing rendered its own
--  copy from a template — so the marketing page could promise 100 dishes while
--  the app refused the 21st. One source, read by both.
--
--  Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.subscription_plans (
  id                uuid primary key default gen_random_uuid(),
  tier              text        not null unique
                      check (tier in ('starter', 'professional', 'enterprise')),
  name              text        not null,
  monthly_price     integer     not null check (monthly_price >= 0),   -- whole XAF
  commission_rate   numeric(4,2) not null check (commission_rate >= 0 and commission_rate <= 100),

  -- NULL means unlimited. Not -1, not 0, not 999999: null is the only value
  -- that cannot be mistaken for a real ceiling in a comparison.
  menu_item_limit   integer     check (menu_item_limit  is null or menu_item_limit  > 0),
  table_limit       integer     check (table_limit      is null or table_limit      > 0),
  promotion_limit   integer     check (promotion_limit  is null or promotion_limit  > 0),

  staff_management  boolean     not null default false,
  analytics         boolean     not null default false,

  is_active         boolean     not null default true,
  is_featured       boolean     not null default false,
  sort_order        integer     not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null unique references public.restaurants(id) on delete cascade,
  plan_id        uuid not null references public.subscription_plans(id) on delete restrict,

  -- §5 rule 1: NULL means NEVER EXPIRES, not "expired in 1970". Free and
  -- lifetime plans have no end date, and code that treats null as a past date
  -- locks out exactly the tenants it should not.
  start_date     timestamptz not null default now(),
  end_date       timestamptz,

  -- §5: grace exists because mobile money renewal is not instant. Locking a
  -- restaurant out mid-service over a payment an hour late costs them real
  -- money and costs you the customer.
  grace_days     integer     not null default 3 check (grace_days >= 0),

  -- Deliberately NOT a stored "state" column. Active / grace / locked is a
  -- function of end_date + grace_days + now(), so storing it would need a
  -- nightly job to stay truthful and would silently rot if that job stopped.
  -- The view below derives it instead.
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists subscriptions_plan_idx    on public.subscriptions (plan_id);
create index if not exists subscriptions_end_date_idx on public.subscriptions (end_date);

drop trigger if exists set_updated_at on public.subscription_plans;
create trigger set_updated_at before update on public.subscription_plans
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.subscriptions;
create trigger set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
--  Derived state — the whole of §5 in one expression
--
--    now <= end_date                   → active
--    end_date < now <= end_date+grace  → grace   (full access, renewal banner)
--    now > end_date + grace            → locked  (limits drop to Starter)
--
--  end_date IS NULL → active forever.
--
--  A view rather than a column so it can never be stale. The original bug this
--  guards against selected `WHERE status = 'active'` and never looked at
--  end_date at all — subscriptions that lapsed months ago still read as active,
--  tenants kept every paid feature, and revenue leaked silently.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.subscription_state as
select
  s.id,
  s.restaurant_id,
  s.plan_id,
  s.start_date,
  s.end_date,
  s.grace_days,
  s.cancelled_at,
  case
    when s.cancelled_at is not null                          then 'cancelled'
    when s.end_date is null                                  then 'active'
    when now() <= s.end_date                                 then 'active'
    when now() <= s.end_date + (s.grace_days || ' days')::interval then 'grace'
    else 'locked'
  end as state,
  case
    when s.end_date is null then null
    else greatest(0, extract(day from s.end_date - now())::integer)
  end as days_remaining
from public.subscriptions s;


-- ═══════════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.subscription_plans enable row level security;
alter table public.subscriptions      enable row level security;

-- Plans are public: /pricing renders from this table, for signed-out visitors.
drop policy if exists "active plans are public" on public.subscription_plans;
create policy "active plans are public" on public.subscription_plans
  for select to anon, authenticated using (is_active);

-- Subscriptions get NO policy. A tenant's billing state is nobody else's
-- business, and both the manager and the admin read it through the server.


-- ═══════════════════════════════════════════════════════════════════════════
--  Seed
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.subscription_plans
  (tier, name, monthly_price, commission_rate,
   menu_item_limit, table_limit, promotion_limit,
   staff_management, analytics, is_active, is_featured, sort_order)
values
  ('starter',      'Starter',      0,     5.00, 20,   5,    1,    false, false, true, false, 1),
  ('professional', 'Professional', 25000, 3.00, 100,  25,   10,   true,  true,  true, true,  2),
  ('enterprise',   'Enterprise',   75000, 2.00, null, null, null, true,  true,  true, false, 3)
on conflict (tier) do nothing;

-- Give every existing restaurant a subscription so the admin table has
-- something to show. Scaffolding, like the restaurants themselves.
--   · Chez Marcel Akwa  → Professional, 20 days left
--   · Chez Marcel Bonapriso → Professional, EXPIRED 1 day ago (in grace)
--   · Le Ndolé d'Or     → Enterprise, no end date (never expires)
--   · everyone else     → Starter, 45 days
insert into public.subscriptions (restaurant_id, plan_id, start_date, end_date, grace_days)
select
  r.id,
  p.id,
  now() - interval '60 days',
  case
    when r.slug = 'chez-marcel-akwa'      then now() + interval '20 days'
    when r.slug = 'chez-marcel-bonapriso' then now() - interval '1 day'
    when r.slug = 'le-ndole-dor'          then null
    else now() + interval '45 days'
  end,
  3
from public.restaurants r
join public.subscription_plans p
  on p.tier = case
       when r.slug in ('chez-marcel-akwa', 'chez-marcel-bonapriso') then 'professional'
       when r.slug = 'le-ndole-dor'                                 then 'enterprise'
       else 'starter'
     end
on conflict (restaurant_id) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
--  Verify — expect one row per restaurant, with a mix of active/grace states
--  and Le Ndolé d'Or showing "active" with a NULL end_date.
-- ═══════════════════════════════════════════════════════════════════════════

select r.name, r.branch_label, p.name as plan, st.state, st.end_date, st.days_remaining
from public.subscription_state st
join public.restaurants r        on r.id = st.restaurant_id
join public.subscription_plans p on p.id = st.plan_id
order by r.name, r.branch_label;
