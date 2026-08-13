-- ═══════════════════════════════════════════════════════════════════════════
--  0022 — Withdrawal fee ledger
--
--  The 1.5% (or whatever rate is set) withheld from a CamerPay payout is the
--  platform's revenue — but until now it existed only in console logs. This
--  table is the book: one row per payout that carried a fee, written at
--  ACCEPTANCE time by the payout action (probePayout), and summed by the
--  admin dashboard's "Fee revenue" tile.
--
--  Same trust model as camerpay_requests: no policies on purpose. The
--  publishable key touches nothing here; every write (the payout action) and
--  read (the admin dashboard) goes through the service-role client.
--
--  A row is bookkeeping, never an authority on money — a failed ledger write
--  must not fail the payout, so the action logs and proceeds.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.withdrawal_fees (
  id          uuid primary key default gen_random_uuid(),
  -- The CamerPay tracking id of the payout this fee came from.
  reply_to    text,
  phone       text not null,             -- 9 digits, starts with 6, no +237
  gross       integer not null check (gross > 0),   -- what the recipient is owed
  fee         integer not null check (fee >= 0),    -- withheld, kept by the platform
  net         integer not null check (net >= 0),    -- what was actually sent
  created_at  timestamptz not null default now()
);

create index if not exists withdrawal_fees_created_idx on public.withdrawal_fees (created_at desc);

alter table public.withdrawal_fees enable row level security;

-- No policies on purpose — see camerpay_requests for the reasoning.


-- ── Verify ────────────────────────────────────────────────────────────────

-- Expect exactly one row, with rowsecurity = true.
select count(*) as withdrawal_fees_rls
from pg_tables
where schemaname = 'public' and tablename = 'withdrawal_fees' and rowsecurity;
