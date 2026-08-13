-- ═══════════════════════════════════════════════════════════════════════════
--  0018 — The notification platform
--
--  Everything the in-app bell, the realtime feed and web push need on the
--  database side. Requires 0001–0017 (uses current_profile_id() from 0006).
--  Idempotent — safe to re-run.
--
--  WHAT THIS FILE ADDS, AND WHY:
--
--    · push_subscriptions       — where browser push endpoints are stored.
--    · notifications SELECT RLS — the ONLY permissive policy on this table,
--      and it exists because the bell badge and the realtime feed read with
--      the publishable key, which ships in the JS bundle. Everyone can read
--      exactly their own rows and nothing else; all writes stay server-side
--      with the service-role key, like every other table here.
--    · notification_preferences.push  — per-event push channel for managers,
--      alongside the in_app and email columns from 0012.
--    · customer_preferences.push_enabled — one master push switch per
--      customer, beside the notification_json from 0014.
--    · settings rows             — notification_sound (the platform-wide
--      sound the admin picks) and push_enabled (master switch for push).
--    · supabase_realtime         — notifications added to the publication the
--      browser subscribes to, with replica identity full so INSERT payloads
--      carry the whole row.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  1. Push subscriptions
--
--  One row per browser per person. `endpoint` is the browser's unique push
--  URL (a long https:// URL with a random segment), so it is unique. p256dh
--  and auth are the encryption keys the browser generated at subscribe time;
--  without all three the server cannot deliver a message.
--
--  NO RLS POLICIES ON PURPOSE, like the preference tables: reads and writes
--  go through the server with the service-role key, scoped to the profile id
--  from the session. RLS stays ON so the publishable key can never reach
--  anyone's endpoints.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id);

drop trigger if exists set_updated_at on public.push_subscriptions;
create trigger set_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;


-- ═══════════════════════════════════════════════════════════════════════════
--  2. Notifications — read your own, nothing else
--
--  The bell badge and the realtime subscription run in the browser with the
--  publishable key. This is the ONLY thing standing between a logged-in
--  customer and every other person's notification rows, so it must be a
--  profile-id match and nothing broader.
--
--  Marking read stays a server action (a client UPDATE would need a policy
--  that cannot prevent the client from rewriting title/body too — RLS cannot
--  restrict columns).
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists "users see their own notifications" on public.notifications;
create policy "users see their own notifications" on public.notifications
  for select to authenticated
  using (profile_id = public.current_profile_id());


-- ═══════════════════════════════════════════════════════════════════════════
--  3. Push preference columns
--
--  MISSING ROW = default, not "off", exactly like 0012: nobody is opted out
--  by never having visited the settings screen.
--
--  Both alters are existence-guarded: the preference tables come from 0012
--  and 0014, and if those have not been applied to this project yet, this
--  file must still run cleanly rather than abort the whole platform. The
--  columns are simply added later when the ancestor migrations are run and
--  this file is re-applied (every step here is idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'notification_preferences'
  ) then
    alter table public.notification_preferences
      add column if not exists push boolean not null default true;
  end if;
end $$;

-- One master switch per customer; per-event granularity lives in
-- notification_json the same way it always has.
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'customer_preferences'
  ) then
    alter table public.customer_preferences
      add column if not exists push_enabled boolean not null default true;
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  4. Settings the platform reads
--
--  notification_sound  — the file name (without .wav) the admin picked on
--                        /a/settings → Notifications. Played by the realtime
--                        feed in every shell. Must exist in public/sounds/.
--  push_enabled        — master switch for web push. Off = no push goes out,
--                        whatever anyone's preferences say.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.settings (key, value, value_type, category, label, description) values
  ('notification_sound', 'chime', 'string', 'notifications',
   'Notification sound',
   'The sound played when a realtime notification arrives. Options: chime, ding, pop, triple, alert, tri-tone.'),
  ('push_enabled', 'true', 'boolean', 'notifications',
   'Web push enabled',
   'Master switch for browser push notifications. Off blocks every push.' )
on conflict (key) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
--  5. Realtime — let the browser subscribe to new notification rows
--
--  The app already ships the Supabase browser client; this is the database
--  half. Realtime with RLS delivers each user only the rows their policy lets
--  them see, so the filter below and the policy above have to agree.
--  Idempotent: adding a table to a publication twice is an error, so both
--  steps are guarded.
-- ═══════════════════════════════════════════════════════════════════════════

-- Replica identity full is what makes every delivered row carry the complete
-- record (needed for UPDATE/DELETE events to include old values; harmless for
-- the INSERT events this app listens to, and future-proof).
alter table public.notifications replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  6. Verify
-- ═══════════════════════════════════════════════════════════════════════════

-- Expect one row: push_subscriptions, with rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'push_subscriptions';

-- Expect the notifications policy.
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'notifications';

-- Expect the two settings rows.
select key, value, category from public.settings
where key in ('notification_sound', 'push_enabled');

-- Expect the push columns.
select column_name from information_schema.columns
where table_schema = 'public'
  and table_name in ('notification_preferences', 'customer_preferences')
  and column_name in ('push', 'push_enabled');

-- Expect notifications listed in the realtime publication.
select * from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'notifications';
