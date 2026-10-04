-- ═══════════════════════════════════════════════════════════════════════════
--  0072 — Branches: one subscription for the whole restaurant, paid extras
--
--  ─────────────────────────────────────────────────────────────────────────
--   THE COMMERCIAL RULE (Oct 2026)
--
--     · A branch is a second (third…) location of the SAME restaurant: its
--       own row in `restaurants`, its own menu, staff, orders, wallet and
--       tables — fully independent in service — but NO subscription of its
--       own. It runs on its main restaurant's plan and lives or dies with it.
--     · `subscription_plans.included_branches` counts LOCATIONS, the main
--       included: Enterprise = 3 means the main + 2 branches for the one
--       monthly price.
--     · Beyond that, each extra branch costs `extra_branch_price` a month,
--       billed on the main restaurant's invoice. NULL = the plan cannot run
--       extra branches at all (Starter: no branches, ever).
--     · A branch the plan does not cover is PAUSED: hidden from customers,
--       no new orders or bookings, back office still open so service in
--       progress can be finished and the wallet withdrawn. Downgrading,
--       a lapsed main subscription or an unpaid extra all pause; paying or
--       upgrading resumes, automatically.
--  ─────────────────────────────────────────────────────────────────────────
--
--  WHY `status = 'paused'` AND NOT A NEW FLAG.
--  Every customer-facing read already insists on `restaurants.status =
--  'active'` — the directory, the restaurant page, checkout, bookings, the
--  QR table RPCs, chat, the sitemap and RLS. A paused branch drops out of all
--  of them with no code to forget. Only the back office widens its filter to
--  let the branch's own staff in.
--
--  The app's sync (lib/branches/account.ts) is the only writer of 'paused':
--  it flips a branch between 'active' and 'paused' and never touches
--  'pending' or 'suspended', which stay the admin's.
--
--  Run after 0071. Idempotent. The app keeps working before this is run —
--  every reader of the new columns falls back — but branches cannot be
--  created until it is.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Restaurants: the branch link, the paused state, the owner's close ──

alter table public.restaurants
  add column if not exists parent_id uuid references public.restaurants(id) on delete restrict;

-- The owner closed this branch on purpose (not the plan): it stays paused and
-- is not billed until they reopen it. Data, staff and history are kept.
alter table public.restaurants
  add column if not exists branch_closed_at timestamptz;

alter table public.restaurants drop constraint if exists restaurants_parent_not_self;
alter table public.restaurants add constraint restaurants_parent_not_self
  check (parent_id is null or parent_id <> id);

create index if not exists restaurants_parent_idx on public.restaurants (parent_id)
  where parent_id is not null;

alter table public.restaurants drop constraint if exists restaurants_status_check;
alter table public.restaurants add constraint restaurants_status_check
  check (status in ('active', 'pending', 'suspended', 'paused'));

-- Existing rows are all mains. Keep is_primary truthful for the readers that
-- already use it (branch switcher, public page titles).
update public.restaurants set is_primary = true where parent_id is null and not is_primary;

-- ONE LEVEL, ONE OWNER. A branch's parent must be a main restaurant, owned by
-- the same person — otherwise "whose plan pays for this" has two answers.
create or replace function public.restaurants_check_parent()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent record;
begin
  if new.parent_id is null then
    return new;
  end if;

  select id, parent_id, owner_id into v_parent from public.restaurants where id = new.parent_id;
  if v_parent.id is null then
    raise exception 'branch_parent_missing';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'branch_parent_is_branch';
  end if;
  if exists (select 1 from public.restaurants b where b.parent_id = new.id) then
    raise exception 'branch_has_branches';
  end if;
  if new.owner_id is distinct from v_parent.owner_id then
    raise exception 'branch_owner_mismatch';
  end if;

  new.is_primary := false;
  return new;
end;
$$;

drop trigger if exists restaurants_check_parent on public.restaurants;
create trigger restaurants_check_parent
  before insert or update of parent_id, owner_id on public.restaurants
  for each row execute function public.restaurants_check_parent();


-- ── 2. Plans: the monthly price of one branch beyond the included ones ──

alter table public.subscription_plans
  add column if not exists extra_branch_price integer
    check (extra_branch_price is null or extra_branch_price >= 0);

-- Defaults to start from — Admin → Plans is where they are really set.
-- Professional pays more per branch than Enterprise, so three locations cost
-- more on Professional (10 000 + 2 × 10 000) than on Enterprise (25 000).
-- Only filled when still empty, so a re-run does not undo an admin's price.
update public.subscription_plans set extra_branch_price = 10000
  where tier = 'professional' and extra_branch_price is null;
