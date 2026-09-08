-- 0045 — Firebase Cloud Messaging delivery provider.
--
-- Browser FCM tokens are server-owned contact details. RLS is enabled with no
-- public policies: reads and writes go through authenticated server actions.

create table if not exists public.fcm_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  device_id uuid not null unique,
  web_endpoint text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fcm_subscriptions_profile_idx
  on public.fcm_subscriptions (profile_id);

drop trigger if exists set_updated_at on public.fcm_subscriptions;
create trigger set_updated_at before update on public.fcm_subscriptions
  for each row execute function public.set_updated_at();

alter table public.fcm_subscriptions enable row level security;

insert into public.settings (key, value, value_type, category, label, description) values
  ('push_provider', 'web_push', 'string', 'notifications',
   'Push delivery provider',
   'Choose the provider for operational push notifications: Resto237 Web Push or Firebase Cloud Messaging.')
on conflict (key) do nothing;

select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'fcm_subscriptions';

select key, value from public.settings where key = 'push_provider';
