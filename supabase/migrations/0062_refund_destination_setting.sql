-- 0062 — the admin decides where customer refunds go
--
-- ─────────────────────────────────────────────────────────────────────────
--  ONE SWITCH, EVERY REFUND.
--
--  `refunds_to_wallet` (admin settings, default false):
--    false → refunds are paid back to the customer's Mobile Money number
--            (CamerPay payout, lib/payments/refund-payouts.ts).
--    true  → refunds are credited to the customer's Resto237 wallet at once,
--            usable on their next order.
--
--  It governs every refund of money a customer paid by Mobile Money: a
--  cancelled paid order (0059), a late payment on an order no longer waiting
--  for it, a booking cancelled by the restaurant (0060) or by the customer
--  (below). Money paid FROM the wallet always goes back to the wallet.
--  Refunds too small for Mobile Money (< 500 FCFA) or with no usable number
--  go to the wallet whatever the switch says.
--
--  The app reads the switch when it SENDS a refund (refund-payouts.ts), so
--  the order and restaurant-cancel functions needed no change. The customer
--  cancel function below used to credit the wallet unconditionally (0051);
--  it now writes a pending Mobile Money refund when the switch is off.
--
--  Also fixed here: a deposit the restaurant recorded as paid IN CASH never
--  entered its wallet, yet cancelling the booking debited the wallet and
--  "refunded" it online. Only a deposit proven by a succeeded online payment
--  attempt is refunded by the platform now; a cash deposit is settled at the
--  counter, as it was paid.
-- ─────────────────────────────────────────────────────────────────────────

insert into public.settings (key, value, value_type, category, label, description)
values
  ('refunds_to_wallet', 'false', 'boolean', 'payments',
   'Keep refunds in the Resto237 wallet',
   'Off = customer refunds are sent back to their Mobile Money number. On = they are credited to the customer''s Resto237 wallet instantly. Money paid from the wallet always returns to the wallet.')
on conflict (key) do nothing;

create or replace function public.cancel_customer_reservation(
  p_reservation_id uuid,
  p_customer_id uuid,
  p_created_by text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_booking public.reservations%rowtype;
  v_refund public.refunds%rowtype;
  v_deposit integer := 0;
  v_online boolean := false;
  v_phone text;
  v_to_wallet boolean;
  v_refund_amount integer := 0;
  v_platform_fee integer := 0;
  v_restaurant_compensation integer := 0;
  v_wallet_debit integer := 0;
  v_reference text;
  v_customer_balance integer := 0;
begin
  select * into v_booking from public.reservations
  where id = p_reservation_id and customer_id = p_customer_id for update;
  if not found then raise exception 'reservation_not_found'; end if;

  select * into v_refund from public.refunds
  where reservation_id = p_reservation_id limit 1;

  if v_booking.status = 'cancelled' and v_refund.id is not null then
    return jsonb_build_object(
      'reservationId', v_booking.id, 'reference', v_booking.reference,
      'restaurantId', v_booking.restaurant_id, 'refundId', v_refund.id,
      'refundAmount', v_refund.amount,
      'restaurantCompensation', v_refund.restaurant_compensation,
      'platformFee', v_refund.platform_fee, 'refundStatus', v_refund.status,
      'phone', v_refund.phone, 'replyTo', v_refund.reply_to,
      'customerBalance', coalesce((select balance from public.customer_wallets where profile_id = p_customer_id), 0)
    );
  end if;

  if v_booking.status not in ('pending', 'awaiting_payment', 'confirmed') then
    raise exception 'reservation_not_cancellable';
  end if;
  if v_booking.reserved_for <= now() then raise exception 'reservation_started'; end if;

  if v_booking.deposit_paid then
    select phone into v_phone
    from public.payment_attempts
    where reservation_id = v_booking.id and status = 'succeeded'
    order by created_at desc
    limit 1;
    v_online := found;
    if v_online then
      v_deposit := greatest(coalesce(v_booking.deposit_amount, 0), 0);
    end if;
  end if;

  if v_deposit > 0 then
    if v_booking.reserved_for - now() < interval '1 hour' then
      v_refund_amount := round(v_deposit * 0.70);
      v_platform_fee := round(v_deposit * 0.05);
      v_restaurant_compensation := v_deposit - v_refund_amount - v_platform_fee;
    else
      v_refund_amount := v_deposit;
    end if;

    v_wallet_debit := v_refund_amount + v_platform_fee;
    perform public.wallet_debit(
      v_booking.restaurant_id, v_wallet_debit, 'adjustment',
      'Reservation ' || v_booking.reference || ' cancellation settlement',
      v_booking.reference
    );

    v_to_wallet := coalesce(
      (select value from public.settings where key = 'refunds_to_wallet'), 'false'
    ) = 'true';
    v_reference := 'RF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

    if v_to_wallet then
      v_customer_balance := public.credit_customer_wallet(
        p_customer_id, v_refund_amount, 'refund',
        'Reservation refund ' || v_booking.reference, v_booking.reference
      );
      insert into public.refunds (
        reference, restaurant_id, reservation_id, type, amount, reason, status,
        completed_at, created_by, restaurant_compensation, platform_fee, raw_response
      ) values (
        v_reference, v_booking.restaurant_id, v_booking.id, 'refund',
        v_refund_amount, 'Reservation cancellation ' || v_booking.reference,
        'completed', now(), p_created_by, v_restaurant_compensation, v_platform_fee,
        jsonb_build_object('deposit', v_deposit, 'walletDebit', v_wallet_debit,
                           'destination', 'customer_wallet', 'balanceAfter', v_customer_balance)
      ) returning * into v_refund;
    else
      insert into public.refunds (
        reference, restaurant_id, reservation_id, type, amount, reason, status,
        created_by, phone, restaurant_compensation, platform_fee, raw_response
      ) values (
        v_reference, v_booking.restaurant_id, v_booking.id, 'refund',
        v_refund_amount, 'Reservation cancellation ' || v_booking.reference,
        'pending', p_created_by, coalesce(nullif(trim(v_phone), ''), v_booking.guest_phone),
        v_restaurant_compensation, v_platform_fee,
        jsonb_build_object('deposit', v_deposit, 'walletDebit', v_wallet_debit,
                           'destination', 'mobile_money')
      ) returning * into v_refund;
    end if;

    if v_platform_fee > 0 then
      insert into public.platform_fees (source_type, source_id, restaurant_id, gross, fee)
      values ('reservation_late_cancellation', v_booking.id, v_booking.restaurant_id, v_deposit, v_platform_fee)
      on conflict (source_type, source_id) do nothing;
    end if;
  end if;

  update public.reservations set
    status = 'cancelled', table_id = null,
    deposit_refund_amount = case when v_deposit > 0 then v_refund_amount else null end,
    deposit_refunded_at = case when v_deposit > 0 and v_to_wallet then now() else null end
  where id = v_booking.id;

  return jsonb_build_object(
    'reservationId', v_booking.id, 'reference', v_booking.reference,
    'restaurantId', v_booking.restaurant_id, 'refundId', v_refund.id,
    'refundAmount', v_refund_amount,
    'restaurantCompensation', v_restaurant_compensation,
    'platformFee', v_platform_fee,
    'refundStatus', v_refund.status,
    'phone', v_refund.phone,
    'replyTo', null,
    'customerBalance', v_customer_balance
  );
end
$$;

revoke all on function public.cancel_customer_reservation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_customer_reservation(uuid, uuid, text) to service_role;

-- Verify: one row, value 'false' unless you changed it.
select key, value from public.settings where key = 'refunds_to_wallet';
