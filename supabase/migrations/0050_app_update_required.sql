-- ═══════════════════════════════════════════════════════════════════════════
--  0050 — Whether the installed app must update before it can be used
--
--  Safe to run more than once; `on conflict (key) do nothing` never
--  overwrites a choice an admin has since made.
--
--  Seeded OFF: the app offers each new version with a "Later" button. On, it
--  shows a screen that cannot be dismissed until the new APK is installed —
--  meant for an update that fixes something broken (payments,
--  notifications), not for every release. Read by
--  src/lib/mobile-app-settings.ts, which compiles in the same default.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.settings (key, value, value_type, category, label, description)
values
  ('app_update_required', 'false', 'boolean', 'mobile',
   'Require the latest app version',
   'Off: the installed app offers each new version with a "Later" button. On: it blocks until the new version is installed. Keep it for an update that fixes something broken, like payments or notifications.')
on conflict (key) do nothing;

select key, value, category from public.settings where key = 'app_update_required';
