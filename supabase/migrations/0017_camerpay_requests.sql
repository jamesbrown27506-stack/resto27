-- ═══════════════════════════════════════════════════════════════════════════
--  17. CamerPay request ledger
--
--  THE BRIDGE BETWEEN A `replyTo` AND THE REPORT ROW THAT PROVES IT.
--
--  CamerPay returns a `replyTo` tracking id when it ACCEPTS a request
--  (HTTP 202). That id is echoed by NOTHING in `rapport/transaction` — not
--  `ref` (the operator's own reference, assigned only when the customer
--  confirms), not `id` (CamerPay's row counter). A callback or a later check
--  that only has `replyTo` therefore has nothing to find the row by, and
--  every confirmation reads "pending" even when the customer has paid.
--
--  This table records the facts we DO know about each accepted request — the
--  number charged, the amount, the direction and the report counter as it
--  stood before the request — so any later check (the webhook included) can
--  locate the row in `rapport/transaction` and read its real outcome.
--
--  It is written by Server Actions and the webhook (service role, RLS
--  bypassed) and read by `confirmTransaction`. No browser role ever touches
--  it: like payment_webhook_events it exists for the server, not for the UI.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.camerpay_requests (
  id          bigint generated always as identity primary key,
  reply_to    text not null,
  direction   text not null check (direction in ('collect','payout')),
  phone       text not null,             -- 9 digits, starts with 6, no +237
  amount      integer not null check (amount > 0),
  after_id    bigint,                    -- highest report id BEFORE the request
  started_at  timestamptz not null default now(),
  status      text not null default 'pending' check (status in ('pending','success','failed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint camerpay_requests_reply_unique unique (reply_to)
);

create index if not exists camerpay_requests_status_idx on public.camerpay_requests (status);
create index if not exists camerpay_requests_phone_idx   on public.camerpay_requests (phone, amount);

alter table public.camerpay_requests enable row level security;

-- No policies on purpose. The publishable key (which ships in the browser
-- bundle) can touch nothing here; every read and write goes through the
-- service-role client, exactly like payment_webhook_events.


-- ── Verify ────────────────────────────────────────────────────────────────

-- Expect exactly one row, with rowsecurity = true.
select count(*) as camerpay_requests_rls
from pg_tables
where schemaname = 'public' and tablename = 'camerpay_requests' and rowsecurity;

-- Expect the UNIQUE constraint that makes replyTo → facts a single row.
select conname from pg_constraint where conname = 'camerpay_requests_reply_unique';
