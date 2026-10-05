-- 0076 — Deny by default: the browser key reads only what the browser needs
--        and writes nothing; money guards from the 2026-10-05 security review.
--
-- Run AFTER 0075. Safe to run twice.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WHY: THE PUBLISHABLE KEY SHIPS IN THE JAVASCRIPT BUNDLE.
--
--  Anyone can call PostgREST with it, as `anon`, or as `authenticated` with
--  the JWT of any account they sign up. Several old policies still let those
--  roles WRITE, and the review found real money paths through them:
--
--   · "managers edit the roster" (0006) — a manager PATCHed their own
--     restaurant_staff row to role = 'owner', and owners may always set a
--     PIN, save a number and withdraw: the whole wallet, past every 0073
--     control. Same policy: suspend or delete the real owner, enrol anyone.
--   · "managers decide reservations" (0034) — a manager raised a paid
--     booking's deposit_amount, cancelled it, and restaurant_cancel_
--     reservation refunded the raised amount to the phone that paid: theirs.
--   · the menu and promotion `for all` policies (0006) — past every plan
--     ceiling the actions enforce.
--   · "own profile updatable" (0064) — `email` was not pinned, and two
--     checks trusted it (the PIN's password check, "add administrator").
--
--  And reads leaked: every restaurant's subscription (subscription_state is
--  a view, it ran with its owner's rights — confirmed with the anon key on
--  2026-10-05), every restaurant's phone number and owner id, and guests'
--  phone and email to every kitchen and waiter account.
--
--  THE APP NEEDS NONE OF IT. Every table write goes through the server's
--  secret key (createAdminClient), which this migration does not touch. The
--  user-session and browser clients only:
--    · read their own profile                       (lib/auth/session.ts)
--    · read service areas and quartiers             (lib/data/signup.ts)
--    · receive Realtime changes on notifications, conversation_messages and
--      restaurant_signals, whose policies also read conversations,
--      restaurant_staff and profiles.
--  So: revoke everything from anon and authenticated, grant back exactly
--  those SELECTs, and make it the default for every table created later.
--
--  A NEW TABLE THE BROWSER MUST READ (Realtime) NOW NEEDS AN EXPLICIT
--  `grant select ... to authenticated` IN ITS MIGRATION. Server code is
--  unaffected: service_role keeps everything.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Tables and views: nothing for anon / authenticated ... ─────────────

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ... except what the browser and the user session actually read.
grant select on public.service_areas, public.quartiers to anon, authenticated;
grant select on public.profiles            to authenticated;
grant select on public.notifications       to authenticated;
grant select on public.conversations       to authenticated;
grant select on public.conversation_messages to authenticated;
grant select on public.restaurant_staff    to authenticated;
grant select on public.restaurant_signals  to authenticated;

-- The server keeps everything (it already had it; stated so nothing here
-- can ever leave it short).
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Every table created from now on starts closed to the browser key.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;


-- ── 2. The write policies, dropped — inert after §1, gone so a future
--       grant cannot bring them back ─────────────────────────────────────────

drop policy if exists "managers edit the roster"          on public.restaurant_staff;
drop policy if exists "staff manage their categories"     on public.menu_categories;
drop policy if exists "staff manage their items"          on public.menu_items;
drop policy if exists "staff manage their option groups"  on public.menu_option_groups;
drop policy if exists "staff manage their options"        on public.menu_options;
drop policy if exists "managers run their own promotions" on public.promotions;
drop policy if exists "managers book reservations"        on public.reservations;
drop policy if exists "managers decide reservations"      on public.reservations;
drop policy if exists "managers remove reservations"      on public.reservations;
drop policy if exists "own profile updatable"             on public.profiles;


-- ── 3. subscription_state reads with the caller's rights ──────────────────
--  (The revoke in §1 already closes it; this keeps it closed if a grant ever
--  comes back — the view then obeys RLS on subscriptions like a table.)

alter view public.subscription_state set (security_invoker = true);


