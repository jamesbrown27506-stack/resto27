-- ═══════════════════════════════════════════════════════════════════════════
--  0049 — Admin switches for the mobile app on the public site
--
--  Safe to run more than once; every insert is `on conflict (key) do nothing`,
--  so it never overwrites a choice an admin has since made.
--
--  ⚠ AGAINST THE PROJECT THE APP TALKS TO. Check first:
--      select current_database(), count(*) from public.restaurants;
--
--  Two independent switches, both seeded ON — the site as it already was:
--   · app_download_visible — the "Download our app" band above the footer and
--     the Android/iPhone links in the footer.
--   · pwa_install_prompt — the browser's "Install the app" popup.
--  Neither ever shows inside the native app, whatever its value. The same
--  defaults are compiled into src/lib/mobile-app-settings.ts, so a database
--  that never runs this renders the identical site; it just offers no switches.
--
--  New category `mobile`: the admin screen gives it a "Mobile app" tab
--  (settings-form.tsx, TABS).
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.settings (key, value, value_type, category, label, description)
values
  ('app_download_visible', 'true', 'boolean', 'mobile',
   'Show the "Download our app" section',
   'The band above the footer and the Android/iPhone links in the footer. Off hides both; the APK itself stays downloadable at /downloads/resto237.apk.'),

  ('pwa_install_prompt', 'true', 'boolean', 'mobile',
   'Show the "Install the app" popup',
   'The browser prompt offering to add the site to the home screen. The notifications prompt is not affected.')
on conflict (key) do nothing;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect two rows, both true.
select key, value, category
from public.settings
where category = 'mobile'
order by key;
