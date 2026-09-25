-- 0065 — wake Vercel only when there is work; stage reminders and auto-close
--
-- ─────────────────────────────────────────────────────────────────────────
--  1. TASK-ONLY SCHEDULING (Vercel CPU).
--
--  Until now pg_cron called Vercel on a fixed clock — ~670 calls a day —
--  whether or not anything was due, and every call burned function CPU just
--  to find nothing to do. Now each job asks the DATABASE first, with a cheap
--  `exists (…)` query that costs Vercel nothing:
--
--      select net.http_get(…) where public.cron_due_orders();
--
--  No row, no HTTP call. A quiet night makes zero Vercel invocations; a busy
--  lunch makes one per tick that has real work. The checks mirror the
--  routes' own queries; when in doubt they say "due" (a spare call is cheap,
--  a missed cancellation is not).
--
--      resto237-order-nag           every 5 min   cron_due_orders()
--      resto237-reconcile           every 5 min   cron_due_payments()
--      resto237-delivery-monitor    every 10 min  cron_due_deliveries()
--      resto237-reservation-clock   every 10 min  cron_due_reservations()
--      resto237-expire              daily         (unchanged, ungated)
--
--  2. FORGOTTEN STEPS.
--
--  Staff forget buttons. The app never moves an order FORWARD by itself
--  (that would tell a customer "on its way" while it is still cooking) — it
--  REMINDS: paid but not started after 10 min; preparing for longer than
--  the restaurant's usual time (once at 1×, again at 2× with the admins).
--  `stage_nudge_status` / `stage_nudge_count` remember which reminder went
--  out for which step, so each is sent once.
--
--  It does FINISH orders whose last step was simply never pressed — closing
--  only records what already happened:
--      on its way / ready for pickup for 3 h      → delivered / collected
--      served at a table, bill paid, for 3 h      → table finished and freed
--      served at a table, bill NOT recorded, 12 h → finished and freed,
--                                                    marked "paiement non
--                                                    enregistré" for reports
--  auto_close_served_order() does that in one transaction, including the
--  table-service session and the table itself.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.orders
  add column if not exists stage_nudge_status text,
  add column if not exists stage_nudge_count smallint not null default 0;

create index if not exists orders_open_status_idx
  on public.orders (status, created_at)
  where status in ('pending', 'awaiting_customer', 'confirmed', 'preparing', 'shipped');

