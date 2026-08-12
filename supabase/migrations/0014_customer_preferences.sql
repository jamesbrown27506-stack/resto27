-- ═══════════════════════════════════════════════════════════════════════════
--  0014 — Customer notification preferences
--
--  ─────────────────────────────────────────────────────────────────────────
--  The /settings screen offers four switches (order_status, reservations,
--  loyalty, promotions). Until now nothing stored them, and every page under
--  (customer) was rendered from fixture files.
--
--  This is the table that makes the switches true. It is deliberately NOT
--  the 0012 notification_preferences table, which is per restaurant, per
--  profile, per event — owned by the restaurant side of the product. These
--  switches are the customer's own channel choices, and they are the same
--  whatever branch they order from.
--  ─────────────────────────────────────────────────────────────────────────
--
--  A MISSING ROW MEANS "defaults" — nobody who never touched this screen is
--  opted out. The read layer (lib/data/customer.ts) merges stored booleans
--  over the defaults, so a future switch arrives true for everyone who did
--  not explicitly turn it off.
--
--  Run after 0013. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.customer_preferences (
  profile_id        uuid primary key references public.profiles(id) on delete cascade,

  -- Keys match the interface: order_status, reservations, loyalty,
  -- promotions. The order_status switch is locked in the UI but stored
  -- anyway, so the saved row describes the whole screen.
  notification_json jsonb not null default '{}'::jsonb,

  updated_at        timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.customer_preferences;
create trigger set_updated_at before update on public.customer_preferences
  for each row execute function public.set_updated_at();

-- Deny by default, like every other table in this schema. Reads and writes go
-- through the server with the service-role key and are scoped to the
-- customer's own profile id from the session — no permissive policy on
-- purpose.
alter table public.customer_preferences enable row level security;

-- The profile id is the primary key; there is exactly one lookup pattern.
