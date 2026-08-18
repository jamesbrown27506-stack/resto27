-- ═══════════════════════════════════════════════════════════════════════════
--  0034 — Go-live hardening
--
--  Nine changes the platform needs before it takes real money from real
--  people, in ONE file. They arrived as nine separate migrations; they are
--  consolidated here because this is pasted into the Supabase SQL editor by
--  hand, and nine pastes is nine chances to stop halfway and leave the
--  database in a state no file describes.
--
--  SAFE ON ANY DATABASE THAT HAS RUN 0001–0033, AND SAFE TO RUN MORE THAN
--  ONCE. Every column add is `if not exists`, every index `if not exists`,
--  every function `create or replace`, every trigger and policy dropped by
--  name before it is created, every settings insert `on conflict do nothing`.
--  Both backfills are guarded so a second run touches no rows. NOTHING in
--  this file overwrites a value an administrator may have set.
--
--  ORDER IS DEPENDENCY ORDER, NOT THE ORDER THESE WERE WRITTEN IN. Columns
--  come before the triggers, backfills and indexes that read them; a function
--  before the trigger that calls it; the settings write-guard (§7) before the
--  rows §9 seeds, so those rows are validated by the same rule as every other
--  setting; and the scheduler is LAST because it is the only section that can
--  reach outside the database.
--
--  ───────────────────────────────────────────────────────────────────────
--
--   1. WHEN DID THIS ORDER LEAVE THE KITCHEN?  `orders.shipped_at`,
--      `orders.delivery_alert_sent_at`
--
--      The stuck-delivery sweep (/api/cron/delivery-monitor) asks one
--      question: "which delivery orders have been OUT for more than 30
--      minutes?". Until now the only answer available was `updated_at`, which
--      every later touch moves — a manager opening the order and changing the
--      delivery fee reset the clock, and the rider who vanished an hour ago
--      looked freshly dispatched.
--
--      `shipped_at` is stamped ONCE, by a trigger, the moment the status first
--      becomes `shipped` (the only "out for delivery" state the order machine
--      has; see lib/format/order-status). A trigger rather than application
--      code because four call sites advance an order — manager, kitchen,
--      waiter and the customer's own cancel path — and a column the sweep
--      depends on cannot be left to whichever of them remembers.
--
--      `delivery_alert_sent_at` is the notifier's dedupe flag. Running every
--      five minutes over a 30-minute window, the sweep would otherwise
--      re-notify the same customer six times an hour about the same late
--      delivery. Stamped when the alert goes out; null means "not yet told".
--
--      BACKFILL: orders already sitting in `shipped` get the real transition
--      time from order_status_history when it recorded one, and `updated_at`
--      otherwise. Without it the sweep would see NULL for every in-flight
--      order and never report the deliveries that are late right now.
--
--   2. A GUEST CAN FIND THEIR OWN ORDER.  `orders.guest_token`
--
--      Checkout does not require an account: `orders.customer_id` is nullable
--      on purpose (0005), because most first orders come from someone who is
--      not signing up to try a restaurant. That leaves those orders
--      unreachable — the guest has a reference number, but a reference is
--      short, sequential-looking and printed on the receipt, so it can never
--      be the thing that authorises reading an order. Anyone could walk the
--      range and read strangers' names, phone numbers and delivery addresses.
--
--      `guest_token` is a long random secret, generated at checkout and sent
--      only to the person who placed the order (the link in their
--      confirmation). Holding it IS the proof of ownership, so it must be
--      unguessable: generated server-side from a CSPRNG, never derived from
--      the reference, the phone number or the time.
--
--   3. ONE PROVIDER ROW SETTLES ONE ATTEMPT, EVER.
--      `payment_attempts.provider_row_id`
--
--      CamerPay has no per-attempt status endpoint: the reconciler pulls a
--      REPORT — a list of the merchant's recent transactions — and matches
--      rows to attempts by amount, phone and time window. Two attempts by the
--      same phone for the same amount minutes apart (a customer who retried)
--      match the same report row, and matching by shape alone settles BOTH
--      from ONE payment. The platform then hands over two subscriptions for
--      one collection, and no amount of care in the matching code prevents it
--      under a retry or a concurrent reconciliation run.
--
--      `provider_row_id` records the identity of the report row an attempt
--      consumed, written in the same UPDATE that settles it. The partial
--      UNIQUE index is the claim itself: the SECOND attempt to claim the same
--      report row fails on the constraint instead of being credited. Same
--      rule as payment_webhook_events_unique (§6, migration 0005) — the
--      database decides once, rather than the application checking and then
--      acting across a race it cannot see.
--
--   4. GIVING A RESERVATION DEPOSIT BACK.
--      `reservations.deposit_refunded_at`, `reservations.deposit_refund_amount`
--
--      A deposit is taken to hold a table (0025). When the restaurant DECLINES
--      the booking, or cancels a confirmed one, the guest paid for a table
--      they will never sit at — that money has to go back, and the fact that
--      it went back has to be recorded on the booking the guest is looking at.
--
--      `deposit_refunded_at` — when it was returned. Null = never refunded,
--      which is also what "nothing was ever paid" looks like; `deposit_paid`
--      (0025) is what separates the two.
--
--      `deposit_refund_amount` — how much, in whole XAF. Its own column rather
--      than an assumption that it equals `deposit_amount`: a partial refund
--      (the guest cancelled late, the restaurant kept part) is a real outcome,
--      and reading the amount off the deposit would report a figure that was
--      never paid out.
--
--      `deposit_paid` is deliberately NOT cleared on refund. It records that
--      the money was collected, which stays true — the same rule refunds
--      follow everywhere else on the platform (§14.5): a refund is its own
--      fact, never an edit that erases the collection.
--
--   5. STAFF INVITE TOKENS STOP BEING READABLE.
--      `restaurant_staff.invite_token_hash`
--
--      `restaurant_staff.invite_token` (0006) stores the invitation secret in
--      PLAINTEXT. Anyone who can read that column — a database dump, a backup,
--      a support export, an admin screen that selects `*` — can accept an
--      invitation as somebody else and walk into a restaurant's dashboard with
--      the role it granted. A token is a credential; a credential is stored as
--      a digest, and the plaintext exists only in the email that was sent.
--
--      `invite_token_hash` is the sha256 hex digest. Acceptance hashes what
--      the link carries and looks the row up by the digest; a leaked database
--      yields nothing usable. The digest is UNIQUE (partial, so nulls do not
--      collide) for the same reason `invite_token` is: an invitation is
--      single-use, and the lookup that accepts one must never match two rows.
--
--      `invite_token` IS DEPRECATED and must stop being written. It stays for
--      now only so invitations already in someone's inbox can still be
--      accepted while the acceptance path moves over — it cannot be backfilled
--      into the hash column and then dropped in one step, because outstanding
--      links must keep working. Once no `invited` row carries a plaintext
--      token, the column and its index go in a later migration.
--
--   6. THE RATING ON THE CARD IS RECOMPUTED BY THE DATABASE.
--      `restaurants.rating`, `restaurants.review_count`
--
--      Both are denormalised (0003) so the directory can sort without
--      aggregating per row. Only ONE code path ever refreshed them: admin
--      moderation, when a review is taken down (platform-actions →
--      removeReview). A customer posting a review, editing it, or a review
--      disappearing with a cancelled account left the two numbers frozen — the
--      card kept advertising 4.8 from 12 reviews while the page below it
--      listed 19.
--
--      The recompute moves into the table itself, so every write path agrees
--      by construction. The definition MATCHES the admin recompute exactly:
--
--          visible reviews = reviews of that restaurant with removed_at null
--          rating          = round(avg(rating), 1)   — 0 when there are none
--          review_count    = how many
--
--      Same rounding as the JavaScript it replaces (Math.round(avg * 10) / 10)
--      and the same one-decimal shape as the numeric(2,1) column. If the two
--      ever disagreed, the card and the review list would tell a visitor
--      different things about the same restaurant. Every restaurant is
--      recomputed once at the end, which repairs the rows that have drifted.
--
--   7. A SETTING HAS TO BE WHAT IT SAYS IT IS.  `settings.value`
--
--      `settings.value` is text for every row, and `value_type` (0005: string,
--      integer, boolean, json) is the only thing that says how to read it.
--      Nothing enforced the pairing. The admin settings form posts a free-text
--      field for every non-boolean setting, so `service_charge_percent = 'abc'`
--      saved fine — and then every order on the platform computed its service
--      charge from NaN, hours later, in a code path nobody was watching. The
--      write is where this belongs: rejecting it costs the admin one retype,
--      and rejecting it nowhere costs a day of wrong totals.
--
--      The rules, one per declared type:
--
--        integer  — a whole number, optional sign. NOT a decimal: these are XAF
--                   amounts, day counts and point values, and the money rule is
--                   whole francs (§4). A percentage that needs a fraction is
--                   declared `string` on purpose (see withdrawal_fee_percent,
--                   migration 0020) rather than lying about being an integer.
--        boolean  — exactly 'true' or 'false', which is what the form writes
--                   and what every reader compares against.
--        json     — must parse as jsonb.
--        string   — anything.
--
--      NULL and '' pass every rule. An empty value means UNSET — cleared image
--      URLs, an untouched free-mode end date, the empty cron settings in §9 —
--      and refusing to let an admin clear a field would be a worse bug than the
--      one this section fixes.
--
--      Every row seeded by 0005–0033 already conforms; the verify block proves
--      it, and lists any row a live database would now refuse rather than
--      overwriting an admin's value to make the check pass.
--
--   8. RESERVATIONS: SEEING THE BOOK IS NOT DECIDING THE BOOK.  RLS
--
--      0006 gave staff a single `for all` policy over `reservations`:
--
--          using (public.is_staff_of(restaurant_id))
--
--      `is_staff_of` is true for ALL FIVE branch roles. So the kitchen display
--      and a waiter's phone hold INSERT, UPDATE and DELETE on every booking at
--      the branch — including confirming a table, declining a guest and
--      deleting the row outright. The application never offers that: the
--      capability matrix (lib/capabilities) gives `reservations.view` to
--      cashier and waiter, while `reservations.decide` belongs to owner and
--      manager only. A policy broader than the app's own rules is not a spare
--      tyre; it is the hole an attacker drives through the moment anyone
--      reaches the table with an anon key.
--
--      Split in two, mirroring the matrix exactly:
--
--        · SELECT — every staff member of the branch. Knowing who is booked
--          tonight is the floor's job, and `reservations.view` is held by all
--          five roles.
--        · INSERT / UPDATE / DELETE — `public.can_manage`, which is owner or
--          manager: the same two roles that hold `reservations.decide`.
--
--      The customer policy from 0006 ("customers see their own reservations",
--      read only) is untouched and still applies. Nothing in the application
--      loses a capability it actually had: every reservation write runs
--      through a server action on the service-role client, which is not
--      subject to RLS at all. This closes the direct path.
--
--   9. OPTIONAL: SCHEDULE THE THREE BACKGROUND JOBS INSIDE POSTGRES
--
--      Three endpoints have to run on a clock, or the platform quietly stops
--      being correct:
--
--        /api/cron/reconcile         every 5 min — settles payment attempts the
--                                    webhook never arrived for. Money already
--                                    taken from a customer sits unrecognised
--                                    until this runs.
--        /api/cron/expire            daily       — expires subscriptions past
--                                    their grace period and issues renewals.
--        /api/cron/delivery-monitor  every 5 min — warns the guest and the
--                                    restaurant about a delivery stuck out for
--                                    more than 30 minutes (this is what §1
--                                    exists to make answerable).
--
--      THERE ARE TWO WAYS TO DRIVE THEM, AND YOU ONLY NEED ONE:
--
--        1. VERCEL CRON (vercel.json). The default for a Vercel deployment,
--           and the path to prefer there — the schedule lives with the code, is
--           reviewed with the code, and needs nothing in the database.
--        2. THIS SECTION, for a self-hosted Supabase (or any deployment with no
--           platform scheduler), where pg_cron calls the endpoints over HTTP.
--
--      Running BOTH double-fires every job. That is harmless — all three
--      endpoints are idempotent — but it doubles the load and the logs, so pick
--      one.
--
--      THIS SECTION DOES NOTHING BY ITSELF. It schedules only when all four of
--      these hold:
--
--        · the `pg_cron` extension exists (not installed by default), and
--        · the `pg_net` extension exists (pg_cron cannot make an HTTP call
--          alone), and
--        · `settings.cron_base_url` is filled in, and
--        · `settings.cron_secret` is filled in.
--
--      Both settings are seeded EMPTY, so a fresh database — and every
--      developer's laptop — schedules nothing at all until an admin
--      deliberately fills them in from /a/settings and re-runs this file. A
--      migration that started firing HTTP requests at a stranger's URL the
--      moment it was applied would be a worse bug than no scheduler.
--
--      Re-runnable: each job is unscheduled by name before being scheduled, so
--      applying this twice leaves three jobs, not six.
--
--      THE SECRET LIVES IN `settings`, which has RLS enabled and NO policies
--      (0005) — only the service role reads it. It is the same value as the
--      CRON_SECRET the endpoints check in their Authorization header; if the
--      two drift, every scheduled call returns 401 and the jobs silently stop
--      working. cron.job_run_details is where that shows up. The scheduled
--      command carries the secret in its text, so `cron.job` is as sensitive
--      as the settings row — it is readable by the superuser role only, which
--      is where it must stay.
--
--  ───────────────────────────────────────────────────────────────────────
--
--  RLS: only §8 changes a policy. Every other section adds columns, indexes,
--  functions or triggers to tables that are already locked down.
--
--  VERIFY: one consolidated block at the very end of this file, numbered to
--  match the sections above, each query stating what it should return.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  1. Orders — the delivery clock
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Columns ───────────────────────────────────────────────────────────────

