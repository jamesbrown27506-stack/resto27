-- 0064 — a user cannot make themselves a super administrator
--
-- Run AFTER 0063 (it references profiles.is_super_admin).
--
-- ─────────────────────────────────────────────────────────────────────────
--  THE SELF-UPDATE POLICY PINNED `role` AND `status` — AND NOTHING ELSE.
--
--  0001's "own profile updatable" lets every signed-in user update their own
--  row through the public REST API (their JWT + the publishable key that
--  ships in the JavaScript bundle). Its WITH CHECK stops them changing
--  `role` or `status`. It could not know about `is_super_admin`, which 0063
--  added — so any SIMPLE admin could PATCH their own row to
--  is_super_admin = true and hand themselves every money switch on the
--  platform, with no audit row.
--
--  (A customer setting it gains nothing today — the app only honours the
--  flag on role = 'admin' — but it would lie dormant and take effect the
--  day that account is made an administrator. Pinned for everyone.)
--
--  Same fix as the role: the new value must equal the current one. Only the
--  secret key (the admin client, i.e. /a/admins) can change it.
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists "own profile updatable" on public.profiles;
create policy "own profile updatable"
  on public.profiles for update
  using (auth_user_id = auth.uid()::text)
  with check (
    auth_user_id = auth.uid()::text
    and role = (select p.role from public.profiles p where p.auth_user_id = auth.uid()::text)
    and status = (select p.status from public.profiles p where p.auth_user_id = auth.uid()::text)
    and is_super_admin = (select p.is_super_admin from public.profiles p where p.auth_user_id = auth.uid()::text)
  );

-- Verify: the policy now mentions is_super_admin.
select policyname, with_check from pg_policies
where schemaname = 'public' and tablename = 'profiles' and policyname = 'own profile updatable';
