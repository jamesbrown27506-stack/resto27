-- A deposit is marked paid before its wallet credit, then the booking is
-- promoted to confirmed. Hold the credited money during that promotion window.
begin;
create or replace function public.wallet_refund_hold(p_restaurant_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(greatest(0, total - coalesce(service_charge, 0))) from public.orders
      where restaurant_id = p_restaurant_id and is_paid
        and payment_method in ('mobile_money', 'wallet') and status in ('confirmed', 'preparing', 'shipped')), 0)
    + coalesce((select sum(deposit) from (
        select r.id, max(a.amount) as deposit from public.reservations r
        join public.payment_attempts a on a.reservation_id = r.id and a.status = 'succeeded'
        where r.restaurant_id = p_restaurant_id and r.status in ('confirmed', 'awaiting_payment')
          and r.deposit_paid and r.reserved_for > now()
        group by r.id
      ) deposits), 0);
$$;
revoke all on function public.wallet_refund_hold(uuid) from public, anon, authenticated;
grant execute on function public.wallet_refund_hold(uuid) to service_role;

-- Read-only rollout marker. No private account data is returned.
create or replace function public.security_invariants_version()
returns integer language sql stable security definer set search_path = public as $$ select 78; $$;
revoke all on function public.security_invariants_version() from public, anon, authenticated;
grant execute on function public.security_invariants_version() to service_role;
commit;