alter table public.orders
  add column if not exists shipped_at timestamptz;

alter table public.orders
  add column if not exists delivery_alert_sent_at timestamptz;

-- ── The stamp ─────────────────────────────────────────────────────────────
--
-- UPDATE only: an order is created `pending`, never `shipped`, so there is no
-- insert path to cover, and referencing OLD in an INSERT trigger raises.
--
-- `old.status is distinct from 'shipped'` makes it fire on the TRANSITION, not
-- on every later save while the order is out; the `shipped_at is null` guard
-- means a value written deliberately (an import, a correction) is kept.

create or replace function public.stamp_order_shipped_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'shipped'
     and old.status is distinct from 'shipped'
     and new.shipped_at is null then
    new.shipped_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_shipped_at on public.orders;
create trigger stamp_shipped_at
  before update on public.orders
  for each row execute function public.stamp_order_shipped_at();

-- ── Backfill ──────────────────────────────────────────────────────────────
--
-- The status history is the honest source: it records who moved the order and
-- when. `updated_at` is the fallback for orders that predate the history rows.
--
-- This UPDATE moves `updated_at` to now() on the rows it touches (set_updated_at
-- fires on any write). That is accepted deliberately: only orders currently in
-- flight match, and the next status change rewrites the column anyway.
--
-- `shipped_at is null` also makes it a no-op on a second run of this file.
update public.orders o
set shipped_at = coalesce(
  (select max(h.created_at)
   from public.order_status_history h
   where h.order_id = o.id and h.status = 'shipped'),
  o.updated_at
)
where o.status = 'shipped'
  and o.shipped_at is null;

