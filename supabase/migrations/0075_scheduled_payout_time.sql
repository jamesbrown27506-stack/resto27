-- ═══════════════════════════════════════════════════════════════════════════
--  0075 — Scheduled payouts at the hour the owner chooses
--
--  ─────────────────────────────────────────────────────────────────────────
--   0074 sent scheduled payouts once a night, with the daily job (~03:15
--   Douala). An owner who set "every Sunday" on a Sunday afternoon waited a
--   week, and nobody could say "every evening at 21:00, after service".
--
--   Now each schedule has an HOUR (Douala time). The payment checker that
--   already runs every five minutes (resto237-reconcile) also sends the
--   schedules whose hour has come — and, like every job since 0065, it is
--   GATED IN THE DATABASE: Vercel is only called when cron_due_payments()
--   says something is due, so this costs nothing on the quiet days.
--
--   A schedule whose hour has ALREADY PASSED today, on one of its days, is
--   due at once: setting it up on a Sunday afternoon for "Sundays at 9:00"
--   sends today's payout within minutes rather than skipping a week. The
--   screen says so before the owner saves.
--  ─────────────────────────────────────────────────────────────────────────
--
--  Run after 0074. Idempotent. Before it is run, schedules keep the 0074
--  behaviour: once a night, with the daily job.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.scheduled_payouts
  add column if not exists hour integer not null default 3
    check (hour between 0 and 23);

-- Is a scheduled payout due right now? The SQL twin of scheduleDue() in
-- lib/wallet/schedule-rules.ts — keep the two in step.
create or replace function public.scheduled_payout_due_now()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with clock as (
    select (now() at time zone 'Africa/Douala') as local
  )
  select exists (
    select 1
    from public.scheduled_payouts s, clock
    where s.enabled
      and extract(hour from clock.local) >= s.hour
      -- not already run today (Douala day)
      and (s.last_run_at is null
           or (s.last_run_at at time zone 'Africa/Douala')::date < clock.local::date)
      and case s.frequency
            when 'daily'   then true
            when 'weekly'  then extract(dow from clock.local) = s.weekday
            when 'monthly' then s.last_run_at is null
                             or date_trunc('month', s.last_run_at at time zone 'Africa/Douala')
                                < date_trunc('month', clock.local)
            else false
          end
  );
$$;

revoke all on function public.scheduled_payout_due_now() from public, anon, authenticated;
grant execute on function public.scheduled_payout_due_now() to service_role;


-- The five-minute payment gate (latest: 0070), with scheduled payouts added
-- as its last clause. Everything above that clause is 0070's, unchanged.
create or replace function public.cron_due_payments()
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    exists (
      select 1 from public.payment_attempts
      where status = 'pending' and created_at < now() - interval '2 minutes'
    )
    or exists (
      select 1 from public.payment_attempts
      where status = 'succeeded' and settled_at is null and created_at < now() - interval '2 minutes'
    )
    or exists (
      select 1 from public.refunds r
      where r.status = 'pending'
        and (r.order_id is not null or r.reservation_id is not null)
        and r.created_at < now() - interval '2 minutes'
        and coalesce(r.raw_response->>'adminAlerted', '') = ''
        and (
          r.reply_to is not null
          or coalesce(r.raw_response->>'payoutClaim', '') = ''
          or (
            (r.raw_response->>'payoutClaim')::timestamptz < now() - interval '15 minutes'
            and coalesce(r.raw_response->>'stuckAlerted', '') = ''
          )
        )
    )
    or exists (
      select 1 from public.withdrawal_requests
      where status = 'paid' and reply_to is not null and decided_at is null
        and requested_at < now() - interval '2 minutes'
    )
    or exists (
      select 1 from public.payment_attempts
      where status = 'failed' and provider = 'camerpay'
        and raw_response->>'customerDial' = 'true'
        and raw_response->>'lateCheck' is null
        and created_at < now() - interval '20 minutes'
        and created_at > now() - interval '3 hours'
    )
    -- 0075: a scheduled payout whose hour has come.
    or public.scheduled_payout_due_now();
$$;

revoke all on function public.cron_due_payments() from public, anon, authenticated;
grant execute on function public.cron_due_payments() to service_role;

notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
--  Verify
-- ═══════════════════════════════════════════════════════════════════════════

-- Expect one row: hour, integer, default 3.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'scheduled_payouts' and column_name = 'hour';

-- Expect two booleans (false/false on a quiet platform).
select public.scheduled_payout_due_now() as payout_due, public.cron_due_payments() as payments_due;
