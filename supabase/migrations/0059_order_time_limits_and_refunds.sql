-- 0059 — order time limits, refunds for cancelled paid orders, reconciler cadence
--
-- ─────────────────────────────────────────────────────────────────────────
--  WHY THIS EXISTS
--
--  1. Every waiting state now ends. A restaurant that never answers an order,
--     or a customer who never pays an accepted one, used to leave the order
--     open for ever (the watchdog rang five times and went quiet). The admin
--     now sets one time limit; the order-nag sweep cancels what outlives it
--     and tells both sides.
--
--  2. A paid order can be cancelled — by the restaurant, or by support — and
--     the customer gets the money back. Until now nobody could: the
--     restaurant was told "contact support", the customer "contact the
--     restaurant", and the admin refund only wrote a ledger line. The
--     cancellation, the restaurant clawback, the platform fee reversal and
--     the refund row are one transaction here; the Mobile Money payout that
--     follows is a tracked saga (lib/payments/refund-payouts.ts) because a
--     network call cannot join a Postgres transaction.
--
--  3. The reconciler goes back to every ten minutes. 0052 moved it to every
--     minute so an unconfirmed prompt expired on time; the resolver now asks
--     CamerPay before expiring anything, and the order sweep resolves an
--     order's open attempt before cancelling it, so the per-minute tick only
--     burned Vercel CPU (≈ 760 calls every 12 h).
--
--  THE DELIVERY FEE IS NOT IN `orders.total` ANY MORE.
--  From this release the delivery fee is quoted by the restaurant and paid in
--  cash to the rider; `total` is exactly what is paid online. The settlement
--  functions below (and 0053's) already work on `total`, so no function had
--  to change for that — it is noted here because refunds depend on it.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Admin-controlled time limits ──────────────────────────────────────
insert into public.settings (key, value, value_type, category, label, description)
values
  ('order_response_minutes', '15', 'integer', 'orders',
   'Order time limit (minutes)',
   'A restaurant must accept a new order, and a customer must pay an accepted order, within this many minutes. Past it the order is cancelled automatically and both sides are told. Restaurants hear a continuous ring while an order waits.'),
  ('reservation_response_minutes', '120', 'integer', 'orders',
   'Booking request time limit (minutes)',
   'A restaurant must accept or decline a table booking request within this many minutes (and never later than one hour before the slot). Unanswered requests expire and the customer is told.')
on conflict (key) do nothing;

-- ── 2. Refund rows for orders ────────────────────────────────────────────
-- refunds.order_id already exists (0005); these carry the payout saga.
alter table public.refunds
  add column if not exists phone text,
  add column if not exists reply_to text,
  add column if not exists provider_row_id text,
  add column if not exists raw_response jsonb;

create index if not exists refunds_pending_payout_idx
  on public.refunds (created_at)
  where status = 'pending';

-- ── 3. Cancel a paid order and owe the customer everything they paid ─────
--
--  Returns jsonb: { orderId, reference, restaurantId, customerId, refundId,
--  refundAmount, refundStatus ('pending'|'completed'), destination
--  ('mobile_money'|'customer_wallet'), phone, alreadyCancelled }.
--
--  The restaurant is debited what 0053 credited it (total − service charge);
--  the platform fee row is removed — a refunded sale earned no fee. Raises
--  'insufficient balance' (from wallet_debit) when the restaurant already
--  withdrew the money: the app then routes it to support instead of
--  cancelling half-way.
create or replace function public.cancel_paid_order(
  p_order_id uuid,
  p_actor text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_refund public.refunds%rowtype;
  v_restaurant_amount integer;
  v_phone text;
  v_reference text;
  v_destination text;
  v_status text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  -- Idempotent: a second call returns the refund the first one created.
  select * into v_refund from public.refunds
  where order_id = v_order.id and type = 'refund'
  order by created_at asc limit 1;

  if v_order.status = 'cancelled' then
    return jsonb_build_object(
      'orderId', v_order.id, 'reference', v_order.reference,
      'restaurantId', v_order.restaurant_id, 'customerId', v_order.customer_id,
      'refundId', v_refund.id, 'refundAmount', coalesce(v_refund.amount, 0),
      'refundStatus', v_refund.status, 'phone', v_refund.phone,
      'destination', coalesce(v_refund.raw_response->>'destination', 'mobile_money'),
      'alreadyCancelled', true
    );
  end if;
  if v_order.status = 'delivered' then raise exception 'order_not_cancellable'; end if;
  if not v_order.is_paid or v_order.payment_method not in ('mobile_money', 'wallet') then
    raise exception 'order_not_paid_online';
  end if;

  v_restaurant_amount := greatest(v_order.total - coalesce(v_order.service_charge, 0), 0);
  if v_restaurant_amount > 0 then
    perform public.wallet_debit(
      v_order.restaurant_id, v_restaurant_amount, 'adjustment',
      'Order ' || v_order.reference || ' cancelled — customer refunded',
      v_order.reference
    );
  end if;

  delete from public.platform_revenue_ledger
  where source_type = 'online_payment_fee' and source_id = v_order.id;

  v_reference := 'RF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

  if v_order.payment_method = 'wallet' and v_order.customer_id is not null then
    perform public.credit_customer_wallet(
      v_order.customer_id, v_order.total, 'refund',
      'Order refund ' || v_order.reference, v_order.reference
    );
    v_destination := 'customer_wallet';
    v_status := 'completed';
  else
    select phone into v_phone
    from public.payment_attempts
    where raw_response->>'orderId' = v_order.id::text
      and status = 'succeeded'
    order by created_at desc
    limit 1;
    v_phone := coalesce(v_phone, v_order.delivery_phone);
    v_destination := 'mobile_money';
    v_status := 'pending';
  end if;

  if v_order.total > 0 then
    insert into public.refunds (
      reference, restaurant_id, order_id, type, amount, reason, status,
      completed_at, created_by, phone, raw_response
    ) values (
      v_reference, v_order.restaurant_id, v_order.id, 'refund', v_order.total,
      coalesce(nullif(trim(p_reason), ''), 'Order cancelled'), v_status,
      case when v_status = 'completed' then now() else null end,
      coalesce(p_actor, 'system'), v_phone,
      jsonb_build_object('destination', v_destination, 'restaurantDebit', v_restaurant_amount)
    ) returning * into v_refund;
  end if;

  update public.orders
  set status = 'cancelled',
      cancelled_reason = coalesce(nullif(trim(p_reason), ''), 'Order cancelled'),
      cancelled_at = now()
  where id = v_order.id;

  insert into public.order_status_history (order_id, status, by_name, note)
  values (v_order.id, 'cancelled', coalesce(p_actor, 'system'), p_reason);

  return jsonb_build_object(
    'orderId', v_order.id, 'reference', v_order.reference,
    'restaurantId', v_order.restaurant_id, 'customerId', v_order.customer_id,
    'refundId', v_refund.id, 'refundAmount', coalesce(v_refund.amount, 0),
    'refundStatus', v_refund.status, 'phone', v_phone,
    'destination', v_destination, 'alreadyCancelled', false
  );
end
$$;

revoke all on function public.cancel_paid_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cancel_paid_order(uuid, text, text) to service_role;

-- ── 4. Reconciler back to every ten minutes ──────────────────────────────
do $$
declare
  v_base text;
  v_secret text;
begin
  select nullif(trim(value), '') into v_base from public.settings where key = 'cron_base_url';
  select nullif(trim(value), '') into v_secret from public.settings where key = 'cron_secret';

  if v_base is null or v_secret is null then
    raise notice '0059: cron_base_url / cron_secret not set — reconciler schedule unchanged.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'resto237-reconcile') then
    perform cron.unschedule('resto237-reconcile');
  end if;

  execute format(
    'select cron.schedule(%L, %L, %L)',
    'resto237-reconcile',
    '*/10 * * * *',
    format(
      'select net.http_get(url := %L, headers := %L::jsonb, timeout_milliseconds := 30000)',
      rtrim(v_base, '/') || '/api/cron/reconcile',
      json_build_object('Authorization', 'Bearer ' || v_secret)::text
    )
  );
end
$$;

-- ── Verify (run by hand; never select the `command` column — it holds the
--    bearer secret) ─────────────────────────────────────────────────────────
--
--   select jobid, jobname, schedule, active
--   from cron.job
--   where jobname like 'resto237-%' or command like '%/api/cron/reconcile%'
--   order by jobname, jobid;
--
-- Expect exactly ONE row reaching /api/cron/reconcile, named
-- resto237-reconcile, schedule */10 * * * *. If another job also calls the
-- reconciler (an old one-minute job under a different name), remove it once
-- you have confirmed which it is:
--
--   select cron.unschedule(<jobid>);
