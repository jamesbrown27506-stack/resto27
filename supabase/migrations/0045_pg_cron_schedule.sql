-- 0045 — Schedule the five background sweeps with pg_cron, not Vercel Cron.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WHY THE DATABASE DRIVES THE CLOCK HERE.
--
--  Vercel's Hobby plan allows two cron jobs, once per day each. This platform
--  needs five, four of them every 5–15 minutes: an order nobody accepted has
--  to ring again within minutes, not tomorrow. So the schedule lives in
--  Postgres — pg_cron holds the timetable, pg_net makes the HTTP call, and the
--  routes themselves are unchanged. Moving to Vercel Cron later means adding
--  vercel.json back and running §3 below to unschedule these.
--
--  This supersedes the three-job block in 0034 §9. It reuses the same job
--  NAMES, so it replaces rather than duplicates them — and if 0034 is ever
--  re-run it will quietly drop back to its three jobs, so run this again
--  afterwards.
--
--  SAFE TO COMMIT: the URL and the bearer secret live in `settings` rows, not
--  in this file. Fill those in first (§1) or nothing is scheduled.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. The two settings rows this reads ────────────────────────────────────
-- Seeded empty by 0034 §9 and left alone here — `do nothing` so re-running
-- never clears a URL or a secret. Their descriptions predate this migration
-- and told the admin to ignore them on Vercel, which is now wrong.
insert into public.settings (key, value, value_type, category, label, description)
values
  ('cron_base_url', '', 'string', 'operations', 'Cron base URL', ''),
  ('cron_secret', '', 'string', 'operations', 'Cron bearer secret', '')
on conflict (key) do nothing;

update public.settings
set description = 'The public base URL of the app (https://…, no trailing slash) that pg_cron calls for the background sweeps. Empty = nothing is scheduled. Change it and re-run migration 0045.'
where key = 'cron_base_url';

update public.settings
set description = 'Must match the CRON_SECRET environment variable the /api/cron/* routes check. Empty = nothing is scheduled. Change it and re-run migration 0045.'
where key = 'cron_secret';


-- ── 2. Extensions ──────────────────────────────────────────────────────────
-- Both or nothing: pg_cron can run SQL on a schedule but cannot reach an HTTP
-- endpoint, which is the entire point. If this cannot create them, enable them
-- by hand in Supabase → Database → Extensions and run this file again.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      execute 'create extension if not exists pg_cron';
      raise notice '0045: pg_cron enabled.';
    exception when others then
      raise notice '0045: could not enable pg_cron (%) — enable it in Supabase → Database → Extensions, then re-run.', sqlerrm;
    end;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      execute 'create extension if not exists pg_net';
      raise notice '0045: pg_net enabled.';
    exception when others then
      raise notice '0045: could not enable pg_net (%) — enable it in Supabase → Database → Extensions, then re-run.', sqlerrm;
    end;
  end if;
end $$;


-- ── 3. The timetable ───────────────────────────────────────────────────────
do $$
declare
  v_base   text;
  v_secret text;
  v_job    record;
  v_count  integer := 0;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice '0045: pg_cron and/or pg_net missing — nothing scheduled.';
    return;
  end if;

  select nullif(trim(value), '') into v_base   from public.settings where key = 'cron_base_url';
  select nullif(trim(value), '') into v_secret from public.settings where key = 'cron_secret';

  if v_base is null or v_secret is null then
    raise notice '0045: cron_base_url / cron_secret not set — nothing scheduled. Fill them in and re-run.';
    return;
  end if;

  v_base := rtrim(v_base, '/');

  /*
    Schedules are UTC — pg_cron reads the server clock and Supabase runs UTC.
    Douala is UTC+1 with no DST, so the daily sweep at 02:15 UTC lands at
    03:15 local, after the local day boundary, which is what a day-boundary
    job wants.

    Frequencies are chosen against what each sweep is waiting for, not for
    symmetry: an unaccepted order is the most time-critical thing here, a
    stuck payment matters within minutes, a 30-minute delivery threshold does
    not need finer than 10, and reservation reminders are hours-scale.
  */
  for v_job in
    select * from (values
      ('resto237-order-nag',         '*/5 * * * *',  '/api/cron/order-nag'),
      ('resto237-reconcile',         '*/10 * * * *', '/api/cron/reconcile'),
      ('resto237-delivery-monitor',  '*/10 * * * *', '/api/cron/delivery-monitor'),
      ('resto237-reservation-clock', '*/15 * * * *', '/api/cron/reservation-clock'),
      ('resto237-expire',            '15 2 * * *',   '/api/cron/expire')
    ) as j(name, schedule, path)
  loop
    -- cron.unschedule() raises on an unknown job, so it is guarded rather than
    -- wrapped in a handler that would also swallow real errors. This is what
    -- makes a second run leave five jobs, not ten.
    if exists (select 1 from cron.job where jobname = v_job.name) then
      perform cron.unschedule(v_job.name);
    end if;

    -- The command is a string pg_cron runs later, so the URL and the header
    -- are quoted through format(%L) rather than concatenated: a base URL with
    -- a quote in it must not be able to rewrite the job.
    execute format(
      'select cron.schedule(%L, %L, %L)',
      v_job.name,
      v_job.schedule,
      format(
        'select net.http_get(url := %L, headers := %L::jsonb, timeout_milliseconds := 30000)',
        v_base || v_job.path,
        json_build_object('Authorization', 'Bearer ' || v_secret)::text
      )
    );
    v_count := v_count + 1;
  end loop;

  raise notice '0045: % jobs scheduled against %', v_count, v_base;
end $$;


-- ── Verify ─────────────────────────────────────────────────────────────────
-- 1. Five rows, all active. The command column shows the URL but NOT the
--    secret in plain sight — read it before pasting a screenshot anywhere.
select jobname, schedule, active
from cron.job
where jobname like 'resto237-%'
order by jobname;

-- 2. After ~10 minutes, the last few runs and whether they succeeded. pg_net
--    is fire-and-forget, so 'succeeded' here means the REQUEST was sent, not
--    that the route did its work — /a/health and ops_heartbeats answer that.
select j.jobname, r.status, r.return_message, r.start_time
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
where j.jobname like 'resto237-%'
order by r.start_time desc
limit 20;

-- 3. Which sweeps have actually reported in (0044's heartbeat table). This is
--    the honest answer: a row here means the route ran and finished.
select key, ran_at, detail from public.ops_heartbeats order by ran_at desc;

-- 4. To stop all of this (e.g. if you later move to Vercel Cron on Pro):
--    select cron.unschedule(jobname) from cron.job where jobname like 'resto237-%';