-- The sweep's exact query: delivery orders still out, not yet alerted.
create index if not exists orders_shipped_pending_idx
  on public.orders (shipped_at)
  where status = 'shipped' and delivered_at is null;


-- ═══════════════════════════════════════════════════════════════════════════
--  2. Orders — the guest's key to their own order
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.orders
  add column if not exists guest_token text;

-- UNIQUE so a lookup by token can never return the wrong order; partial
-- because every order placed by a signed-in customer leaves it null and NULLs
-- must not collide.
--
-- RLS unchanged. The token is checked by the server, which reads the order
-- with the service-role client — the column does not open a client-side path
-- to the table.
create unique index if not exists orders_guest_token_idx
  on public.orders (guest_token)
  where guest_token is not null;


-- ═══════════════════════════════════════════════════════════════════════════
--  3. Payment attempts — one provider row settles one attempt
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.payment_attempts
  add column if not exists provider_row_id text;

-- THE ANTI-CROSS-MATCHING CONSTRAINT. Dropping this index re-opens
-- double-settlement; it is not an optimisation.
--
-- Partial (`where … is not null`) because the column is null for every attempt
-- that has not been reconciled yet, and NULLs must not collide.
create unique index if not exists payment_attempts_provider_row_idx
  on public.payment_attempts (provider, provider_row_id)
  where provider_row_id is not null;


