-- ═══════════════════════════════════════════════════════════════════════════
--  0002 — Backfill profiles for users that predate the trigger
--
--  WHY THIS EXISTS
--
--  Supabase splits identity across two schemas:
--
--    auth.users       owned by Supabase Auth. NOT visible in the Table Editor,
--                     which only shows `public`. Lives under
--                     Authentication → Users in the dashboard.
--    public.profiles  ours. Every foreign key in the app points at
--                     profiles.id, never at auth.users.id (see 0001).
--
--  handle_new_user() keeps them in step, but it only fires on INSERT. Any
--  account created BEFORE the trigger existed — or during a window where it
--  failed — has a row in auth.users and none in public.profiles.
--
--  That is an orphan, and it is worse than having no account at all: the
--  person can sign in (auth.users is all Supabase checks) but the app cannot
--  find their profile, so every guarded page rejects them.
--
--  Safe to run repeatedly.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Diagnose ────────────────────────────────────────────────────────────
-- Run this on its own first. `profile_id` NULL = orphan.

select
  u.id                  as auth_user_id,
  u.email,
  u.created_at,
  u.email_confirmed_at,                      -- null = signed up, never confirmed
  u.raw_user_meta_data ->> 'role' as intended_role,
  p.id                  as profile_id        -- NULL means orphaned
from auth.users u
left join public.profiles p on p.auth_user_id = u.id::text
order by u.created_at desc;


-- ── 2. Repair ──────────────────────────────────────────────────────────────
-- Creates the missing profile rows, mirroring handle_new_user() exactly.

insert into public.profiles (auth_user_id, name, email, phone, role, status)
select
  u.id::text,
  coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), split_part(u.email, '@', 1)),
  u.email,
  nullif(u.raw_user_meta_data ->> 'phone', ''),
  -- Floored to customer|manager. An 'admin' arriving in user metadata is
  -- attacker-controlled and is never trusted — same rule as the trigger.
  case when u.raw_user_meta_data ->> 'role' = 'manager' then 'manager' else 'customer' end,
  -- Restaurants wait for approval (§14.2); diners are active immediately.
  case when u.raw_user_meta_data ->> 'role' = 'manager' then 'pending'  else 'active'   end
from auth.users u
left join public.profiles p on p.auth_user_id = u.id::text
where p.id is null
  and u.email is not null
on conflict (auth_user_id) do nothing;


-- ── 3. Verify ──────────────────────────────────────────────────────────────
-- Expect 0.

select count(*) as remaining_orphans
from auth.users u
left join public.profiles p on p.auth_user_id = u.id::text
where p.id is null;


-- ═══════════════════════════════════════════════════════════════════════════
--  ALTERNATIVE: start clean
--
--  If these are only test accounts, deleting them is simpler than repairing
--  them and lets you re-run the real signup flow end to end.
--
--  Dashboard → Authentication → Users → select → Delete.
--
--  Or, for a specific address:
--
--    delete from auth.users where email = 'you@example.com';
--
--  profiles.auth_user_id is deliberately NOT a foreign key to auth.users
--  (see 0001), so deleting the auth row leaves any profile behind. Clear both:
--
--    delete from public.profiles where email = 'you@example.com';
--    delete from auth.users      where email = 'you@example.com';
--
--  That decoupling is intentional — it is what makes swapping Supabase Auth
--  for Clerk later a one-column change instead of a migration across every
--  table that references a user.
-- ═══════════════════════════════════════════════════════════════════════════