-- ── Auto-close one served / shipped order ────────────────────────────────
create or replace function public.auto_close_served_order(p_order_id uuid, p_note text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_table_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'shipped' then return false; end if;

  -- Money possibly moving right now: leave it for the payment to finish.
  if exists (
    select 1 from public.payment_attempts
    where raw_response->>'orderId' = v_order.id::text
      and status in ('pending', 'succeeded') and settled_at is null
  ) then
    return false;
  end if;

  update public.orders
  set status = 'delivered', delivered_at = coalesce(delivered_at, now())
  where id = v_order.id;

  insert into public.order_status_history (order_id, status, by_name, note)
  values (v_order.id, 'delivered', 'Resto237', p_note);

  if v_order.dining_session_id is not null then
    update public.dining_sessions set status = 'closed', closed_at = now()
    where id = v_order.dining_session_id and status in ('awaiting_staff', 'open', 'payment_requested')
    returning table_id into v_table_id;
    update public.dining_guests set status = 'expired' where session_id = v_order.dining_session_id;
    if v_table_id is not null then
      update public.restaurant_tables set status = 'available' where id = v_table_id and status = 'occupied';
    end if;
  elsif v_order.type = 'dine_in' and v_order.table_number is not null then
    -- A waiter-entered table: free it unless another party is still on it.
    if not exists (
      select 1 from public.orders o
      where o.restaurant_id = v_order.restaurant_id and o.type = 'dine_in'
        and o.table_number = v_order.table_number and o.id <> v_order.id
        and o.status not in ('cancelled', 'delivered')
    ) then
      update public.restaurant_tables set status = 'available'
      where restaurant_id = v_order.restaurant_id and number = v_order.table_number and status = 'occupied';
    end if;
  end if;

  return true;
end
$$;

revoke all on function public.auto_close_served_order(uuid, text) from public, anon, authenticated;
grant execute on function public.auto_close_served_order(uuid, text) to service_role;

-- ── "Is there anything to do?" — one per job ─────────────────────────────

create or replace function public.cron_due_orders()
returns boolean
language sql stable security definer set search_path = public
as $$
  with lim as (
    select coalesce(nullif(trim((select value from public.settings where key = 'order_response_minutes')), '')::int, 15) as m
  )
  select
    -- 1. an unaccepted order whose next reminder is due
    exists (
      select 1 from public.orders o
      where o.status = 'pending'
        and o.created_at < now() - interval '5 minutes'
        and o.pending_alert_count < 5
        and (o.scheduled_for is null or o.scheduled_for < now() + interval '45 minutes')
        and (o.pending_alert_at is null or o.pending_alert_at < now() - interval '5 minutes')
    )
    -- 2. an unaccepted order past the time limit
    or exists (
      select 1 from public.orders o, lim
      where o.status = 'pending' and not o.is_paid
        and greatest(o.created_at, coalesce(o.scheduled_for - interval '60 minutes', o.created_at))
            < now() - make_interval(mins => lim.m)
    )
    -- 3. an accepted order not paid: half-time reminder, or past the limit
    or exists (
      select 1
      from public.orders o
      join public.order_status_history h on h.order_id = o.id and h.status = 'awaiting_customer',
      lim
      where o.status = 'awaiting_customer' and not o.is_paid
        and (
          h.created_at < now() - make_interval(mins => lim.m)
          or (o.fee_reminder_at is null and o.customer_id is not null
              and h.created_at < now() - make_interval(mins => greatest(lim.m / 2, 1)))
        )
    )
    -- 4. a delivered order to invite a review for
    or exists (
      select 1 from public.orders o
      where o.status = 'delivered' and o.customer_id is not null and o.review_prompt_at is null
        and o.delivered_at between now() - interval '26 hours' and now() - interval '2 hours'
    )
    -- 5. a scheduled order whose prep window opened
    or exists (
      select 1 from public.orders o
      where o.status in ('pending', 'confirmed') and o.due_alert_at is null
        and o.scheduled_for between now() - interval '1 hour' and now() + interval '45 minutes'
    )
    -- 6. a paid order not started for 10 minutes (reminder not sent yet)
    or exists (
      select 1
      from public.orders o
      join public.order_status_history h on h.order_id = o.id and h.status = 'confirmed'
      where o.status = 'confirmed'
        and o.created_at > now() - interval '2 days'
        and h.created_at < now() - interval '10 minutes'
        and coalesce(o.stage_nudge_status, '') <> 'confirmed'
    )
    -- 7. an order preparing longer than the restaurant's usual time (1×, 2×)
    or exists (
      select 1
      from public.orders o
      join public.restaurants r on r.id = o.restaurant_id
      join public.order_status_history h on h.order_id = o.id and h.status = 'preparing'
      where o.status = 'preparing'
        and o.created_at > now() - interval '2 days'
        and (case when o.stage_nudge_status = 'preparing' then o.stage_nudge_count else 0 end) < 2
        and h.created_at < now() - make_interval(mins =>
              least(greatest(coalesce(r.delivery_estimate_min, 30), 15), 120)
              * ((case when o.stage_nudge_status = 'preparing' then o.stage_nudge_count else 0 end) + 1))
    )
    -- 8. a last step never pressed: on its way / ready / served
    or exists (
      select 1 from public.orders o
      where o.status = 'shipped'
        and coalesce(o.shipped_at, o.created_at) < now() - case
              when o.type = 'dine_in' and not o.is_paid then interval '12 hours'
              else interval '3 hours'
            end
    );
$$;

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
    );
