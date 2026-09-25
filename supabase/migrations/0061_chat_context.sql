-- ═══════════════════════════════════════════════════════════════════════════
--  0061 — Chat context: what a conversation is about
--
--  Requires 0019 (conversations), 0005 (orders), 0006 (reservations).
--  Idempotent — safe to re-run. Apply by hand in the Supabase SQL editor.
--
--  WHY:
--    The in-app chat is now the ONLY channel between a customer and a
--    restaurant — phone numbers and WhatsApp links are deliberately not shown
--    to either side. So the chat has to carry what a phone call used to: "I'm
--    calling about order CMD-4F2A91". A thread opened from an order or a
--    reservation records which one, and both sides see it as a linked chip in
--    the thread header.
--
--  WHAT IS *NOT* ADDED, AND WHY:
--    · No new thread kind for "restaurant writes to customer". A thread is
--      already keyed (customer_id, restaurant_id); who sent the first message
--      is irrelevant to the keying, and the existing RLS — customer reads
--      their threads, active staff read their branch's — covers a
--      restaurant-started thread unchanged. The relationship rule (a branch
--      may only open a thread with a customer who ordered or booked there) is
--      enforced in the server action, where the caller's branch is known.
--    · No unique index per (customer, restaurant, context). Older data may
--      already hold several open threads for the same pair, which would make
--      the index fail to build; the server action reuses an open thread
--      before creating one.
--
--  UNTIL THIS RUNS the code stores the reference in the thread subject
--  ("Commande CMD-4F2A91") and shows it unlinked — see src/lib/chat/context.ts.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.conversations
  add column if not exists order_id uuid
    references public.orders(id) on delete set null;

alter table public.conversations
  add column if not exists reservation_id uuid
    references public.reservations(id) on delete set null;

-- A thread is about one thing at most. Two references would make "which one
-- is this about?" a question the chip cannot answer.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'conversations_single_context_chk'
      and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations
      add constraint conversations_single_context_chk
      check (order_id is null or reservation_id is null);
  end if;
end
$$;

-- The reuse lookup: "is there already an open thread between this customer
-- and this restaurant about this order / reservation?"
create index if not exists conversations_order_ctx_idx
  on public.conversations (order_id) where order_id is not null;
create index if not exists conversations_reservation_ctx_idx
  on public.conversations (reservation_id) where reservation_id is not null;
create index if not exists conversations_pair_idx
  on public.conversations (customer_id, restaurant_id, last_message_at desc)
  where restaurant_id is not null;

-- The relationship check reads "has this customer ever ordered / booked at
-- this branch?" — one probe each, served by these.
create index if not exists orders_restaurant_customer_idx
  on public.orders (restaurant_id, customer_id) where customer_id is not null;
create index if not exists reservations_restaurant_customer_idx
  on public.reservations (restaurant_id, customer_id) where customer_id is not null;


-- ═══════════════════════════════════════════════════════════════════════════
--  Verify
-- ═══════════════════════════════════════════════════════════════════════════

-- Expect order_id and reservation_id, both uuid, both nullable.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'conversations'
  and column_name in ('order_id', 'reservation_id');
