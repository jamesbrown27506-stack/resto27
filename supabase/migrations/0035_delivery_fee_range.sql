-- ═══════════════════════════════════════════════════════════════════════════
--  0035 — The delivery fee a customer can expect, before they commit
--
--  SAFE TO RUN MORE THAN ONCE. Every column add is `if not exists`; the
--  constraint is dropped by name before it is created; the backfill touches
--  no row that already holds a value.
--
--  ───────────────────────────────────────────────────────────────────────
--   THE PROBLEM THIS SOLVES.
--
--   §4 and §14.3 make the delivery fee a QUOTE: orders are placed with
--   delivery_fee = 0 and the restaurant enters the real number when it
--   confirms, because in Douala the price depends on the quartier and the
--   courier's judgement and no distance formula gets it right.
--
--   That is still true. What was missing is the other half of it: the
--   customer committed to a total they had not seen, with nothing on the
--   page but "to be confirmed". Someone ordering 2 500 FCFA of food has no
--   way to know whether delivery will be 500 or 4 000 — and the moment it
--   comes back at 4 000, the order is refused and the kitchen has cooked
--   for nobody.
--
--   A RANGE fixes it without pretending we can compute the number. The
--   restaurant declares the floor and the ceiling it delivers within; the
--   customer sees "Delivery 1 000 – 3 000 FCFA" before they order, and the
--   quote at confirmation is CONSTRAINED to that band. The restaurant keeps
--   its judgement; the customer stops being surprised.
--
--   min_delivery_fee — the floor. Also the sensible pre-fill on the
--     confirmation dialog, because most orders are the near ones.
--
--   max_delivery_fee — the ceiling, and the promise that carries the weight.
--     0 means "no ceiling declared", which is why the check is written to
--     allow it: a restaurant that genuinely cannot cap its fee must be able
--     to say so rather than be forced into a number it will break.
--
--   BOTH ARE ADVERTISED, AND BOTH ARE ENFORCED. A range shown to a customer
--   that the confirmation screen then ignores is worse than showing nothing,
--   because it was believed. The server action rejects a quote outside the
--   band; this constraint only guarantees the band itself is coherent.
--  ───────────────────────────────────────────────────────────────────────
--
--  RLS: no changes. Both columns sit on `restaurants`, which is already
--  covered — public SELECT of listed restaurants, writes owner-scoped.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.restaurants
  add column if not exists min_delivery_fee integer not null default 0
    check (min_delivery_fee >= 0);

alter table public.restaurants
  add column if not exists max_delivery_fee integer not null default 0
    check (max_delivery_fee >= 0);

-- The two columns are only meaningful against each other, so the rule lives
-- in the database rather than in whichever action happens to write them.
-- `max = 0` is the "no ceiling declared" escape hatch and must stay legal.
alter table public.restaurants
  drop constraint if exists restaurants_delivery_fee_range;

alter table public.restaurants
  add constraint restaurants_delivery_fee_range
    check (max_delivery_fee = 0 or max_delivery_fee >= min_delivery_fee);


-- ── Verify ────────────────────────────────────────────────────────────────

-- Expect two rows, both integer, both defaulting to 0.
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'restaurants'
  and column_name in ('min_delivery_fee', 'max_delivery_fee')
order by column_name;

-- Expect one row — the coherence constraint.
select conname
from pg_constraint
where conrelid = 'public.restaurants'::regclass
  and conname = 'restaurants_delivery_fee_range';
