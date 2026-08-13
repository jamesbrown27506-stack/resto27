-- ═══════════════════════════════════════════════════════════════════════════
--  0024 — Restaurant wallets
--
--  Where money collected through the platform lives until a restaurant
--  withdraws it. The model:
--
--    · restaurant_wallets    — one balance per restaurant. Money lands here
--      when a payment has actually been received for that restaurant (an
--      online order, a reservation deposit), credited by the platform.
--    · wallet_ledger         — every credit and debit, so a balance is never
--      a bare number nobody can explain.
--    · withdrawal_requests   — a restaurant asks to take money OUT; an admin
--      approves (sending a real CamerPay payout, withdrawal fee withheld) or
--      rejects (the balance is untouched).
--
--  Balance integrity: the balance is a stored integer, and every mutation
--  goes through ONE server action that writes the ledger row and the balance
--  update together in a transaction. Nothing else ever writes these tables.
--
--  RLS: enabled, no policies — service-role only, like camerpay_requests and
--  withdrawal_fees.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.restaurant_wallets (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  balance       integer not null default 0 check (balance >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.wallet_ledger (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  -- Positive = money in (payment received), negative = money out (withdrawal).
  amount        integer not null,
  -- 'payment' | 'deposit' | 'withdrawal' | 'adjustment'
  kind          text not null,
  note          text,
  reference     text,
  created_at    timestamptz not null default now()
);

create index if not exists wallet_ledger_restaurant_idx on public.wallet_ledger (restaurant_id, created_at desc);

create table if not exists public.withdrawal_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  requested_by  uuid references public.profiles(id) on delete set null,

  amount        integer not null check (amount > 0),
  -- The MoMo number the money goes to, and the gross/net split at approval
  -- time — the fee is computed by the payout action, not stored in advance.
  phone         text not null,

  status        text not null default 'pending'
                  check (status in ('pending', 'paid', 'rejected')),
  note          text,
  reply_to      text,
  fee           integer,
  net           integer,
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.profiles(id) on delete set null
);

create index if not exists withdrawal_requests_status_idx on public.withdrawal_requests (status, requested_at desc);

alter table public.restaurant_wallets  enable row level security;
alter table public.wallet_ledger       enable row level security;
alter table public.withdrawal_requests enable row level security;

-- No policies on purpose — see camerpay_requests for the reasoning. Every
-- read and write goes through the service-role client.

-- ── 4. Balance mutation — one function, atomic ────────────────────────────
--
--  The balance is a stored integer; the ledger is its explanation. These two
--  must change together or the balance is a number nobody can prove. Both
--  functions are one transaction, and they are the ONLY writers: the ledger
--  row and the balance update happen in the same call.

create or replace function public.wallet_credit(
  p_restaurant_id uuid,
  p_amount       integer,
  p_kind         text,
  p_note         text default null,
  p_reference    text default null
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'credit amount must be positive';
  end if;

  insert into public.wallet_ledger (restaurant_id, amount, kind, note, reference)
  values (p_restaurant_id, p_amount, p_kind, p_note, p_reference);

  insert into public.restaurant_wallets (restaurant_id, balance)
  values (p_restaurant_id, p_amount)
  on conflict (restaurant_id) do update
    set balance = public.restaurant_wallets.balance + excluded.balance,
        updated_at = now();

  select balance into v_balance
  from public.restaurant_wallets
  where restaurant_id = p_restaurant_id;
  return v_balance;
end $$;

create or replace function public.wallet_debit(
  p_restaurant_id uuid,
  p_amount       integer,
  p_kind         text,
  p_note         text default null,
  p_reference    text default null
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'debit amount must be positive';
  end if;

  select balance into v_balance
  from public.restaurant_wallets
  where restaurant_id = p_restaurant_id
  for update;

  if v_balance is null or v_balance < p_amount then
    raise exception 'insufficient balance';
  end if;

  insert into public.wallet_ledger (restaurant_id, amount, kind, note, reference)
  values (p_restaurant_id, -p_amount, p_kind, p_note, p_reference);

  update public.restaurant_wallets
  set balance = balance - p_amount, updated_at = now()
  where restaurant_id = p_restaurant_id;

  return v_balance - p_amount;
end $$;

-- No anonymous or app-user access — the service role alone moves balances.
revoke all on function public.wallet_credit(uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.wallet_debit(uuid, integer, text, text, text)  from public, anon, authenticated;
grant execute on function public.wallet_credit(uuid, integer, text, text, text) to service_role;
grant execute on function public.wallet_debit(uuid, integer, text, text, text)  to service_role;


-- ── Verify ────────────────────────────────────────────────────────────────

-- Expect three rows, each with rowsecurity = true.
select tablename
from pg_tables
where schemaname = 'public'
  and tablename in ('restaurant_wallets', 'wallet_ledger', 'withdrawal_requests')
  and rowsecurity
order by tablename;