-- ═══════════════════════════════════════════════════════════════════════════
--  4. Reservations — giving a deposit back
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.reservations
  add column if not exists deposit_refunded_at timestamptz;

alter table public.reservations
  add column if not exists deposit_refund_amount integer
    check (deposit_refund_amount is null or deposit_refund_amount >= 0);


-- ═══════════════════════════════════════════════════════════════════════════
--  5. Staff — the invitation secret becomes a digest
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.restaurant_staff
  add column if not exists invite_token_hash text;

create unique index if not exists restaurant_staff_invite_hash_idx
  on public.restaurant_staff (invite_token_hash)
  where invite_token_hash is not null;

comment on column public.restaurant_staff.invite_token is
  'DEPRECATED — plaintext invite secret. Do not write. Use invite_token_hash (sha256 hex); this column is kept only until outstanding invitations expire.';

comment on column public.restaurant_staff.invite_token_hash is
  'sha256 hex digest of the invitation token. The plaintext exists only in the email that was sent.';


-- ═══════════════════════════════════════════════════════════════════════════
--  6. Reviews — the card's rating is maintained by the database
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The recompute ─────────────────────────────────────────────────────────
--
-- SECURITY DEFINER: the trigger writes to `restaurants` on behalf of whoever
-- inserted the review, and reviews arrive from paths that must not otherwise
-- be able to touch a restaurant row.
--
-- Defined before reviews_sync_rating, which calls it, and before the trigger
-- that calls that.