$$;

create or replace function public.cron_due_deliveries()
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    exists (
      select 1 from public.orders
      where type = 'delivery' and status = 'shipped'
        and shipped_at < now() - interval '30 minutes'
        and delivered_at is null and delivery_alert_sent_at is null
    )
    or exists (
      select 1 from public.push_subscriptions
      where expiration_time is not null and expiration_time < now()
    );
$$;

create or replace function public.cron_due_reservations()
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    -- requests to answer / expire, deposits to chase / release
    exists (select 1 from public.reservations where status in ('pending', 'awaiting_payment'))
    -- reminders: day-before and two-hours-before
    or exists (
      select 1 from public.reservations
      where status = 'confirmed' and customer_id is not null
        and (
          (reminder_stage < 2 and reserved_for between now() + interval '30 minutes' and now() + interval '150 minutes')
          or (reminder_stage = 0 and reserved_for between now() + interval '22 hours' and now() + interval '26 hours')
        )
    );
$$;

revoke all on function public.cron_due_orders() from public, anon, authenticated;
revoke all on function public.cron_due_payments() from public, anon, authenticated;
revoke all on function public.cron_due_deliveries() from public, anon, authenticated;
revoke all on function public.cron_due_reservations() from public, anon, authenticated;
-- /a/health asks the same question: a quiet reconciler is only "stale" when
-- work has been waiting for it (see the health route).
grant execute on function public.cron_due_orders() to service_role;
grant execute on function public.cron_due_payments() to service_role;
grant execute on function public.cron_due_deliveries() to service_role;
grant execute on function public.cron_due_reservations() to service_role;

-- ── Reschedule, gated ────────────────────────────────────────────────────
do $$
declare
  v_base text;
  v_secret text;
  v_job record;
begin
  select nullif(trim(value), '') into v_base from public.settings where key = 'cron_base_url';
  select nullif(trim(value), '') into v_secret from public.settings where key = 'cron_secret';
  if v_base is null or v_secret is null then
    raise notice '0065: cron_base_url / cron_secret not set — schedules unchanged.';
    return;
  end if;
  v_base := rtrim(v_base, '/');

  for v_job in
    select * from (values
      ('resto237-order-nag',         '*/5 * * * *',  '/api/cron/order-nag',         'cron_due_orders'),
      ('resto237-reconcile',         '*/5 * * * *',  '/api/cron/reconcile',         'cron_due_payments'),
      ('resto237-delivery-monitor',  '*/10 * * * *', '/api/cron/delivery-monitor',  'cron_due_deliveries'),
      ('resto237-reservation-clock', '*/10 * * * *', '/api/cron/reservation-clock', 'cron_due_reservations')
    ) as j(name, schedule, path, gate)
  loop
    if exists (select 1 from cron.job where jobname = v_job.name) then
      perform cron.unschedule(v_job.name);
    end if;
    -- The HTTP call only happens when the gate returns true: `where false`
    -- selects no row, and net.http_get is never evaluated.
    execute format(
      'select cron.schedule(%L, %L, %L)',
      v_job.name,
      v_job.schedule,
      format(
        'select net.http_get(url := %L, headers := %L::jsonb, timeout_milliseconds := 30000) where public.%I()',
        v_base || v_job.path,
        json_build_object('Authorization', 'Bearer ' || v_secret)::text,
        v_job.gate
      )
    );
  end loop;
end
$$;

-- ── Verify (never select `command` — it contains the bearer secret) ──────
--   select jobname, schedule, active from cron.job where jobname like 'resto237-%' order by 1;
--   select public.cron_due_orders(), public.cron_due_payments(),
--          public.cron_due_deliveries(), public.cron_due_reservations();
-- Afterwards, cron.job_run_details shows every tick; Vercel's logs show only
-- the ticks that had work.
