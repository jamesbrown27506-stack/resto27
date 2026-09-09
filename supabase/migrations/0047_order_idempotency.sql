-- 0047 — Idempotency key on orders, so a retried checkout cannot duplicate.
--
-- WHY.
--   placeOrder had no duplicate protection at all. The only guard was a rate
--   limit of 10 orders / 10 minutes, whose own comment describes it as an
--   anti-DOS measure — it would accept ten identical orders in ten seconds.
--
--   The client now disables its button for the whole submit, which stops the
--   ordinary double-tap. It cannot stop the failure that actually matters on a
--   poor connection: the request reaches the server, the order is created, and
--   the response never comes back. The customer reloads, sees no order, and
--   orders again. Button state died with the page.
--
--   A key sent by the client makes the retry safe. The same key returns the
--   same order instead of creating a second one.
--
-- SAFE TO RE-RUN. Nullable column, no backfill, partial unique index.

alter table public.orders
  add column if not exists idempotency_key uuid;

comment on column public.orders.idempotency_key is
  'Client-generated per checkout attempt. A repeat insert with the same key returns the existing order rather than creating a duplicate. Null for orders placed before migration 0047 and for any path that does not send one.';

-- Partial: only rows that actually carry a key participate, so the historical
-- rows (all null) neither collide with each other nor bloat the index.
create unique index if not exists orders_idempotency_key_uidx
  on public.orders (idempotency_key)
  where idempotency_key is not null;