create or replace function public.recompute_restaurant_rating(target uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.restaurants r
  set rating       = coalesce(agg.avg_rating, 0),
      review_count = agg.n
  from (
    select round(avg(v.rating)::numeric, 1) as avg_rating,
           count(*)::integer                as n
    from public.reviews v
    where v.restaurant_id = target
      and v.removed_at is null
  ) agg
  where r.id = target;
$$;

create or replace function public.reviews_sync_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Both sides on UPDATE: a review moved between restaurants (or had its
  -- removed_at stamped) changes the totals of the row it left as well.
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recompute_restaurant_rating(old.restaurant_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recompute_restaurant_rating(new.restaurant_id);
  end if;
  return null;
end;
$$;

-- Neither function is anyone's to call directly. PostgREST publishes every
-- function it can reach, and a SECURITY DEFINER function taking a restaurant
-- id would otherwise be an anonymous write endpoint on `restaurants`. The
-- trigger fires regardless of who holds EXECUTE, so nothing below is lost.
-- Same treatment as the wallet RPCs in 0024.
revoke all on function public.recompute_restaurant_rating(uuid) from public, anon, authenticated;
revoke all on function public.reviews_sync_rating()             from public, anon, authenticated;
grant execute on function public.recompute_restaurant_rating(uuid) to service_role;

drop trigger if exists sync_restaurant_rating on public.reviews;
create trigger sync_restaurant_rating
  after insert or update or delete on public.reviews
  for each row execute function public.reviews_sync_rating();

-- ── Backfill ──────────────────────────────────────────────────────────────
-- One pass over every restaurant, including those with no reviews at all —
-- a rating left over from a review that has since been removed has to go back
-- to 0 rather than stay as the last figure anyone computed.
--
-- The `is distinct from` guard is what makes this a no-op on a second run: by
-- then the trigger above has kept every row in agreement already.
update public.restaurants r
set rating       = coalesce(agg.avg_rating, 0),
    review_count = agg.n
from (
  select res.id as restaurant_id,
         round(avg(v.rating)::numeric, 1) as avg_rating,
         count(v.id)::integer             as n
  from public.restaurants res
  left join public.reviews v
    on v.restaurant_id = res.id and v.removed_at is null
  group by res.id
) agg
where r.id = agg.restaurant_id
  and (r.rating is distinct from coalesce(agg.avg_rating, 0)
       or r.review_count is distinct from agg.n);


-- ═══════════════════════════════════════════════════════════════════════════
--  7. Settings — a value has to parse as its declared type
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Placed before §9, so the two rows that section seeds are checked by the same
-- rule as every other setting. (They are seeded empty, and empty always
-- passes — see the NULL/'' short-circuit below.)

create or replace function public.validate_setting_value()
returns trigger
language plpgsql
as $$
begin
  if new.value is null or new.value = '' then
    return new;
  end if;

  if new.value_type = 'integer' then
    if new.value !~ '^-?[0-9]+$' then
      raise exception '% must be a whole number, got %', new.key, new.value
        using hint = 'Amounts are whole XAF — no decimals, no spaces, no thousands separator.';
    end if;

  elsif new.value_type = 'boolean' then
    if new.value not in ('true', 'false') then
      raise exception '% must be true or false, got %', new.key, new.value;
    end if;

  elsif new.value_type = 'json' then
    begin
      perform new.value::jsonb;
    exception when others then
      raise exception '% must be valid JSON, got %', new.key, new.value;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_setting_value on public.settings;
create trigger validate_setting_value
  before insert or update on public.settings
  for each row execute function public.validate_setting_value();


-- ═══════════════════════════════════════════════════════════════════════════
--  8. Reservations — RLS split: reading the book vs deciding it
-- ═══════════════════════════════════════════════════════════════════════════

-- The over-broad `for all` policy. Dropped by its 0006 name, then recreated
-- read-only under the same name so the intent reads the same in both files.
drop policy if exists "staff see their reservations" on public.reservations;
create policy "staff see their reservations" on public.reservations
  for select to authenticated
  using (public.is_staff_of(restaurant_id));

-- Writes: owner and manager, the holders of `reservations.decide`.
drop policy if exists "managers book reservations" on public.reservations;
create policy "managers book reservations" on public.reservations
  for insert to authenticated
  with check (public.can_manage(restaurant_id));

drop policy if exists "managers decide reservations" on public.reservations;
create policy "managers decide reservations" on public.reservations
  for update to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));

