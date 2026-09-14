-- 0050 - reservation cancellation refunds and revenue split
--
-- A paid reservation cancelled at least one hour before service is refunded
-- in full. Inside the final hour, 70% is returned, 25% remains with the
-- restaurant, and 5% is retained by Resto237. The database claim, booking
-- cancellation, wallet debit and revenue/refund ledgers are one transaction.

alter table public.refunds
  add column if not exists reservation_id uuid references public.reservations(id) on delete set null,
  add column if not exists phone text,
  add column if not exists reply_to text,
  add column if not exists provider_row_id text,
  add column if not exists restaurant_compensation integer not null default 0 check (restaurant_compensation >= 0),
  add column if not exists platform_fee integer not null default 0 check (platform_fee >= 0),
  add column if not exists raw_response jsonb;

create unique index if not exists refunds_reservation_once_idx
  on public.refunds (reservation_id)
  where reservation_id is not null;

create unique index if not exists refunds_provider_row_once_idx
  on public.refunds (provider_row_id)
  where provider_row_id is not null;

create table if not exists public.platform_fees (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid not null,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  gross integer not null check (gross >= 0),
  fee integer not null check (fee > 0),
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

alter table public.platform_fees enable row level security;

create or replace function public.cancel_customer_reservation(
  p_reservation_id uuid,
  p_customer_id uuid,
  p_created_by text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.reservations%rowtype;
  v_refund public.refunds%rowtype;
  v_deposit integer;
  v_refund_amount integer := 0;
  v_platform_fee integer := 0;
  v_restaurant_compensation integer := 0;
  v_wallet_debit integer := 0;
  v_phone text;
  v_reference text;
begin
  select * into v_booking
  from public.reservations
  where id = p_reservation_id and customer_id = p_customer_id
  for update;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  select * into v_refund
  from public.refunds
  where reservation_id = p_reservation_id
  limit 1;

  if v_booking.status = 'cancelled' and v_refund.id is not null then
    return jsonb_build_object(
      'reservationId', v_booking.id,
      'reference', v_booking.reference,
      'restaurantId', v_booking.restaurant_id,
      'refundId', v_refund.id,
      'refundAmount', v_refund.amount,
      'restaurantCompensation', v_refund.restaurant_compensation,
      'platformFee', v_refund.platform_fee,
      'refundStatus', v_refund.status,
      'phone', v_refund.phone,
      'replyTo', v_refund.reply_to
    );
  end if;

  if v_booking.status not in ('pending', 'awaiting_payment', 'confirmed') then
    raise exception 'reservation_not_cancellable';
  end if;
  if v_booking.reserved_for <= now() then
    raise exception 'reservation_started';
  end if;

  v_deposit := case when v_booking.deposit_paid then greatest(coalesce(v_booking.deposit_amount, 0), 0) else 0 end;

  if v_deposit > 0 then
    if v_booking.reserved_for - now() < interval '1 hour' then
      v_refund_amount := round(v_deposit * 0.70);
      v_platform_fee := round(v_deposit * 0.05);
      v_restaurant_compensation := v_deposit - v_refund_amount - v_platform_fee;
    else
      v_refund_amount := v_deposit;
    end if;

    if v_refund_amount < 500 then
      raise exception 'refund_below_provider_minimum';
    end if;

    v_wallet_debit := v_refund_amount + v_platform_fee;
    perform public.wallet_debit(
      v_booking.restaurant_id,
      v_wallet_debit,
      'adjustment',
      'Reservation ' || v_booking.reference || ' cancellation settlement',
      v_booking.reference
    );

    v_reference := 'RF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    select coalesce(
      (
        select phone
        from public.payment_attempts
        where reservation_id = v_booking.id
          and status = 'succeeded'
        order by created_at desc
        limit 1
      ),
      v_booking.guest_phone
    ) into v_phone;

    insert into public.refunds (
      reference, restaurant_id, reservation_id, type, amount, reason, status,
      created_by, phone, restaurant_compensation, platform_fee, raw_response
    ) values (
      v_reference, v_booking.restaurant_id, v_booking.id, 'refund',
      v_refund_amount, 'Reservation cancellation ' || v_booking.reference,
      'pending', p_created_by, v_phone, v_restaurant_compensation, v_platform_fee,
      jsonb_build_object('deposit', v_deposit, 'walletDebit', v_wallet_debit)
    ) returning * into v_refund;

    if v_platform_fee > 0 then
      insert into public.platform_fees (source_type, source_id, restaurant_id, gross, fee)
      values ('reservation_late_cancellation', v_booking.id, v_booking.restaurant_id, v_deposit, v_platform_fee)
      on conflict (source_type, source_id) do nothing;
    end if;
  end if;

  update public.reservations
  set status = 'cancelled',
      table_id = null,
      deposit_refund_amount = case when v_deposit > 0 then v_refund_amount else null end,
      deposit_refunded_at = null
  where id = v_booking.id;

  return jsonb_build_object(
    'reservationId', v_booking.id,
    'reference', v_booking.reference,
    'restaurantId', v_booking.restaurant_id,
    'refundId', v_refund.id,
    'refundAmount', v_refund_amount,
    'restaurantCompensation', v_restaurant_compensation,
    'platformFee', v_platform_fee,
    'refundStatus', case when v_deposit > 0 then 'pending' else null end,
    'phone', v_phone,
    'replyTo', null
  );
end
$$;

create or replace function public.complete_reservation_refund(
  p_refund_id uuid,
  p_provider_row_id text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.refunds%rowtype;
begin
  select * into v_refund
  from public.refunds
  where id = p_refund_id
  for update;

  if not found then return false; end if;
  if v_refund.status = 'completed' then return true; end if;
  if v_refund.status <> 'pending' then return false; end if;

  update public.refunds
  set status = 'completed',
      completed_at = now(),
      provider_row_id = coalesce(p_provider_row_id, provider_row_id)
  where id = v_refund.id;

  update public.reservations
  set deposit_refunded_at = now(),
      deposit_refund_amount = v_refund.amount
  where id = v_refund.reservation_id
    and status = 'cancelled';

  return true;
end
$$;

revoke all on function public.cancel_customer_reservation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_reservation_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_customer_reservation(uuid, uuid, text) to service_role;
grant execute on function public.complete_reservation_refund(uuid, text) to service_role;
