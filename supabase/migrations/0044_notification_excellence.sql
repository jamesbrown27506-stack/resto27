-- 0044 — Notification excellence: watchdog dedupe stamps, reminders,
-- quiet hours, heartbeats, and push-failure pruning.
--
-- Everything here is additive and idempotent. Run it in the SQL editor the
-- same way as 0039/0040 (which must be applied BEFORE this one — the crons
-- added alongside this migration scan the awaiting_customer / awaiting_payment
-- statuses those two introduce).

-- ── Orders: one stamp per watchdog, so a sweep alerts once, not forever ──
alter table public.orders
  add column if not exists pending_alert_count integer not null default 0,
  add column if not exists pending_alert_at timestamptz,
  add column if not exists fee_reminder_at timestamptz,
  add column if not exists fee_escalated_at timestamptz,
  add column if not exists review_prompt_at timestamptz,
  add column if not exists due_alert_at timestamptz;

-- The sweeps run every few minutes; give each scan a cheap partial index.
create index if not exists orders_pending_watch_idx
  on public.orders (created_at)
  where status = 'pending';

create index if not exists orders_fee_watch_idx
  on public.orders (delivery_fee_set_at)
  where status = 'awaiting_customer';

create index if not exists orders_review_prompt_idx
  on public.orders (delivered_at)
  where status = 'delivered' and review_prompt_at is null;

-- ── Reservations: reminder ladder (0 = none, 1 = day-before, 2 = soon) ──
alter table public.reservations
  add column if not exists reminder_stage smallint not null default 0;

create index if not exists reservations_reminder_idx
  on public.reservations (reserved_for)
  where status in ('confirmed', 'awaiting_payment');

-- ── Quiet hours + snooze on the master channel switches (0027) ──────────
-- Minutes since midnight, Africa/Douala. NULL = no quiet hours configured.
alter table public.notification_channels
  add column if not exists quiet_start smallint,
  add column if not exists quiet_end smallint,
  add column if not exists snoozed_until timestamptz;

-- ── Heartbeats: which background sweep last ran, and when ───────────────
-- /a/health reads this instead of fabricating a reconciler timestamp.
create table if not exists public.ops_heartbeats (
  key text primary key,
  ran_at timestamptz not null default now(),
  detail jsonb
);

alter table public.ops_heartbeats enable row level security;
-- Server-only, like the prefs tables: RLS on, no policies.

-- ── record_push_failure now reports the running count ───────────────────
-- The sender uses the count to retire an endpoint that has been refused
-- repeatedly with a permanent-class code. A return type cannot change under
-- CREATE OR REPLACE, so drop and recreate with the original grants.
drop function if exists public.record_push_failure(uuid, integer);

create function public.record_push_failure(p_subscription_id uuid, p_failure_code integer)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.push_subscriptions
  set last_failure_at = now(),
      last_failure_code = p_failure_code,
      failure_count = failure_count + 1
  where id = p_subscription_id
  returning failure_count;
$$;

revoke all on function public.record_push_failure(uuid, integer) from public;
revoke all on function public.record_push_failure(uuid, integer) from anon;
revoke all on function public.record_push_failure(uuid, integer) from authenticated;
grant execute on function public.record_push_failure(uuid, integer) to service_role;

-- ── Verification — every query below should return rows ─────────────────
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name in ('pending_alert_count', 'pending_alert_at', 'fee_reminder_at',
                      'fee_escalated_at', 'review_prompt_at', 'due_alert_at');

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'reservations'
  and column_name = 'reminder_stage';

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'notification_channels'
  and column_name in ('quiet_start', 'quiet_end', 'snoozed_until');

select table_name from information_schema.tables
where table_schema = 'public' and table_name = 'ops_heartbeats';

select routine_name, data_type from information_schema.routines
where routine_schema = 'public' and routine_name = 'record_push_failure';
