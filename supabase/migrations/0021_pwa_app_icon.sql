-- ═══════════════════════════════════════════════════════════════════════════
--  0021 — PWA app icon
--
--  The icon people see when they install the app (home screen, install
--  prompt, iOS Safari Web Push) used to be the static, generated
--  public/app-icon-*.png with no way to change it. This adds a setting the
--  administrator fills from /a/settings → Branding → "App icon (PWA)".
--
--  The manifest is now generated per request by src/app/manifest.ts, which
--  reads this row; when it is empty the manifest falls back to the static
--  generated icons. The upload path is the same bytes-validated pipeline as
--  the logo and favicon (migration 0016 bucket).
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.settings (key, value, value_type, category, label, description)
values
  ('brand_icon_url', '', 'string', 'branding', 'App icon (PWA)',
   'Shown on the home screen and install prompt when someone installs the app. Square PNG or WebP, ideally 512×512. Falls back to the default generated icon when empty.')
on conflict (key) do nothing;
