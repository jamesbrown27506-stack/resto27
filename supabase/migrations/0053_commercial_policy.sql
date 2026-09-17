-- 0053 — approved commercial policy: online payment fee, settlement split and plan entitlements
--
-- Customer online payments carry a platform payment service fee. The restaurant
-- receives the sale amount less that fee; the platform revenue ledger records
-- the fee in the same transaction. Cash/pay-at-restaurant orders have a zero fee.

alter table public.subscription_plans
  add column if not exists included_branches integer not null default 1 check (included_branches >= 1),
  add column if not exists staff_limit integer not null default 0 check (staff_limit >= 0),
  add column if not exists scheduled_payouts boolean not null default false,
  add column if not exists priority_support boolean not null default false;

update public.subscription_plans
set
  commission_rate = case tier when 'starter' then 5.00 when 'professional' then 3.00 when 'enterprise' then 0.00 else commission_rate end,
  included_branches = case tier when 'enterprise' then 3 else 1 end,
  staff_management = case when tier = 'starter' then false else true end,
  staff_limit = case tier when 'starter' then 0 when 'professional' then 10 else 100 end,
  scheduled_payouts = tier = 'enterprise',
  priority_support = tier = 'enterprise';

-- A percentage may be decimal, unlike XAF amounts. Extend the setting type
-- catalogue, then restore the validator in case a prior failed run disabled it.
alter table public.settings
  drop constraint if exists settings_value_type_check;

alter table public.settings
  add constraint settings_value_type_check
  check (value_type in ('string', 'integer', 'decimal', 'boolean', 'json'));

alter table public.settings enable trigger validate_setting_value;

update public.settings
set
  value_type = 'decimal',
  value = '1.5',
  label = 'Payment service fee %',
  description = 'Applied only when the customer pays online. The fee belongs to the platform and is shown before payment.'
where key = 'service_charge_percent';

-- Keep future edits to this setting numeric and within a percentage range.
alter table public.settings
  add constraint settings_service_charge_percent_decimal_check
  check (
    key <> 'service_charge_percent'
    or value is null
    or value = ''
    or (value::numeric >= 0 and value::numeric <= 100)
  );
create table if not exists public.platform_revenue_ledger (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('online_payment_fee', 'reservation_late_cancellation', 'withdrawal_fee')),
  source_id uuid not null,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  gross integer not null check (gross >= 0),
  amount integer not null check (amount >= 0),
  reference text,
  note text,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index if not exists platform_revenue_ledger_created_idx
  on public.platform_revenue_ledger (created_at desc);

alter table public.platform_revenue_ledger enable row level security;

create or replace function public.settle_online_order_payment(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_restaurant_amount integer;
  v_restaurant_balance integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.status <> 'awaiting_customer' then raise exception 'order_not_payable'; end if;

  if v_order.is_paid then
    select balance into v_restaurant_balance from public.restaurant_wallets where restaurant_id = v_order.restaurant_id;
    return jsonb_build_object('alreadySettled', true, 'restaurantAmount', greatest(v_order.total - v_order.service_charge, 0), 'restaurantBalance', coalesce(v_restaurant_balance, 0));
  end if;

  v_restaurant_amount := greatest(v_order.total - v_order.service_charge, 0);
  perform public.wallet_credit(
    v_order.restaurant_id,
    v_restaurant_amount,
    'payment',
    'Online order ' || v_order.reference,
    v_order.reference
  );

  if v_order.service_charge > 0 then
    insert into public.platform_revenue_ledger (source_type, source_id, restaurant_id, gross, amount, reference, note)
    values ('online_payment_fee', v_order.id, v_order.restaurant_id, v_order.total, v_order.service_charge, v_order.reference, 'Online payment service fee')
    on conflict (source_type, source_id) do nothing;
  end if;

  update public.orders set is_paid = true, status = 'confirmed' where id = v_order.id;
  insert into public.order_status_history (order_id, status, note)
  values (v_order.id, 'confirmed', 'Online payment confirmed');
  select balance into v_restaurant_balance from public.restaurant_wallets where restaurant_id = v_order.restaurant_id;
  return jsonb_build_object('alreadySettled', false, 'restaurantAmount', v_restaurant_amount, 'restaurantBalance', coalesce(v_restaurant_balance, 0));
end
$$;

-- Wallet-funded orders follow the same split as CamerPay-paid orders.
create or replace function public.customer_wallet_pay_order(
  p_profile_id uuid,
  p_order_id uuid
) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_balance integer;
begin
  select * into v_order from public.orders
  where id = p_order_id and customer_id = p_profile_id
  for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.payment_method <> 'wallet' then raise exception 'wrong_payment_method'; end if;

  insert into public.customer_wallets (profile_id, balance)
  values (p_profile_id, 0) on conflict (profile_id) do nothing;
  select balance into v_balance from public.customer_wallets where profile_id = p_profile_id for update;
  if v_order.is_paid then return coalesce(v_balance, 0); end if;
  if v_balance < v_order.total then raise exception 'insufficient_customer_wallet'; end if;

  update public.customer_wallets set balance = balance - v_order.total, updated_at = now()
  where profile_id = p_profile_id returning balance into v_balance;
  insert into public.customer_wallet_ledger (profile_id, amount, kind, note, reference, balance_after)
  values (p_profile_id, -v_order.total, 'payment', 'Order payment', v_order.reference, v_balance);

  perform public.settle_online_order_payment(v_order.id);
  return v_balance;
end
$$;

revoke all on function public.settle_online_order_payment(uuid) from public, anon, authenticated;
grant execute on function public.settle_online_order_payment(uuid) to service_role;
revoke all on function public.customer_wallet_pay_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_wallet_pay_order(uuid, uuid) to service_role;