drop policy if exists "managers remove reservations" on public.reservations;
create policy "managers remove reservations" on public.reservations
  for delete to authenticated
  using (public.can_manage(restaurant_id));


-- ═══════════════════════════════════════════════════════════════════════════
--  9. OPTIONAL — pg_cron scheduling.  MUST STAY LAST.
--
--  Self-no-op'ing: it seeds two empty settings rows and then schedules nothing
--  unless pg_cron AND pg_net are both installed AND an admin has filled both
--  rows in. On Vercel, ignore this section entirely — vercel.json drives the
--  same three endpoints.
-- ═══════════════════════════════════════════════════════════════════════════

-- Seeded EMPTY, and `on conflict do nothing` so re-running never clears a URL
-- or a secret an admin has since typed in.
insert into public.settings (key, value, value_type, category, label, description)
values
  ('cron_base_url', '', 'string', 'operations',
   'Cron base URL',
   'Self-hosted Supabase only. The public base URL of the app (https://…, no trailing slash) that pg_cron calls for the background jobs. Empty = nothing is scheduled. Not needed on Vercel, where vercel.json drives the schedule.'),
  ('cron_secret', '', 'string', 'operations',
   'Cron bearer secret',
   'Self-hosted Supabase only. Must match the CRON_SECRET environment variable the endpoints check. Empty = nothing is scheduled.')
