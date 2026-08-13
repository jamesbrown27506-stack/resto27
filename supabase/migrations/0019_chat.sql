-- ═══════════════════════════════════════════════════════════════════════════
--  0019 — In-app messaging
--
--  Threaded conversations between a signed-in customer and either a
--  restaurant (restaurant_id set) or the platform team (restaurant_id NULL,
--  handled by admins). Requires 0001–0018 (current_profile_id() from 0006).
--  Idempotent — safe to re-run.
--
--  WHAT THIS FILE ADDS, AND WHY:
--
--    · conversations           — one thread: who it is between, subject,
--      status, and the two unread counters (customer side / staff side).
--    · conversation_messages   — the thread's rows. Sender role is snapshotted
--      at insert so a role change mid-thread never rewrites history.
--    · RLS                     — participants may READ their own threads:
--      the customer, active staff of the restaurant, or admins for platform
--      threads. Writes stay server-only with the service-role key, exactly
--      like notifications.
--    · supabase_realtime       — conversation_messages added so an open
--      thread appends live, filtered by the same RLS.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  1. Conversations
--
--  restaurant_id NULL means "a platform thread" — the customer wrote to the
--  RestoLink team, and admins are the staff side. Unread is two counters, one
--  per side, maintained by the server actions (chat-actions.ts): sending bumps
--  the OTHER side, reading zeroes YOUR side. The bell/realtime notification
--  row is what makes a new message impossible to miss; these counters feed the
--  inbox lists and nav badges.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.profiles(id) on delete cascade,
  -- NULL = platform thread, answered by admins.
  restaurant_id    uuid references public.restaurants(id) on delete cascade,

  subject          text not null default '',
  status           text not null default 'open' check (status in ('open','closed')),

  customer_unread  integer not null default 0 check (customer_unread >= 0),
  staff_unread     integer not null default 0 check (staff_unread >= 0),

  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists conversations_customer_idx
  on public.conversations (customer_id, last_message_at desc);
create index if not exists conversations_restaurant_idx
  on public.conversations (restaurant_id, last_message_at desc);
-- The admin inbox: every platform thread, newest first.
create index if not exists conversations_platform_idx
  on public.conversations (last_message_at desc) where restaurant_id is null;

drop trigger if exists set_updated_at on public.conversations;
create trigger set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

alter table public.conversations enable row level security;


-- ═══════════════════════════════════════════════════════════════════════════
--  2. Messages
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.conversation_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_id        uuid not null references public.profiles(id) on delete cascade,
  -- Snapshotted at insert: a customer promoted to manager mid-thread does not
  -- rewrite the messages they sent as a customer.
  sender_role      text not null check (sender_role in ('customer','manager','admin')),
  body             text not null check (length(body) between 1 and 2000),
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists conversation_messages_thread_idx
  on public.conversation_messages (conversation_id, created_at);

alter table public.conversation_messages enable row level security;


-- ═══════════════════════════════════════════════════════════════════════════
--  3. RLS — read your own threads, nothing else
--
--  The inbox and the realtime append run in the browser with the publishable
--  key, so these policies are the only thing between one user and another's
--  private messages. The staff check reads ACTIVE staff rows only — someone
--  removed from the team must lose access immediately, not on the next
--  payroll run.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists "participants read conversations" on public.conversations;
create policy "participants read conversations" on public.conversations
  for select to authenticated
  using (
    customer_id = public.current_profile_id()
    or (
      restaurant_id is not null
      and exists (
        select 1 from public.restaurant_staff rs
        where rs.restaurant_id = conversations.restaurant_id
          and rs.profile_id = public.current_profile_id()
          and rs.status = 'active'
      )
    )
    or (
      restaurant_id is null
      and exists (
        select 1 from public.profiles p
        where p.id = public.current_profile_id() and p.role = 'admin'
      )
    )
  );

drop policy if exists "participants read messages" on public.conversation_messages;
create policy "participants read messages" on public.conversation_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_messages.conversation_id
        and (
          c.customer_id = public.current_profile_id()
          or (
            c.restaurant_id is not null
            and exists (
              select 1 from public.restaurant_staff rs
              where rs.restaurant_id = c.restaurant_id
                and rs.profile_id = public.current_profile_id()
                and rs.status = 'active'
            )
          )
          or (
            c.restaurant_id is null
            and exists (
              select 1 from public.profiles p
              where p.id = public.current_profile_id() and p.role = 'admin'
            )
          )
        )
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
--  4. Realtime — let an open thread append live
--
--  Replica identity full so INSERT payloads carry the whole row. Idempotent:
--  adding a table to a publication twice is an error, so the step is guarded.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.conversation_messages replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'conversation_messages'
     ) then
    alter publication supabase_realtime add table public.conversation_messages;
  end if;
end
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  5. Verify
-- ═══════════════════════════════════════════════════════════════════════════

-- Expect two tables with rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('conversations', 'conversation_messages');

-- Expect the two participant policies.
select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('conversations', 'conversation_messages');

-- Expect conversation_messages in the realtime publication.
select * from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'conversation_messages';
