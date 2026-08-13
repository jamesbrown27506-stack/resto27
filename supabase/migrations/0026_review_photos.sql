-- ═══════════════════════════════════════════════════════════════════════════
--  0026 — Review photos
--
--  A review can carry up to a few photos (the dish, the plating). The images
--  themselves live in Supabase storage via the same bytes-validated upload
--  pipeline as every other image; this table is just the link between a
--  review and its photos, in the order the customer chose them.
--
--  RLS: enabled, no policies — service-role only, like the rest of the
--  platform tables.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.review_photos (
  id         uuid primary key default gen_random_uuid(),
  review_id  uuid not null references public.reviews(id) on delete cascade,
  url        text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists review_photos_review_idx on public.review_photos (review_id, sort_order);

alter table public.review_photos enable row level security;

-- No policies on purpose — see camerpay_requests for the reasoning.

-- ── Verify ────────────────────────────────────────────────────────────────

-- Expect one row, with rowsecurity = true.
select count(*) as review_photos_rls
from pg_tables
where schemaname = 'public' and tablename = 'review_photos' and rowsecurity;
