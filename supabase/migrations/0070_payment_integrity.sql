-- 0070 — one real payment, one claim; one order, one paying attempt.
--
-- Run in the Supabase SQL editor. Safe to run twice. The application works
-- before and after it: the code falls back to the older behaviour where this
-- has not been applied, and uses what is below as soon as it has.

-- ═════════════════════════════════════════════════════════════════════════
--  1. The claim index, re-stated
-- ═════════════════════════════════════════════════════════════════════════
--
--  A settled payment is claimed by writing its identity onto the attempt:
--  payment_attempts.provider_row_id. Since 2026-09-30 that identity is the
--  OPERATOR'S REFERENCE ("ref:CO260930.0949.B50907"), the one value a payment
--  carries in both of CamerPay's reports — so the transaction row and the
--  receipt for the same payment can never be claimed by two attempts.
--
--  The index below is what refuses the second claim. It was created in 0034,
--  and everything about double-settlement rests on it: a second attempt that
--  "succeeds" on the same payment is refunded as a late payment, which is
--  money paid out that was received once. Production has lagged migrations
--  before, so it is created again here, idempotently. It changes nothing on a
--  database that already has it.
--
--  If the CREATE fails with "could not create unique index … is duplicated",
--  two attempts already hold one payment — stop and look at them, do not drop
--  the index to get past it.

alter table public.payment_attempts
  add column if not exists provider_row_id text;

create unique index if not exists payment_attempts_provider_row_idx
  on public.payment_attempts (provider, provider_row_id)
  where provider_row_id is not null;

-- ═════════════════════════════════════════════════════════════════════════
--  2. The order remembers which attempt paid it
-- ═════════════════════════════════════════════════════════════════════════
--
--  A PAID ORDER WAS BEING REFUNDED WHILE IT STAYED PAID.
--
--  settlePayment() marks the order paid, then sends its notifications, and
--  only then stamps the attempt as finished. For those few seconds a second
--  caller on the same attempt (the webhook beside the browser poll, a re-tap,
--  the reconciler after a crash) found an order "no longer waiting for this
--  payment" — the description of a late payment — and refunded it. The
--  restaurant was credited, the order stayed paid, the customer got it all
--  back.
--
--  The cause was that nothing recorded WHO paid. Now the settlement writes the
--  attempt onto the order in the same transaction that marks it paid, and the
--  same attempt asking again is told "already settled" instead of being
--  refused. Any OTHER attempt still gets order_not_payable, and is refunded —
--  that one really is a second payment.
--
--  p_attempt_id is optional, so code deployed before this migration (which
--  passes the order alone) keeps working unchanged.

alter table public.orders
  add column if not exists paid_attempt_id uuid;

drop function if exists public.settle_online_order_payment(uuid);

create or replace function public.settle_online_order_payment(p_order_id uuid, p_attempt_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype; v_restaurant_amount integer; v_restaurant_balance integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  -- The attempt that paid this order, asking again: nothing to do, and
  -- nothing to refuse, whatever stage the order has moved on to since.
  if v_order.is_paid and p_attempt_id is not null and v_order.paid_attempt_id = p_attempt_id then
    select balance into v_restaurant_balance from public.restaurant_wallets where restaurant_id = v_order.restaurant_id;
    return jsonb_build_object('alreadySettled', true,
      'restaurantAmount', greatest(v_order.total - v_order.service_charge, 0),
      'restaurantBalance', coalesce(v_restaurant_balance, 0));
  end if;

  if v_order.status <> 'awaiting_customer' then raise exception 'order_not_payable'; end if;
  if v_order.is_paid then
    select balance into v_restaurant_balance from public.restaurant_wallets where restaurant_id = v_order.restaurant_id;
    return jsonb_build_object('alreadySettled', true,
      'restaurantAmount', greatest(v_order.total - v_order.service_charge, 0),
      'restaurantBalance', coalesce(v_restaurant_balance, 0));
  end if;
  v_restaurant_amount := greatest(v_order.total - v_order.service_charge, 0);
  perform public.wallet_credit(v_order.restaurant_id, v_restaurant_amount, 'payment',
    'Online order ' || v_order.reference, v_order.reference);
  if v_order.service_charge > 0 then
    insert into public.platform_revenue_ledger (source_type, source_id, restaurant_id, gross, amount, reference, note)
    values ('online_payment_fee', v_order.id, v_order.restaurant_id, v_order.total, v_order.service_charge,
      v_order.reference, 'Online payment service fee')
    on conflict (source_type, source_id) do nothing;
  end if;
  update public.orders set is_paid = true,
    paid_attempt_id = p_attempt_id,
    status = case when dining_session_id is null then 'confirmed' else 'delivered' end,
    delivered_at = case when dining_session_id is null then delivered_at else now() end
  where id = v_order.id;
  insert into public.order_status_history (order_id, status, note)
  values (v_order.id, case when v_order.dining_session_id is null then 'confirmed' else 'delivered' end,
    'Online payment confirmed');
  if v_order.dining_session_id is not null then
    update public.dining_sessions set status = 'closed', closed_at = now() where id = v_order.dining_session_id;
    update public.dining_guests set status = 'expired' where session_id = v_order.dining_session_id;
    perform public.dining_release_tables(v_order.dining_session_id);
  end if;
  select balance into v_restaurant_balance from public.restaurant_wallets where restaurant_id = v_order.restaurant_id;
  return jsonb_build_object('alreadySettled', false, 'restaurantAmount', v_restaurant_amount,
    'restaurantBalance', coalesce(v_restaurant_balance, 0));
end $$;

revoke all on function public.settle_online_order_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.settle_online_order_payment(uuid, uuid) to service_role;

-- ═════════════════════════════════════════════════════════════════════════
--  3. One late-payment refund per attempt
-- ═════════════════════════════════════════════════════════════════════════
--
--  A payment that lands on an order no longer waiting for it is refunded,
--  keyed on the attempt. The application now derives the refund's reference
--  from the attempt (refunds.reference is UNIQUE), which already refuses a
--  second row; this index states the rule where it belongs, so no future code
--  path can issue two refunds — two payouts — for one payment.

create unique index if not exists refunds_attempt_once_idx
  on public.refunds ((raw_response->>'attemptId'))
  where raw_response ? 'attemptId';

-- ═════════════════════════════════════════════════════════════════════════
--  4. The payments sweep also wakes for Orange codes dialled late
-- ═════════════════════════════════════════════════════════════════════════
--
--  Orange's payment code keeps working after our attempt has expired. A
--  customer who dials it then is debited, and nothing would ever notice. The
--  reconciler now asks CamerPay once more about each expired dial attempt
--  (recheckExpiredDialAttempt) — but since 0065 the sweep is only called when
--  this function says something is due, so the new work has to be counted
--  here or it never triggers a call. Same body as 0065 plus the last clause;
--  the window mirrors LATE_DIAL_AFTER_MS / LATE_DIAL_UNTIL_MS in reconcile.ts.

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
    );
$$;

notify pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════
--  Checks — expect one row from each.
-- ═════════════════════════════════════════════════════════════════════════
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'payment_attempts'
  and indexname = 'payment_attempts_provider_row_idx';

select indexname from pg_indexes
where schemaname = 'public' and tablename = 'refunds'
  and indexname = 'refunds_attempt_once_idx';

select pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'settle_online_order_payment';
