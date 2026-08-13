-- ═══════════════════════════════════════════════════════════════════════════
--  0027 — Per-profile notification channels
--
--  ─────────────────────────────────────────────────────────────────────────
--  THE MASTER SWITCHES, one row per person, whatever their role.
--
--  Until now "which channels reach me" was answered three different ways and
--  not at all for one role:
--
--    · manager  — notification_preferences (0012): per branch, per EVENT,
--      per channel. Fine-grained, but nothing above it: you could not say
--      "no email at all, ever".
--    · customer — customer_preferences (0014): per TOPIC, plus a single
--      push_enabled flag. No way to keep in-app and drop email.
--    · admin    — nothing. lib/notify.ts hardcoded `{ inApp: true, email:
--      true, push: true }` for every admin, so the one role that gets the
--      most traffic was the one role that could not turn any of it down.
--
--  This table is the layer ABOVE all of that: three master switches that
--  every actor gets the same screen for. The per-event and per-topic tables
--  keep deciding WHICH events reach you; this decides which channels are
--  open at all. lib/notify.ts ANDs the two — a channel needs both the event
--  and the master switch to say yes.
--  ─────────────────────────────────────────────────────────────────────────
--
--  A MISSING ROW MEANS "all three on", the same rule as 0012 and 0014:
--  nobody is silenced by never having opened the screen.
--
--  Run after 0018 (push_subscriptions). Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.notification_channels (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,

  -- The bell row, and therefore the live toast + sound: they are the same
  -- delivery, seen twice. Turning this off stops both.
  in_app      boolean not null default true,
  email       boolean not null default true,
  -- The master switch for web push. Separate from push_subscriptions: the
  -- subscription is "this browser can receive", this is "and I want it to".
  push        boolean not null default true,

  updated_at  timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.notification_channels;
create trigger set_updated_at before update on public.notification_channels
  for each row execute function public.set_updated_at();

-- Deny by default, like customer_preferences and push_subscriptions. Reads
-- and writes go through the server with the service-role key, always scoped
-- to the profile id from the session — no permissive policy on purpose.
alter table public.notification_channels enable row level security;


-- ═══════════════════════════════════════════════════════════════════════════
--  Verify — expect one row here, with rowsecurity = true.
-- ═══════════════════════════════════════════════════════════════════════════

select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'notification_channels';

-- Expect four columns beyond the key: in_app, email, push, updated_at.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'notification_channels'
order by ordinal_position;
