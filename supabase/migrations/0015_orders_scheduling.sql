-- 0015_orders_scheduling.sql
-- The checkout page lets the customer schedule a delivery or pickup
-- (§14, /checkout). NULL = "as soon as possible", the historical behaviour.

alter table public.orders
  add column scheduled_for timestamptz null;

comment on column public.orders.scheduled_for is
  'When the customer asked for the order to be delivered or picked up. NULL means ASAP.';

-- The manager queue and the kitchen filter pending orders; scheduled ones
-- deserve the same quick lookup.
create index orders_scheduled_pending_idx
  on public.orders (scheduled_for)
  where status = 'pending';
