-- Distinguish browser FCM registrations from native Capacitor registrations.
-- Native rows need platform-specific FCM payloads so Android/iOS display a
-- notification while the application is backgrounded; browser rows continue
-- through the existing service worker without duplicate system banners.

alter table public.fcm_subscriptions
  add column if not exists platform text not null default 'web',
  add column if not exists app_version text;

alter table public.fcm_subscriptions
  drop constraint if exists fcm_subscriptions_platform_check;

alter table public.fcm_subscriptions
  add constraint fcm_subscriptions_platform_check
  check (platform in ('web', 'android', 'ios'));

create index if not exists fcm_subscriptions_profile_platform_idx
  on public.fcm_subscriptions (profile_id, platform);
