-- ═══════════════════════════════════════════════════════════════════════════
--  0016 — Object storage, and the images an administrator can choose
--
--  ─────────────────────────────────────────────────────────────────────────
--   TWO THINGS, ONE MIGRATION, BECAUSE THEY ARE THE SAME PROBLEM.
--
--   1. Uploads were written to public/uploads/ on the local filesystem. That
--      works under XAMPP and CANNOT work on Vercel, where the filesystem is
--      read-only and every deploy starts from the repository. This creates the
--      bucket they move into.
--
--   2. The homepage art was seven hardcoded Unsplash URLs. This adds the
--      settings rows that let /a/appearance replace them.
--  ─────────────────────────────────────────────────────────────────────────
--
--  Run after 0015. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  1. The bucket
--
--  PUBLIC ON PURPOSE. Everything that lands here is already public by nature:
--  a restaurant's logo, a dish photo, the platform favicon, an avatar shown
--  beside a review. A private bucket would mean minting a signed URL for every
--  image on every render — latency and complexity bought for nothing.
--
--  Writes are a different matter and are NOT public: uploads go through
--  `saveUpload()` on the server with the service-role key, which bypasses
--  storage RLS. No anon insert policy is created, so the browser cannot put
--  anything in this bucket directly.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assets',
  'assets',
  true,
  2097152,                                   -- 2 MB, mirroring lib/uploads.ts
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ═══════════════════════════════════════════════════════════════════════════
--  2. Retire the dead local paths
--
--  ─────────────────────────────────────────────────────────────────────────
--   READ THIS BEFORE RUNNING — IT CLEARS COLUMNS.
--
--   Every URL currently stored looks like `/uploads/branding/<uuid>.png`. The
--   FILES behind them live on the machine that ran XAMPP and are excluded from
--   git by .gitignore, so on a deployed site every one of those paths is a
--   404 — a broken-image icon where the logo should be.
--
--   Setting them back to NULL makes the application fall back to its defaults,
--   which render as a finished site rather than a broken one. Nothing is lost
--   that was not already unreachable: re-upload through the admin screens and
--   the new value points at object storage.
--
--   Scoped with `like '/uploads/%'` so an already-migrated storage URL is left
--   alone and this stays safe to run twice.
--  ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

update public.settings    set value      = ''   where key in ('brand_logo_url', 'brand_favicon_url')
                                                  and value like '/uploads/%';
update public.profiles    set avatar_url = null where avatar_url like '/uploads/%';
update public.menu_items  set image_url  = null where image_url  like '/uploads/%';
update public.restaurants set logo_url   = null where logo_url   like '/uploads/%';
update public.restaurants set cover_url  = null where cover_url  like '/uploads/%';


-- ═══════════════════════════════════════════════════════════════════════════
--  3. The homepage images
--
--  Seven rows, one per photograph on the landing page. Empty means "use the
--  shipped default", so a fresh install still looks finished — the same rule
--  brand_name follows.
--
--  Stored in `settings` rather than a new table because there is exactly one
--  of each, for ever. A table would be a table with one row.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.settings (key, value, value_type, category, label, description)
values
  ('hero_order_image', '', 'string', 'appearance', 'Accueil — visuel « Commander »',
   'Photo du premier volet du carrousel. Format portrait, 1200 px minimum.'),
  ('hero_book_image', '', 'string', 'appearance', 'Accueil — visuel « Réserver »',
   'Photo du deuxième volet du carrousel.'),
  ('hero_explore_image', '', 'string', 'appearance', 'Accueil — visuel « Explorer »',
   'Photo du troisième volet du carrousel.'),

  ('home_dishes_image', '', 'string', 'appearance', 'Accueil — bandeau « Plats populaires »',
   'Bandeau large au-dessus des plats. Format paysage, 1600 px minimum.'),
  ('home_kitchen_image', '', 'string', 'appearance', 'Accueil — section « Cuisine »',
   'Illustration de la section destinée aux restaurateurs.'),
  ('home_branches_image', '', 'string', 'appearance', 'Accueil — section « Établissements »',
   'Illustration de la section multi-établissements.'),
  ('home_payment_image', '', 'string', 'appearance', 'Accueil — section « Paiement »',
   'Illustration de la section paiement mobile.')
on conflict (key) do nothing;
