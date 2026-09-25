-- 0060 — reservation sitting length, request reminders, restaurant cancellation
--
-- ─────────────────────────────────────────────────────────────────────────
--  WHY THIS EXISTS
--
--  1. A booking holds its table for a fixed time, and each restaurant sets
--     that time (/m/settings, default one hour). Availability is now a real
--     interval overlap using each booking's own `duration_min` — the old
--     asymmetric "starts within −30/+90 minutes" window both double-booked
--     long sittings and refused slots that were actually free. New bookings
--     snapshot the restaurant's duration into `reservations.duration_min`
--     (column since 0006), so changing the setting never rewrites bookings
--     already made. Code runs without this column (missing → 60 minutes).
--
--  2. Pending booking requests now expire (lib/reservations/timing.ts), and
--     the restaurant gets ONE reminder when half the time is gone.
--     `request_reminded_at` is that reminder's dedupe stamp. Without it the
--     reservation clock still expires requests, it just does not remind.
--
--  3. A restaurant may cancel a CONFIRMED booking (reason required, shown to
--     the customer). When the deposit was paid online the customer gets all
--     of it back: the booking lock, the restaurant wallet debit, the refund
--     row and the cancellation are ONE transaction below. The Mobile Money
--     payout that follows is the saga in lib/payments/refund-payouts.ts — a
--     network call cannot join a Postgres transaction. A deposit collected
--     in cash is not refunded here (no online money moved): the booking is
--     simply cancelled.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Sitting length per restaurant ─────────────────────────────────────
alter table public.restaurants
  add column if not exists reservation_duration_min integer not null default 60;

alter table public.restaurants
  drop constraint if exists restaurants_reservation_duration_min_check;
alter table public.restaurants
  add constraint restaurants_reservation_duration_min_check
    check (reservation_duration_min between 15 and 480);

-- ── 2. Restaurant reminder stamp for unanswered requests ─────────────────
alter table public.reservations
  add column if not exists request_reminded_at timestamptz;

-- The request-expiry sweep reads every pending request every 15 minutes.
create index if not exists reservations_pending_created_idx
  on public.reservations (created_at)
  where status in ('pending', 'awaiting_payment');

-- ── 3. Restaurant cancels a confirmed booking; customer fully refunded ───
--
--  Returns jsonb: { reservationId, reference, restaurantId, customerId,
--  tableId, refundId, refundAmount, refundStatus, alreadyCancelled,
--  cashDeposit }.
--
--  Raises:
--    reservation_not_found        — no such booking at this restaurant
--    reservation_not_cancellable  — not `confirmed` (seated, finished, …)
--    reason_required              — the customer is always told why
--    insufficient balance         — from wallet_debit: the restaurant has
--                                   already withdrawn the deposit; the app
--                                   sends them to support instead of
--                                   cancelling half-way.
create or replace function public.restaurant_cancel_reservation(
  p_reservation_id uuid,
  p_restaurant_id uuid,
  p_actor text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_booking public.reservations%rowtype;
  v_refund public.refunds%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_deposit integer := 0;
  v_online boolean := false;
  v_phone text;
  v_reference text;
begin
  select * into v_booking from public.reservations
  where id = p_reservation_id and restaurant_id = p_restaurant_id
  for update;
  if not found then raise exception 'reservation_not_found'; end if;

  -- Idempotent: a double-tap returns what the first call did.
  if v_booking.status = 'cancelled' then
    select * into v_refund from public.refunds
    where reservation_id = v_booking.id limit 1;
    return jsonb_build_object(
      'reservationId', v_booking.id, 'reference', v_booking.reference,
      'restaurantId', v_booking.restaurant_id, 'customerId', v_booking.customer_id,
      'tableId', null,
      'refundId', v_refund.id, 'refundAmount', coalesce(v_refund.amount, 0),
      'refundStatus', v_refund.status, 'alreadyCancelled', true, 'cashDeposit', false
    );
  end if;

  if v_booking.status <> 'confirmed' then
    raise exception 'reservation_not_cancellable';
  end if;
  if v_reason is null then raise exception 'reason_required'; end if;

  if v_booking.deposit_paid then
    v_deposit := greatest(coalesce(v_booking.deposit_amount, 0), 0);
    -- Online money is proven by a succeeded attempt, never assumed from the
    -- flag: `deposit_paid` is also set when a manager records cash.
    select phone into v_phone
    from public.payment_attempts
    where reservation_id = v_booking.id and status = 'succeeded'
    order by created_at desc
    limit 1;
    v_online := found;
  end if;

  if v_deposit > 0 and v_online then
    -- What settlePayment credited (the full deposit) goes back out.
    perform public.wallet_debit(
      v_booking.restaurant_id, v_deposit, 'adjustment',
      'Reservation ' || v_booking.reference || ' cancelled by the restaurant — customer refunded',
      v_booking.reference
    );

    v_reference := 'RF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    insert into public.refunds (
      reference, restaurant_id, reservation_id, type, amount, reason, status,
      created_by, phone, raw_response
    ) values (
      v_reference, v_booking.restaurant_id, v_booking.id, 'refund', v_deposit,
      'Reservation ' || v_booking.reference || ' cancelled by the restaurant: ' || v_reason,
      'pending', coalesce(nullif(trim(p_actor), ''), 'restaurant'),
      coalesce(nullif(trim(v_phone), ''), v_booking.guest_phone),
      jsonb_build_object('destination', 'mobile_money', 'cancelledBy', 'restaurant',
                         'deposit', v_deposit, 'walletDebit', v_deposit)
    ) returning * into v_refund;
  end if;

  update public.reservations set
    status = 'cancelled',
    table_id = null,
    decline_reason = v_reason,
    decided_by = coalesce(nullif(trim(p_actor), ''), decided_by),
    decided_at = now(),
    deposit_refund_amount = case when v_refund.id is not null then v_deposit else null end,
    deposit_refunded_at = null
  where id = v_booking.id;

  return jsonb_build_object(
    'reservationId', v_booking.id, 'reference', v_booking.reference,
    'restaurantId', v_booking.restaurant_id, 'customerId', v_booking.customer_id,
    'tableId', v_booking.table_id,
    'refundId', v_refund.id, 'refundAmount', coalesce(v_refund.amount, 0),
    'refundStatus', v_refund.status, 'alreadyCancelled', false,
    'cashDeposit', (v_deposit > 0 and not v_online)
  );
end
$$;

revoke all on function public.restaurant_cancel_reservation(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.restaurant_cancel_reservation(uuid, uuid, text, text) to service_role;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect two rows.
select table_name, column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'restaurants' and column_name = 'reservation_duration_min')
    or (table_name = 'reservations' and column_name = 'request_reminded_at'));

-- Expect one row.
select proname from pg_proc where proname = 'restaurant_cancel_reservation';