update public.subscription_plans set extra_branch_price = 7500
  where tier = 'enterprise' and extra_branch_price is null;
update public.subscription_plans set extra_branch_price = null
  where tier = 'starter';


-- ── 3. Subscriptions: how many extra branches are paid for this period ──

-- Set by activateFromInvoice: a plan invoice writes the count it billed, a
-- branch top-up raises it. Branches beyond included + this are paused.
alter table public.subscriptions
  add column if not exists extra_branches integer not null default 0
    check (extra_branches >= 0);


-- ── 4. Invoices: what part of the amount is for branches ──

-- kind 'plan'     — a month of the plan (+ extra branches), as before.
-- kind 'branches' — a top-up for branches opened mid-period, prorated to the
--                   current end date. Does not move the end date.
alter table public.invoices
  add column if not exists kind text not null default 'plan';
alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices add constraint invoices_kind_check
  check (kind in ('plan', 'branches'));

-- 'plan': extra branches billed for the month. 'branches': the TOTAL extra
-- branches paid once this invoice is settled (a target, not a delta — two
-- top-ups racing cannot add up to more than was billed).
alter table public.invoices
  add column if not exists extra_branches integer not null default 0
    check (extra_branches >= 0);

-- The part of `amount` that pays for branches; the rest is the plan.
alter table public.invoices
  add column if not exists branch_amount integer not null default 0
    check (branch_amount >= 0);


-- ═══════════════════════════════════════════════════════════════════════════
--  5. subscription_state — every restaurant, branches on their main's row
--
--  ─────────────────────────────────────────────────────────────────────────
--   Built from RESTAURANTS now, joined to the subscription that pays for
--   each one: its own for a main, its parent's for a branch. Every reader
--   that asks "what plan is restaurant X on" — the back office, table
--   limits, the QR dining RPCs, discovery ranking — gets the right answer for
--   a branch without being told branches exist.
--
--   A PAUSED BRANCH READS 'locked'. That is the state every gate already
--   shuts on (on-site orders, QR bills, table caps), so a paused branch is
--   held to Starter in the back office with no new check anywhere.
--
--   A stray subscription row on a branch (made by hand, or before a
--   restaurant became a branch) is IGNORED: the join only ever follows the
--   parent, so a branch cannot have two answers.
--
--   The original thirteen columns keep their names, order and types —
--   `create or replace view` may only append (see 0010). `is_branch` lets the
--   renewal sweep and the admin list keep to one row per subscription.
--  ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.subscription_state as
select
  -- ── The original nine, in the original order. Do not reorder. ──
  s.id,
  r.id as restaurant_id,
  s.plan_id,
  s.start_date,
  s.end_date,
  s.grace_days,
  s.cancelled_at,
  case
    when r.parent_id is not null and r.status = 'paused'     then 'locked'
    when s.cancelled_at is not null                          then 'cancelled'
    when s.end_date is null                                  then 'active'
    when now() <= s.end_date                                 then 'active'
    when now() <= s.end_date + (s.grace_days || ' days')::interval then 'grace'
    else 'locked'
  end as state,
  case
    when s.end_date is null then null
    else greatest(0, extract(day from s.end_date - now())::integer)
  end as days_remaining,

  -- ── Appended by 0010. ──
  s.trial_ends_at,
  s.trial_used,
  (s.trial_ends_at is not null and now() <= s.trial_ends_at) as is_trialing,
  case
    when s.trial_ends_at is null then null
    else greatest(0, ceil(extract(epoch from s.trial_ends_at - now()) / 86400)::integer)
  end as trial_days_remaining,

  -- ── Appended by 0072. New columns go below this line. ──
  (r.parent_id is not null) as is_branch,
  s.restaurant_id as billing_restaurant_id,
  s.extra_branches
from public.restaurants r
join public.subscriptions s on s.restaurant_id = coalesce(r.parent_id, r.id);


-- ═══════════════════════════════════════════════════════════════════════════
--  Verify
-- ═══════════════════════════════════════════════════════════════════════════

-- Expect starter null, professional 10000, enterprise 7500 (or your prices).
select tier, name, monthly_price, included_branches, extra_branch_price
from public.subscription_plans
order by sort_order;

-- Expect one row per restaurant that has a subscription, is_branch false for
-- all of them until the first branch is opened.
select r.name, r.branch_label, st.state, st.is_branch, st.extra_branches
from public.subscription_state st
join public.restaurants r on r.id = st.restaurant_id
order by r.name, r.branch_label;