on conflict (key) do nothing;

do $$
declare
  v_base   text;
  v_secret text;
  v_job    record;
begin
  -- Both extensions or nothing. pg_cron alone can run SQL on a schedule but
  -- cannot reach an HTTP endpoint, which is the entire point here.
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice '0034 §9: pg_cron and/or pg_net not installed — no jobs scheduled (use Vercel Cron).';
    return;
  end if;

  select nullif(trim(value), '') into v_base   from public.settings where key = 'cron_base_url';
  select nullif(trim(value), '') into v_secret from public.settings where key = 'cron_secret';

  if v_base is null or v_secret is null then
    raise notice '0034 §9: cron_base_url / cron_secret not set — no jobs scheduled.';
    return;
  end if;

  v_base := rtrim(v_base, '/');

  -- The schedules are UTC: pg_cron reads the server clock, and Supabase runs
  -- UTC. Douala is UTC+1 with no DST, so the daily job at 02:15 UTC lands at
  -- 03:15 local — after midnight there, which is what a day-boundary sweep
  -- wants.
  for v_job in
    select * from (values
      ('resto237-reconcile',         '*/5 * * * *',  '/api/cron/reconcile'),
      ('resto237-expire',            '15 2 * * *',   '/api/cron/expire'),
      ('resto237-delivery-monitor',  '*/5 * * * *',  '/api/cron/delivery-monitor')
    ) as j(name, schedule, path)
  loop
    -- cron.unschedule() raises if the job is unknown, so it is guarded rather
    -- than wrapped in an exception handler that would also swallow real errors.
    -- This is also what makes a second run leave three jobs, not six.
    if exists (select 1 from cron.job where jobname = v_job.name) then
      perform cron.unschedule(v_job.name);
    end if;

    -- The scheduled command is a string pg_cron runs later, so both the URL
    -- and the header are quoted through format(%L) rather than concatenated:
    -- a base URL with a quote in it must not be able to rewrite the job.
    execute format(
      'select cron.schedule(%L, %L, %L)',
      v_job.name,
      v_job.schedule,
      format(
        'select net.http_get(url := %L, headers := %L::jsonb, timeout_milliseconds := 30000)',
        v_base || v_job.path,
        json_build_object('Authorization', 'Bearer ' || v_secret)::text
      )
    );
  end loop;

  raise notice '0034 §9: three jobs scheduled against %', v_base;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  ── Verify ──
--
--  Run the whole block after applying. Numbered to match the sections above.
--  Nothing here writes; it is safe to run at any time.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Orders — the delivery clock ────────────────────────────────────────

-- Expect two rows: delivery_alert_sent_at, shipped_at.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name in ('shipped_at', 'delivery_alert_sent_at')
order by column_name;

-- Expect one row: the trigger is attached.
select tgname from pg_trigger
where tgrelid = 'public.orders'::regclass and tgname = 'stamp_shipped_at';

-- Expect a single row reading 0: nothing is out for delivery without a
-- departure time.
select count(*) as shipped_without_stamp
from public.orders
where status = 'shipped' and shipped_at is null;

-- ── 2. Orders — guest token ───────────────────────────────────────────────

-- Expect one row: guest_token, text, YES.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name = 'guest_token';

-- Expect one row.
select indexname from pg_indexes
where schemaname = 'public' and indexname = 'orders_guest_token_idx';

-- Expect zero rows: no two orders share a token.
select guest_token, count(*)
from public.orders
where guest_token is not null
group by guest_token
having count(*) > 1;

-- ── 3. Payment attempts — provider row ────────────────────────────────────

-- Expect one row: provider_row_id, text, YES.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payment_attempts'
  and column_name = 'provider_row_id';

-- Expect one row: the index exists. (Its uniqueness is what closes
-- double-settlement; `indexdef` in pg_indexes spells out CREATE UNIQUE INDEX
-- if you want to see it.)
select indexname from pg_indexes
where schemaname = 'public' and indexname = 'payment_attempts_provider_row_idx';

