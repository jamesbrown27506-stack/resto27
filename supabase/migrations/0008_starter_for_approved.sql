-- ═══════════════════════════════════════════════════════════════════════════
--  0008 — Repair: approved restaurants with no subscription row
--
--  ─────────────────────────────────────────────────────────────────────────
--   THE BUG THIS REPAIRS
--
--   Approving a restaurant created no subscription. Two things followed, and
--   they made each other worse:
--
--     · The manager's dashboard treated "no row" as `locked` — so a
--       restaurant approved minutes earlier, owing nothing, was told
--       "Compte verrouillé. Réglez votre facture." with every link but
--       billing disabled. There was no invoice to settle.
--
--     · /a/subscriptions reads the subscription_state view, which is built
--       FROM subscriptions. A restaurant without a row was not listed as
--       "no plan" — it was ABSENT. So the one screen that could have fixed
--       it could not see the tenant that needed fixing.
--
--   Approval now grants Starter, and the dashboard treats a missing row as
--   free-Starter-active rather than locked. This file fixes what already
--   exists.
--  ─────────────────────────────────────────────────────────────────────────
--
--  Safe to re-run: the WHERE clause matches nothing once it has run.
-- ═══════════════════════════════════════════════════════════════════════════

-- Look first.
select r.id, r.name, r.status
from public.restaurants r
left join public.subscriptions s on s.restaurant_id = r.id
where s.id is null and r.status <> 'pending'
order by r.name;


-- Grant Starter: 0 FCFA, and end_date NULL means NEVER EXPIRES (§5 rule 1).
--
-- Not a far-future date. Null is the only value that cannot later be mistaken
-- for a deadline by a comparison somebody writes in six months.
insert into public.subscriptions (restaurant_id, plan_id, start_date, end_date, grace_days)
select r.id,
       (select id from public.subscription_plans where tier = 'starter'),
       now(),
       null,
       coalesce((select value::integer from public.settings where key = 'subscription_grace_days'), 3)
from public.restaurants r
left join public.subscriptions s on s.restaurant_id = r.id
where s.id is null
  and r.status <> 'pending'
  and exists (select 1 from public.subscription_plans where tier = 'starter')
on conflict (restaurant_id) do nothing;


-- Expect zero rows.
select r.name
from public.restaurants r
left join public.subscriptions s on s.restaurant_id = r.id
where s.id is null and r.status <> 'pending';


-- What every tenant is on now.
select r.name, r.status, p.name as plan, st.state, st.end_date
from public.restaurants r
join public.subscriptions s  on s.restaurant_id = r.id
join public.subscription_plans p on p.id = s.plan_id
join public.subscription_state st on st.restaurant_id = r.id
order by r.name;
