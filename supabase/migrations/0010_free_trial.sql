-- ═══════════════════════════════════════════════════════════════════════════
--  0010 — Seven-day free trial on the paid plans
--
--  ─────────────────────────────────────────────────────────────────────────
--   A TRIAL IS JUST A SUBSCRIPTION WITH AN END DATE AND NO INVOICE.
--
--   No new state, and that is the point. `subscription_state` already turns
--   end_date + grace_days + now() into active / grace / locked, so a trial
--   behaves exactly like a paid month: full access for seven days, then the
--   grace window, then Starter limits. Every guard, banner and limit check
--   downstream keeps working with no change.
--
--   The two columns below only LABEL it, so the interface can say "3 days
--   left in your trial" rather than "renews in 3 days". Nothing branches on
--   them for access.
--  ─────────────────────────────────────────────────────────────────────────
--
--  Run after 0009. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- How many free days each plan offers. NULL = no trial.
-- Per-plan rather than a constant, so a campaign ("14 days this month") is a
-- data change and not a deploy.
alter table public.subscription_plans
  add column if not exists trial_days integer check (trial_days is null or trial_days > 0);

update public.subscription_plans set trial_days = null where tier = 'starter';
update public.subscription_plans set trial_days = 7    where tier in ('professional', 'enterprise');


alter table public.subscriptions
  add column if not exists trial_ends_at timestamptz;

-- ONE TRIAL PER RESTAURANT, EVER.
--
-- Not one per plan. Otherwise the loop is obvious and free: trial
-- Professional, drop to Starter, trial Enterprise, drop to Starter, repeat.
-- A flag that is only ever set to true cannot be cycled.
alter table public.subscriptions
  add column if not exists trial_used boolean not null default false;


-- ═══════════════════════════════════════════════════════════════════════════
--  The view gains four labels. `state` is untouched — see the note above.
--
--  ─────────────────────────────────────────────────────────────────────────
--   THE NEW COLUMNS GO AT THE END, AND THAT IS NOT COSMETIC.
--
--   `create or replace view` may only APPEND columns. It cannot insert one in
--   the middle, because that renames every column after it — Postgres refuses
--   with "cannot change name of view column 'state' to 'trial_ends_at'".
--
--   Keeping the original nine in their original order means this replaces
--   cleanly, with no DROP. Dropping the view would work too, but only until
--   something else comes to depend on it — at which point the drop either
--   fails or, with CASCADE, silently takes that dependent with it.
--  ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.subscription_state as
select
  -- ── The original nine, in the original order. Do not reorder. ──
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
  end as days_remaining,

  -- ── Appended by 0010. New columns go below this line. ──
  s.trial_ends_at,
  s.trial_used,
  -- True only while the trial is actually running. A past trial_ends_at is
  -- history, not a state.
  (s.trial_ends_at is not null and now() <= s.trial_ends_at) as is_trialing,
  -- Counted here rather than in the app. `Date.now()` during a React render is
  -- impure and the compiler rejects it outright — and a clock that lives in
  -- one place cannot disagree with itself.
  case
    when s.trial_ends_at is null then null
    else greatest(0, ceil(extract(epoch from s.trial_ends_at - now()) / 86400)::integer)
  end as trial_days_remaining
from public.subscriptions s;


-- ═══════════════════════════════════════════════════════════════════════════
--  Verify
-- ═══════════════════════════════════════════════════════════════════════════

select tier, name, monthly_price, trial_days
from public.subscription_plans
order by sort_order;

select r.name, p.name as plan, st.state, st.is_trialing, st.trial_ends_at, st.days_remaining
from public.subscription_state st
join public.restaurants r on r.id = st.restaurant_id
join public.subscription_plans p on p.id = st.plan_id
order by r.name;
