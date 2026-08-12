-- ═══════════════════════════════════════════════════════════════════════════
--  0007 — Repair: owners of approved restaurants who were left pending
--
--  ─────────────────────────────────────────────────────────────────────────
--   THE BUG THIS REPAIRS
--
--   There are two statuses, and approving a restaurant only ever set one:
--
--     restaurants.status  — is the tenant listed to customers?
--     profiles.status     — may this person sign in at all?
--
--   The signup trigger creates manager profiles as `pending`, and sign-in
--   refuses a pending profile. So an approved restaurant showed `active` on
--   /a/restaurants, was live in the database, emailed its owner "you are
--   live" — and that owner was still told their account was awaiting
--   approval, with nothing in the product able to clear it.
--
--   setRestaurantStatus() now activates the owner as part of approving. This
--   file fixes the ones approved before that.
--  ─────────────────────────────────────────────────────────────────────────
--
--  Safe to re-run: the WHERE clause matches nothing once it has run.
-- ═══════════════════════════════════════════════════════════════════════════

-- Look first. These are the accounts that cannot sign in.
select p.id, p.name, p.email, p.status as profile_status,
       r.name as restaurant, r.status as restaurant_status
from public.profiles p
join public.restaurants r on r.owner_id = p.id
where r.status = 'active'
  and p.status = 'pending'
  and p.deleted_at is null;


-- Fix them.
--
-- `status = 'pending'` is in the WHERE, not just the SELECT above: a profile
-- an admin deliberately SUSPENDED must stay suspended. Owning an approved
-- restaurant is not a reason to undo a moderation decision nobody revisited.
update public.profiles p
set status = 'active'
where p.status = 'pending'
  and p.deleted_at is null
  and exists (
    select 1 from public.restaurants r
    where r.owner_id = p.id and r.status = 'active'
  );


-- Expect zero rows now.
select p.email, p.status
from public.profiles p
join public.restaurants r on r.owner_id = p.id
where r.status = 'active' and p.status = 'pending' and p.deleted_at is null;
