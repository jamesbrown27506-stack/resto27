-- Native device alerts are tied to a QR visit, without requiring an account.
create table if not exists public.dining_guest_fcm_subscriptions (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.dining_guests(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android','ios')),
  updated_at timestamptz not null default now()
);
create index if not exists dining_guest_fcm_guest_idx
  on public.dining_guest_fcm_subscriptions(guest_id);
alter table public.dining_guest_fcm_subscriptions enable row level security;
revoke all on public.dining_guest_fcm_subscriptions from public, anon, authenticated;
grant all on public.dining_guest_fcm_subscriptions to service_role;
