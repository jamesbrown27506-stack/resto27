-- 0051 - customer wallets, wallet checkout, and wallet refunds
--
-- Customer money stays auditable in a dedicated wallet. The payment RPC locks
-- both wallets and the order, so debit, restaurant credit, ledgers and paid
-- status either all commit or all roll back.

create table if not exists public.customer_wallets (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  kind text not null check (kind in ('refund', 'payment', 'adjustment')),
  note text,
  reference text,
  balance_after integer not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

create index if not exists customer_wallet_ledger_profile_idx
  on public.customer_wallet_ledger (profile_id, created_at desc);

alter table public.customer_wallets enable row level security;
alter table public.customer_wallet_ledger enable row level security;

drop policy if exists customer_wallet_own_read on public.customer_wallets;
create policy customer_wallet_own_read on public.customer_wallets
  for select using (profile_id = auth.uid());

drop policy if exists customer_wallet_ledger_own_read on public.customer_wallet_ledger;
create policy customer_wallet_ledger_own_read on public.customer_wallet_ledger
  for select using (profile_id = auth.uid());

alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
  check (payment_method in ('cash_on_delivery','pay_at_restaurant','mobile_money','wallet'));

create or replace function public.customer_wallet_pay_order(
  p_profile_id uuid,
  p_order_id uuid
) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_balance integer;
  v_restaurant_balance integer;
begin
  select * into v_order from public.orders
  where id = p_order_id and customer_id = p_profile_id
  for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.payment_method <> 'wallet' then raise exception 'wrong_payment_method'; end if;
  if v_order.is_paid then
    select balance into v_balance from public.customer_wallets where profile_id = p_profile_id;
    return coalesce(v_balance, 0);
  end if;

  insert into public.customer_wallets (profile_id, balance)
  values (p_profile_id, 0) on conflict (profile_id) do nothing;
  select balance into v_balance from public.customer_wallets
  where profile_id = p_profile_id for update;
  if v_balance < v_order.total then raise exception 'insufficient_customer_wallet'; end if;

  update public.customer_wallets
  set balance = balance - v_order.total, updated_at = now()
  where profile_id = p_profile_id returning balance into v_balance;

  insert into public.customer_wallet_ledger
    (profile_id, amount, kind, note, reference, balance_after)
  values
    (p_profile_id, -v_order.total, 'payment', 'Order payment', v_order.reference, v_balance);

  perform public.wallet_credit(
    v_order.restaurant_id,
    v_order.total,
    'order',
    'Wallet payment for order ' || v_order.reference,
    v_order.reference
  );
  select balance into v_restaurant_balance from public.restaurant_wallets
  where restaurant_id = v_order.restaurant_id;

  update public.orders set is_paid = true where id = v_order.id;
  return v_balance;
end
$$;

create or replace function public.credit_customer_wallet(
  p_profile_id uuid,
  p_amount integer,
  p_kind text,
  p_note text,
  p_reference text
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_balance integer;
begin
  if p_amount <= 0 then raise exception 'amount_must_be_positive'; end if;
  insert into public.customer_wallets (profile_id, balance)
  values (p_profile_id, p_amount)
  on conflict (profile_id) do update
    set balance = public.customer_wallets.balance + excluded.balance,
        updated_at = now()
  returning balance into v_balance;
  insert into public.customer_wallet_ledger
    (profile_id, amount, kind, note, reference, balance_after)
  values
    (p_profile_id, p_amount, p_kind, p_note, p_reference, v_balance);
  return v_balance;
end
$$;

-- Replace the Mobile Money refund claim with an immediate customer-wallet
-- credit. The restaurant settlement, platform share and customer credit are
-- one PostgreSQL transaction.
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
  v_deposit integer;
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
      'customerBalance', coalesce((select balance from public.customer_wallets where profile_id=p_customer_id), 0)
    );
  end if;

  if v_booking.status not in ('pending', 'awaiting_payment', 'confirmed') then
    raise exception 'reservation_not_cancellable';
  end if;
  if v_booking.reserved_for <= now() then raise exception 'reservation_started'; end if;

  v_deposit := case when v_booking.deposit_paid then greatest(coalesce(v_booking.deposit_amount, 0), 0) else 0 end;
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

    v_reference := 'RF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
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

    if v_platform_fee > 0 then
      insert into public.platform_fees (source_type, source_id, restaurant_id, gross, fee)
      values ('reservation_late_cancellation', v_booking.id, v_booking.restaurant_id, v_deposit, v_platform_fee)
      on conflict (source_type, source_id) do nothing;
    end if;
  end if;

  update public.reservations set
    status='cancelled', table_id=null,
    deposit_refund_amount=case when v_deposit > 0 then v_refund_amount else null end,
    deposit_refunded_at=case when v_deposit > 0 then now() else null end
  where id=v_booking.id;

  return jsonb_build_object(
    'reservationId', v_booking.id, 'reference', v_booking.reference,
    'restaurantId', v_booking.restaurant_id, 'refundId', v_refund.id,
    'refundAmount', v_refund_amount,
    'restaurantCompensation', v_restaurant_compensation,
    'platformFee', v_platform_fee,
    'refundStatus', case when v_deposit > 0 then 'completed' else null end,
    'customerBalance', v_customer_balance
  );
end
$$;

revoke all on function public.customer_wallet_pay_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.credit_customer_wallet(uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.cancel_customer_reservation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.customer_wallet_pay_order(uuid, uuid) to service_role;
grant execute on function public.credit_customer_wallet(uuid, integer, text, text, text) to service_role;
grant execute on function public.cancel_customer_reservation(uuid, uuid, text) to service_role;


update public.settings set
  label = case when key = 'withdrawal_fee_enabled' then 'Tax' else 'Tax %' end,
  description = case
    when key = 'withdrawal_fee_enabled' then 'Off = payouts are free. On = the configured tax is withheld from each payout.'
    else 'Applied to the gross payout amount and rounded to whole francs.'
  end
where key in ('withdrawal_fee_enabled', 'withdrawal_fee_percent');
