-- 0067 — "reset the platform to new": wipe test activity, keep the setup
--
-- ─────────────────────────────────────────────────────────────────────────
--  A super-admin command (Admin → Settings → Danger zone) for going live
--  after testing: every trace of ACTIVITY is removed, everything that was
--  SET UP stays.
--
--  KEPT   users (profiles), restaurants, staff, menus (categories, dishes,
--         options), opening hours, tables, service areas / quartiers /
--         cuisines, settings, plans, subscriptions, customer addresses and
--         preferences, favourites, notification preferences, push device
--         registrations, promotions & coupons (usage counters reset), the
--         audit log (it records the reset itself), ops heartbeats.
--  WIPED  orders and everything hanging off them, payments / attempts /
--         webhook events / CamerPay ledger, refunds, invoices, plan changes,
--         commission statements, notifications, broadcasts, chats, support
--         messages, reservations, reviews (+ photos), loyalty points,
--         restaurant & customer wallet ledgers and withdrawals, platform fee
--         ledgers, table-service sessions / guests / rounds / messages.
--  RESET  restaurant wallet balances → 0, ratings → 0, tables → available,
--         promotion / coupon usage → 0.
--
--  One TRUNCATE over the whole wiped set, inside one transaction: nothing
--  kept references anything wiped (checked when this was written), and
--  TRUNCATE without CASCADE refuses rather than silently emptying a kept
--  table if that ever changes. Irreversible — take a Supabase backup first.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.platform_activity_counts()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_table text;
  v_count bigint;
begin
  foreach v_table in array array[
    'orders', 'payment_attempts', 'refunds', 'invoices', 'notifications',
    'conversation_messages', 'reservations', 'reviews', 'withdrawal_requests',
    'loyalty_ledger', 'dining_sessions', 'support_messages'
  ] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('select count(*) from public.%I', v_table) into v_count;
      v_result := v_result || jsonb_build_object(v_table, v_count);
    end if;
  end loop;
  return v_result;
end
$$;

create or replace function public.platform_reset_activity(p_confirm text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_before jsonb;
  v_tables text[] := array[
    'order_items', 'order_payments', 'order_status_history', 'orders',
    'payment_attempts', 'payment_webhook_events', 'payments', 'camerpay_requests',
    'refunds', 'invoices', 'plan_changes', 'commission_statements',
    'notifications', 'broadcasts',
    'conversation_messages', 'conversations', 'support_messages',
    'reservations', 'review_photos', 'reviews',
    'loyalty_ledger', 'promotion_redemptions',
    'wallet_ledger', 'withdrawal_requests', 'withdrawal_fees',
    'customer_wallet_ledger', 'customer_wallets',
    'platform_fees', 'platform_revenue_ledger',
    'dining_messages', 'dining_round_items', 'dining_rounds', 'dining_guests',
    'dining_guest_push_subscriptions', 'dining_guest_fcm_subscriptions', 'dining_sessions'
  ];
  v_existing text[] := '{}';
  v_table text;
begin
  if p_confirm is distinct from 'RESET' then
    raise exception 'confirmation_required';
  end if;

  v_before := public.platform_activity_counts();

  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is not null then
      v_existing := v_existing || format('public.%I', v_table);
    end if;
  end loop;

  execute 'truncate table ' || array_to_string(v_existing, ', ') || ' restart identity';

  update public.restaurant_wallets set balance = 0, updated_at = now() where balance <> 0;
  update public.restaurants set rating = 0, review_count = 0 where rating <> 0 or review_count <> 0;
  update public.restaurant_tables set status = 'available' where status = 'occupied';
  update public.promotions set used_count = 0 where used_count <> 0;
  if to_regclass('public.platform_coupons') is not null then
    execute 'update public.platform_coupons set used_count = 0 where used_count <> 0';
  end if;

  return jsonb_build_object('wiped', v_before, 'tables', array_length(v_existing, 1));
end
$$;

revoke all on function public.platform_activity_counts() from public, anon, authenticated;
revoke all on function public.platform_reset_activity(text) from public, anon, authenticated;
grant execute on function public.platform_activity_counts() to service_role;
grant execute on function public.platform_reset_activity(text) to service_role;

-- Verify (read-only): select public.platform_activity_counts();