-- Expect zero rows: no provider row has been claimed twice.
select provider, provider_row_id, count(*)
from public.payment_attempts
where provider_row_id is not null
group by provider, provider_row_id
having count(*) > 1;

-- ── 4. Reservations — deposit refunds ─────────────────────────────────────

-- Expect two rows, both nullable.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'reservations'
  and column_name in ('deposit_refunded_at', 'deposit_refund_amount')
order by column_name;

-- Expect a single row reading 0: nothing has been refunded that was never
-- collected.
select count(*) as refunded_without_payment
from public.reservations
where deposit_refunded_at is not null and not deposit_paid;

-- ── 5. Staff — invite token hash ──────────────────────────────────────────

-- Expect one row: invite_token_hash, text, YES.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'restaurant_staff'
  and column_name = 'invite_token_hash';

-- Expect one row.
select indexname from pg_indexes
where schemaname = 'public' and indexname = 'restaurant_staff_invite_hash_idx';

-- The plaintext tokens still outstanding. This count must reach zero before
-- `invite_token` can be dropped. Not expected to be zero today.
select count(*) as plaintext_invites_outstanding
from public.restaurant_staff
where status = 'invited' and invite_token is not null;

-- ── 6. Reviews — rating sync ──────────────────────────────────────────────

-- Expect one row: the trigger is attached.
select tgname from pg_trigger
where tgrelid = 'public.reviews'::regclass and tgname = 'sync_restaurant_rating';

-- Expect zero rows. Any row here is a restaurant whose card disagrees with its
-- own review list.
select r.id, r.name, r.rating, r.review_count
from public.restaurants r
join lateral (
  select round(avg(v.rating)::numeric, 1) as avg_rating, count(*)::integer as n
  from public.reviews v
  where v.restaurant_id = r.id and v.removed_at is null
) agg on true
where r.rating is distinct from coalesce(agg.avg_rating, 0)
   or r.review_count is distinct from agg.n;

-- ── 7. Settings — value integrity ─────────────────────────────────────────

-- Expect one row: the trigger is attached.
select tgname from pg_trigger
where tgrelid = 'public.settings'::regclass and tgname = 'validate_setting_value';

-- Expect zero rows. Anything listed here is a value stored before this check
-- existed that no longer parses as its declared type — left in place on
-- purpose (an admin typed it, and silently rewriting it is not this
-- migration's job), but it will be refused the next time that row is saved.
-- Integer and boolean only: no row is declared json, and a pure-SQL JSON probe
-- would abort this query rather than list the offender.
select key, value_type, value
from public.settings
where value is not null and value <> ''
  and (
    (value_type = 'integer' and value !~ '^-?[0-9]+$') or
    (value_type = 'boolean' and value not in ('true', 'false'))
  )
order by key;

-- ── 8. Reservations — RLS ─────────────────────────────────────────────────

-- Expect these five rows and no other. An 'ALL' row means an older definition
-- survived the drop:
--   staff see their reservations          SELECT
--   customers see their own reservations  SELECT
--   managers book reservations            INSERT
--   managers decide reservations          UPDATE
--   managers remove reservations          DELETE
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'reservations'
order by cmd, policyname;

-- Expect a single row reading 0: no policy on reservations grants every
-- command.
select count(*) as blanket_policies
from pg_policies
where schemaname = 'public' and tablename = 'reservations' and cmd = 'ALL';

-- ── 9. Cron ───────────────────────────────────────────────────────────────

-- Expect two rows. Both values are empty on a fresh database, and that is
-- correct — it is what stops anything being scheduled.
select key, value, category
from public.settings
where key in ('cron_base_url', 'cron_secret')
order by key;

-- Expect three rows on a self-hosted database with pg_cron, pg_net and both
-- settings filled in; expect the query to error with "relation cron.job does
-- not exist" anywhere else, which is the same thing as "nothing was
-- scheduled". Run it only where pg_cron is installed — it is left commented
-- out so this verify block does not abort on a database without it.
-- select jobname, schedule, active from cron.job
-- where jobname like 'resto237-%'
-- order by jobname;
