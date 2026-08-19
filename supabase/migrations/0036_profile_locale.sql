-- ═══════════════════════════════════════════════════════════════════════════
--  0036 — Every notification in the language its reader chose
--
--  SAFE TO RUN MORE THAN ONCE. The column add is `if not exists`, the
--  constraint is dropped by name before it is created, and there is no
--  backfill to repeat — the default IS the previous behaviour.
--
--  ───────────────────────────────────────────────────────────────────────
--   THE PROBLEM THIS SOLVES.
--
--   lib/notify already writes every message in two languages: `copy()` takes
--   a locale and every event has a French and an English form. But the
--   recipient loop chose that locale like this:
--
--       const locale = recipient.kind === "admin" ? "en" : "fr";
--
--   So the language was decided by ROLE, not by preference. Every manager and
--   every customer received French — the bell, the email and the push
--   notification — no matter which way they had set the FR/EN toggle two
--   minutes earlier. An English-speaking restaurant owner in Douala had a
--   dashboard in English and an inbox in French.
--
--   The toggle could not help. It writes a COOKIE, which is exactly right for
--   rendering a page and useless here: a notification is composed in a
--   background write — an order being confirmed, a review being replied to,
--   the nightly billing sweep — with no request, no cookie and no browser
--   anywhere in scope. The preference has to live where the server can read
--   it without the person being present, which means on the row.
--
--   `profiles.locale` is that. The cookie still drives rendering (it must —
--   it is per-device and works before sign-in); this column drives everything
--   composed on someone's behalf while they are not looking.
--
--   DEFAULT 'fr' ON PURPOSE. It is what every existing profile receives
--   today, so running this migration changes nobody's experience until they
--   actually touch the toggle. Admins are unaffected: notify() keeps its
--   English default for the admin area, which is English by design.
--  ───────────────────────────────────────────────────────────────────────
--
--  RLS: no change. `profiles` is already covered — a profile is readable and
--  updatable by its owner and by the service role, and this column is neither
--  more nor less sensitive than the name sitting beside it.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists locale text not null default 'fr';

-- Named, so re-running drops and recreates rather than failing on a duplicate.
alter table public.profiles
  drop constraint if exists profiles_locale_supported;

alter table public.profiles
  add constraint profiles_locale_supported
    check (locale in ('fr', 'en'));


-- ── Verify ────────────────────────────────────────────────────────────────

-- Expect one row: text, not null, defaulting to 'fr'.
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name = 'locale';

-- Expect one row — the two-language constraint.
select conname
from pg_constraint
where conrelid = 'public.profiles'::regclass
  and conname = 'profiles_locale_supported';
