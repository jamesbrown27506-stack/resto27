-- ═══════════════════════════════════════════════════════════════════════════
--  0012 — Notification preferences that are actually stored
--
--  ─────────────────────────────────────────────────────────────────────────
--   /m/settings has always rendered six notification switches and a Save
--   button that only fired a toast. The file's own comment states the rule it
--   was breaking: "a settings screen whose switches do nothing is worse than
--   no settings screen, because it makes people stop trusting the ones that
--   do work."
--
--   This is the table that makes them true.
--  ─────────────────────────────────────────────────────────────────────────
--
--  PER PERSON, PER BRANCH — not per restaurant. The owner wants the billing
--  emails; the kitchen account wants new orders and nothing else; and someone
--  who works at two branches will want different answers at each. A single
--  row per restaurant cannot express any of that.
--
--  A MISSING ROW MEANS "the default for that event", not "off". Nobody is
--  opted out by never having visited this screen, and adding a new event type
--  later does not arrive silenced for every existing user.
--
--  Run after 0011. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.notification_preferences (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id)    on delete cascade,

  -- Matches the keys the interface and lib/notify use: 'new_order',
  -- 'order_cancelled', 'reservation', 'review', 'low_stock', 'billing'.
  -- Deliberately text and not an enum: adding an event type should be a
  -- deploy, not a migration that locks the table.
  event_key     text    not null,

  in_app        boolean not null default true,
  email         boolean not null default true,

  updated_at    timestamptz not null default now(),

  primary key (restaurant_id, profile_id, event_key)
);

drop trigger if exists set_updated_at on public.notification_preferences;
create trigger set_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- Deny by default, like every other table in this schema. Reads and writes go
-- through the server with the service-role key, which scopes them to the
-- branch resolved from the session — the same boundary every other manager
-- query uses. No permissive policy is added on purpose.
alter table public.notification_preferences enable row level security;

-- Reading one person's whole preference set for a branch is the only access
-- pattern; the primary key already serves it left-to-right.
