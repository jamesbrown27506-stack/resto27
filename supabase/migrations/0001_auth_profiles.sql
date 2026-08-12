-- ═══════════════════════════════════════════════════════════════════════════
--  0001 — Identity
--
--  Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--  Idempotent: safe to run more than once.
--
--  Scope is identity only. The other 40 tables land with the schema migration;
--  this is the minimum needed for real authentication.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  profiles
--
--  DELIBERATE DEVIATION FROM THE SPEC (explanation.md B.2).
--
--  B.2 has `profiles.id uuid primary key references auth.users(id)`, which
--  makes Supabase's user id the primary key of our entire identity model.
--  Every one of the ~15 tables that reference a user would then hold a
--  Supabase id, and moving to Clerk later means rewriting foreign keys across
--  live financial rows.
--
--  Instead: `id` is OURS, `auth_user_id` is the provider's. Swapping identity
--  provider rewrites one column and the login path. Orders, payments, audit
--  log and commission statements never move.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),

  -- The current identity provider's id for this person. Supabase today; a
  -- Clerk `user_2abc…` tomorrow. `text` rather than `uuid` precisely so that
  -- migration does not require a type change.
  auth_user_id  text not null unique,

  name          text not null,
  email         text not null,
  phone         text,
  avatar_url    text,

  -- customer | manager | admin.
  --
  -- `manager` means only "this person works at a restaurant" (§2). Real
  -- permission comes from restaurant_staff.role, PER BRANCH — the same person
  -- can be owner at one location and waiter at another. Never collapse the
  -- two levels into this column.
  role          text not null default 'customer'
                check (role in ('customer', 'manager', 'admin')),

  -- active | pending | suspended.
  --
  -- Checked SERVER-SIDE ON EVERY REQUEST, not just at login. Supabase issues
  -- short-lived JWTs; `auth.admin.signOut()` kills refresh tokens but an
  -- already-issued access token stays valid for up to an hour (B.2). Without
  -- the per-request check, suspending an account does nothing for an hour —
  -- which is §12 hard rule #6.
  status        text not null default 'active'
                check (status in ('active', 'pending', 'suspended')),

  -- ANONYMISATION MARKER, NOT DELETION (§12 hard rule #7).
  --
  -- Deleting a user with orders would destroy the restaurant's sales history
  -- and the platform's commission record. Identity fields get overwritten;
  -- every other row stays exactly where it is.
  deleted_at    timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists profiles_auth_user_id_idx on public.profiles (auth_user_id);
create index if not exists profiles_role_status_idx  on public.profiles (role, status);

-- Postgres has no ON UPDATE CURRENT_TIMESTAMP (§16), so it needs a trigger.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  Create a profile whenever someone signs up
--
--  Runs as SECURITY DEFINER because the signing-up user has no rights on
--  public.profiles yet. `search_path` is pinned — a SECURITY DEFINER function
--  with a mutable search_path is a privilege-escalation path.
--
--  Restaurant applications arrive as status = 'pending' (§14.2): the user AND
--  the restaurant both wait for admin approval.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := coalesce(new.raw_user_meta_data ->> 'role', 'customer');
begin
  -- Only these two may ever be self-assigned at signup. An 'admin' arriving in
  -- client-supplied metadata is an escalation attempt, so it is floored to
  -- 'customer' rather than trusted. Administrators are created only from
  -- /a/users, by an existing administrator.
  if requested_role not in ('customer', 'manager') then
    requested_role := 'customer';
  end if;

  insert into public.profiles (auth_user_id, name, email, phone, role, status)
  values (
    new.id::text,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    requested_role,
    -- Restaurant owners wait for approval; diners are active immediately.
    case when requested_role = 'manager' then 'pending' else 'active' end
  )
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────────────────────────────────────────────────────
--  Row Level Security
--
--  NOT OPTIONAL (explanation.md B.1). The publishable key is public — it ships
--  in the JavaScript bundle. Tables created by migration have RLS OFF by
--  default, so without this block `profiles` is readable by anyone on the
--  internet holding a key that is printed in our own source.
--
--  Policies here are minimal on purpose. Authorization lives in
--  `lib/auth/rbac`, server-side; RLS is the fence, not the logic. Expressing
--  20 capabilities × 5 branch roles as SQL policies would be unreadable,
--  untestable, and duplicated — the app needs the same rules to decide what
--  to render anyway.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "own profile readable" on public.profiles;
create policy "own profile readable"
  on public.profiles for select
  using (auth_user_id = auth.uid()::text);

-- Note the WITH CHECK clause. Without it a user could update their own row and
-- set role = 'admin' in the same statement: USING controls which rows you may
-- touch, WITH CHECK controls what they may become.
drop policy if exists "own profile updatable" on public.profiles;
create policy "own profile updatable"
  on public.profiles for update
  using (auth_user_id = auth.uid()::text)
  with check (
    auth_user_id = auth.uid()::text
    and role = (select p.role from public.profiles p where p.auth_user_id = auth.uid()::text)
    and status = (select p.status from public.profiles p where p.auth_user_id = auth.uid()::text)
  );

-- No INSERT or DELETE policy, deliberately:
--   · INSERT happens only through handle_new_user() above.
--   · DELETE never happens at all — accounts are ANONYMISED (§12 rule #7).
--     A missing policy means nothing gets through except the secret key.

-- ═══════════════════════════════════════════════════════════════════════════
--  AFTER RUNNING THIS
--
--  1. Settings → API → Exposed schemas → remove `public`.
--     The app talks to Postgres directly, so it loses nothing, and this alone
--     closes the auto-generated REST API to the public key (B.1 step A).
--
--  2. Authentication → Sign In / Providers → Email → "Confirm email".
--
--     OFF while developing: signup returns a live session and the app signs
--     you straight in. The code reads the returned session rather than a flag
--     of its own, so this toggle needs no code change either way.
--
--     TURN IT BACK ON BEFORE REAL TRAFFIC. With it off, anyone can register
--     using an address they do not own — which matters here because the
--     address is how a customer receives order updates and how a restaurant
--     receives its approval and its invoices.
--
--  3. Authentication → URL Configuration → Site URL = http://localhost:3000
--     and add http://localhost:3000/** to Redirect URLs, or the password-reset
--     link will bounce.
--
--  4. Authentication → Emails: Supabase's built-in SMTP is rate-limited and
--     not for production (§13). Wire Resend or Brevo before real traffic.
-- ═══════════════════════════════════════════════════════════════════════════