-- ── 4. Functions: nobody but the server, except the policy helpers ────────
--
--  Every RPC was already revoked one by one, except request_dining_access
--  (0054 revoked it from PUBLIC only; 0057 re-created it). Blanket now, so a
--  future `create function` that forgets its revoke is not an open door.

drop function if exists public.request_dining_access(uuid, text, text);

revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on all functions in schema public to service_role;

-- The helpers the remaining SELECT policies call. They only describe the
-- caller (who am I, where do I work).
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.is_staff_of(uuid)    to authenticated;
grant execute on function public.staff_role_at(uuid)  to authenticated;
grant execute on function public.can_manage(uuid)     to authenticated;
grant execute on function public.is_platform_admin()  to authenticated;

alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;


-- ── 5. A paid deposit's amount is final ───────────────────────────────────
--
--  Both cancellation functions refund `deposit_amount`. Once the deposit is
--  paid the app never changes that amount (customer-actions only re-prices
--  an UNPAID one), so the database now refuses it for every writer — the
--  service key included. Closes the fake-refund path even if a future bug
--  or grant reopens a write.

create or replace function public.reservations_paid_deposit_is_final()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.deposit_paid and new.deposit_amount is distinct from old.deposit_amount then
    raise exception 'paid_deposit_is_final' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists reservations_paid_deposit_is_final on public.reservations;
create trigger reservations_paid_deposit_is_final
  before update of deposit_amount on public.reservations
  for each row execute function public.reservations_paid_deposit_is_final();


-- ── 6. A wrong withdrawal PIN is counted under a row lock ─────────────────
--
--  The count was a compare-and-swap from the app: a hundred guesses sent at
--  once read the same count and cost one attempt. lib/wallet/controls.ts
--  calls this instead (and falls back to the old way until it exists).
--  Mirrors afterWrongPin(): the fifth wrong code locks for p_lock_minutes
--  and resets the count; a locked code counts nothing more.

create or replace function public.withdrawal_pin_wrong(
  p_profile_id   uuid,
  p_max          integer,
  p_lock_minutes integer
) returns table (out_attempts integer, out_locked_until timestamptz, out_just_locked boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
  v_locked   timestamptz;
begin
  select wp.failed_attempts, wp.locked_until
    into v_attempts, v_locked
    from public.withdrawal_pins wp
   where wp.profile_id = p_profile_id
   for update;

  if not found then
    return;
  end if;

  if v_locked is not null and v_locked > now() then
    return query select coalesce(v_attempts, 0), v_locked, false;
    return;
  end if;

  if coalesce(v_attempts, 0) + 1 >= p_max then
    v_locked := now() + make_interval(mins => p_lock_minutes);
    update public.withdrawal_pins
       set failed_attempts = 0, locked_until = v_locked
     where profile_id = p_profile_id;
    return query select 0, v_locked, true;
  else
    update public.withdrawal_pins
       set failed_attempts = coalesce(v_attempts, 0) + 1, locked_until = null
     where profile_id = p_profile_id;
    return query select coalesce(v_attempts, 0) + 1, null::timestamptz, false;
  end if;
end;
$$;

revoke execute on function public.withdrawal_pin_wrong(uuid, integer, integer) from public, anon, authenticated;
grant  execute on function public.withdrawal_pin_wrong(uuid, integer, integer) to service_role;


-- ── Verify ────────────────────────────────────────────────────────────────
--  Expect: false, false, false, true, false.
select
  has_table_privilege('anon', 'public.subscription_state', 'select')          as anon_reads_subscriptions,
  has_table_privilege('anon', 'public.restaurants', 'select')                 as anon_reads_restaurants,
  has_table_privilege('authenticated', 'public.restaurant_staff', 'update')   as users_write_staff,
  has_table_privilege('authenticated', 'public.notifications', 'select')      as users_read_notifications,
  exists (select 1 from pg_proc where proname = 'request_dining_access')      as old_qr_function_exists;
