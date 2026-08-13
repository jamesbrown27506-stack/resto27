-- ═══════════════════════════════════════════════════════════════════════════
--  0028 — Let the assets bucket hold audio
--
--  ─────────────────────────────────────────────────────────────────────────
--  WHY THE BUCKET HAD TO CHANGE, AND WHY ONLY THIS MUCH.
--
--  Migration 0016 created `assets` with an allowed_mime_types allow-list of
--  five image types. That allow-list is enforced by Storage itself, so an
--  uploaded notification sound was rejected at the bucket even though the
--  server had already sniffed its bytes and accepted them. Adding the four
--  audio types below is the whole change.
--
--  THE ALLOW-LIST STAYS AN ALLOW-LIST. It would have been shorter to drop
--  allowed_mime_types entirely; that would also let anything at all into a
--  PUBLIC bucket served from our own origin, which is how an uploaded file
--  becomes a stored XSS. The five image types and four audio types are what
--  the product actually stores.
--
--  Note what is NOT here: no SVG (XML, can carry <script>) and no
--  file_size_limit change. 2 MB was already generous for a notification
--  chime — lib/uploads.ts caps audio tighter still, at 1 MB, because this is
--  a sound that plays on every order and downloads on every page.
--  ─────────────────────────────────────────────────────────────────────────
--
--  Run after 0016. Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

update storage.buckets
set allowed_mime_types = array[
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/x-icon',
      -- Audio, for the notification sound an administrator uploads.
      'audio/wav',      -- WAV, what the built-in sounds already are
      'audio/mpeg',     -- MP3
      'audio/ogg',      -- OGG Vorbis / Opus
      'audio/mp4'       -- M4A / AAC in an MP4 container
    ]
where id = 'assets';


-- ═══════════════════════════════════════════════════════════════════════════
--  Verify — expect one row, listing nine mime types.
-- ═══════════════════════════════════════════════════════════════════════════

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'assets';
