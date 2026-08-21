-- ═══════════════════════════════════════════════════════════════════════════
--  0040 — The customer accepts the delivery fee before the kitchen starts
--
--  RUN THIS AS WELL AS 0038 AND 0039. All three are idempotent and order does
--  not matter.
--
--  ⚠ AGAINST THE PROJECT THE APP TALKS TO. Check first:
--      select current_database(), count(*) from public.restaurants;
--
--  ─────────────────────────────────────────────────────────────────────────
--  THE CUSTOMER COMMITTED TO A TOTAL THAT DID NOT INCLUDE DELIVERY.
--
--  A delivery order is placed before anyone knows what delivering it costs:
--  the fee depends on the address, and the restaurant quotes it when it looks
--  at the order. Until now that quote was applied unilaterally — the
--  restaurant typed a number, the order went straight to `confirmed`, the
--  total rose, and the customer found out from a notification after the fact.
--
--  Two things go wrong with that. The customer is charged a fee they never
--  agreed to and whose only remedy is cancelling an order the kitchen has
--  already begun. And the kitchen begins: `confirmed` is the signal to start
--  cooking, so food is prepared for an order the customer may be about to
--  reject over its price. That is thrown-away food on every disputed fee.
--
--  `awaiting_customer` is the gap between those two. The restaurant quotes,
--  the order stops there, and the customer sees the fee and the new total with
--  Accept and Decline. Accepting moves it to `confirmed` — which is still what
--  tells the kitchen to start, so the kitchen only ever starts on an order
--  somebody has agreed to pay for. Declining cancels it, before any food or
--  any rider has been committed.
--
--  Only a fee GREATER THAN ZERO stops here. "We deliver free" changes nothing
--  the customer agreed to, so there is nothing to accept and the order
--  confirms directly, as it always did.
-- ═══════════════════════════════════════════════════════════════════════════

-- Dropped and recreated rather than added: 0005 created it inline with six
-- values, so there is already a constraint of this name to replace.
alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
    check (status in (
      'pending',
      'awaiting_customer',
      'confirmed',
      'preparing',
      'shipped',
      'delivered',
      'cancelled'
    ));

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect one row, and its definition must mention awaiting_customer.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.orders'::regclass
  and conname = 'orders_status_check';
