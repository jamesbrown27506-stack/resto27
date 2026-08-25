-- 0042 — Mobile Web Push lifecycle and delivery health
--
-- The endpoint alone cannot explain a mobile failure. Keep the browser that
-- created it, its advertised expiry, and the last accepted/rejected delivery
-- so diagnostics can distinguish "not subscribed" from "push service refused
-- it" from "the handset accepted it but suppressed the banner".

alter table public.push_subscriptions
  add column if not exists expiration_time timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists last_failure_code integer,
  add column if not exists failure_count integer not null default 0;

-- Maintain the counter in the database so concurrent notification sends do
-- not overwrite one another with a stale client-side value.
create or replace function public.record_push_failure(p_subscription_id uuid, p_failure_code integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.push_subscriptions
  set last_failure_at = now(),
      last_failure_code = p_failure_code,
      failure_count = failure_count + 1
  where id = p_subscription_id;
$$;

revoke all on function public.record_push_failure(uuid, integer) from public;
revoke all on function public.record_push_failure(uuid, integer) from anon;
revoke all on function public.record_push_failure(uuid, integer) from authenticated;
grant execute on function public.record_push_failure(uuid, integer) to service_role;

create index if not exists push_subscriptions_expiration_idx
  on public.push_subscriptions (expiration_time)
  where expiration_time is not null;

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'push_subscriptions'
  and column_name in (
    'expiration_time', 'last_success_at', 'last_failure_at',
    'last_failure_code', 'failure_count'
  )
order by ordinal_position;
