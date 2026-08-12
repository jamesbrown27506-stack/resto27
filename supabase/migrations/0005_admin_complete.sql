-- ═══════════════════════════════════════════════════════════════════════════
--  0005 — Everything the administrator needs
--
--  One migration, 17 tables, covering every remaining admin screen:
--
--    settings                 /a/settings, branding everywhere
--    audit_log                /a/audit, /a/impersonate
--    notifications            /a/notifications
--    broadcasts               /a/broadcast
--    support_messages         /a/support
--    orders, order_items,
--    order_status_history,
--    order_payments           /a/analytics, /a/commissions, /a/export
--    reviews                  /a/reviews
--    invoices                 /a/payments
--    payment_attempts,
--    payments,
--    payment_webhook_events   /a/payments
--    refunds                  /a/refunds
--    commission_statements    /a/commissions
--    plan_changes             /a/subscriptions
--
--  REQUIRES 0001–0004. Idempotent — safe to re-run.
--
--  Four rules from §12 are enforced by the SCHEMA here, not by convention:
--    · audit_log cannot be updated or deleted (REVOKE)
--    · webhook replay safety is a UNIQUE constraint, not a check-then-act
--    · orders snapshot price, options and address — no FKs to live data
--    · nothing cascades from profiles into financial history
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  1. Platform settings
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.settings (
  key         text primary key,
  value       text,
  value_type  text not null default 'string'
                check (value_type in ('string', 'integer', 'boolean', 'json')),
  category    text not null default 'general',
  label       text,
  description text,
  updated_at  timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.settings;
create trigger set_updated_at before update on public.settings
  for each row execute function public.set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
--  2. Audit log — APPEND ONLY
--
--  actor_email and actor_role are SNAPSHOTTED, not joined (§9). Actors get
--  anonymised; the trail has to survive them. A join to profiles would show
--  "Compte supprimé" against every historical action.
--
--  impersonator_email is SEPARATE from actor_email. When an admin acts as a
--  tenant, both identities are recorded — otherwise the log shows the tenant
--  doing things they never did (§8).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.audit_log (
  id                  bigint generated always as identity primary key,
  action              text not null,                  -- 'restaurant.approve'
  entity_type         text not null,                  -- 'restaurant'
  entity_id           text,

  actor_profile_id    uuid,                           -- no FK: see above
  actor_email         text not null,
  actor_role          text not null,
  impersonator_email  text,

  summary             text not null default '',
  metadata            jsonb,
  ip_address          text,
  user_agent          text,
  created_at          timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_entity_idx  on public.audit_log (entity_type, entity_id);
create index if not exists audit_log_actor_idx   on public.audit_log (actor_email);

-- The rule made structural. /a/audit has no edit or delete control, and this
-- is what makes that guarantee rather than a promise.
revoke update, delete on public.audit_log from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
--  3. Notifications and broadcasts
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  body         text not null default '',
  tone         text not null default 'info' check (tone in ('info','success','warning','error')),
  href         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_profile_idx on public.notifications (profile_id, created_at desc);
create index if not exists notifications_unread_idx  on public.notifications (profile_id) where read_at is null;

create table if not exists public.broadcasts (
  id               uuid primary key default gen_random_uuid(),
  subject          text not null,
  body             text not null,
  audience         text not null,                 -- 'managers' | 'customers' | 'plan:pro' | 'area:<id>'
  channels         text not null default 'in_app',
  recipient_count  integer not null default 0,
  sent_by_email    text not null,                 -- snapshotted, like audit_log
  sent_at          timestamptz not null default now()
);


-- ═══════════════════════════════════════════════════════════════════════════
--  4. Support inbox
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.support_messages (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null,
  subject      text not null,
  body         text not null,
  status       text not null default 'open' check (status in ('open','replied','resolved')),
  reply_body   text,
  replied_by   text,
  replied_at   timestamptz,
  ip_address   text,
  created_at   timestamptz not null default now()
);

create index if not exists support_status_idx on public.support_messages (status, created_at desc);


-- ═══════════════════════════════════════════════════════════════════════════
--  5. Orders
--
--  THE ORDER SNAPSHOTS EVERYTHING (§3, §12 rule 4).
--
--  Delivery name, phone, address, quartier and landmark are COPIED here, not
--  referenced from customer_addresses. Item price and chosen options are
--  copied onto order_items, not referenced from menu_items.
--
--  If a restaurant raises a price tomorrow, last week's order must not change.
--  A normalised design with foreign keys here is a correctness bug, not a
--  cleaner schema.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique,

  restaurant_id         uuid not null references public.restaurants(id) on delete restrict,
  -- on delete set null, never cascade: anonymising a customer must not delete
  -- the restaurant's sale or the platform's commission record (§12 rule 7).
  customer_id           uuid references public.profiles(id) on delete set null,

  type                  text not null check (type in ('delivery','pickup','dine_in')),
  status                text not null default 'pending'
                          check (status in ('pending','confirmed','preparing','shipped','delivered','cancelled')),

  -- ── Money. Whole XAF, always. Mirrors lib/orders/totals exactly. ──
  subtotal              integer not null default 0 check (subtotal >= 0),
  discount_amount       integer not null default 0 check (discount_amount >= 0),
  service_charge_percent numeric(4,2) not null default 5,
  service_charge        integer not null default 0 check (service_charge >= 0),
  loyalty_points_used   integer not null default 0 check (loyalty_points_used >= 0),
  loyalty_value         integer not null default 0 check (loyalty_value >= 0),
  total                 integer not null default 0 check (total >= 0),
  currency              text    not null default 'XAF',

  -- ── The delivery fee is QUOTED, not calculated (§4) ──
  -- Placed at 0; the restaurant enters it on confirmation and the stamp below
  -- records when. NULL stamp = not yet quoted, which is why the UI can honestly
  -- say "to be confirmed" instead of showing a misleading 0.
  delivery_fee          integer not null default 0 check (delivery_fee >= 0),
  delivery_fee_set_at   timestamptz,

  promo_code            text,

  -- ── Delivery snapshot. Copies, deliberately. ──
  delivery_name         text,
  delivery_phone        text,
  delivery_address      text,
  delivery_quartier     text,
  delivery_landmark     text,
  table_number          text,

  payment_method        text not null default 'cash_on_delivery'
                          check (payment_method in ('cash_on_delivery','pay_at_restaurant','mobile_money')),
  is_paid               boolean not null default false,

  notes                 text,
  cancelled_reason      text,
  cancelled_at          timestamptz,
  delivered_at          timestamptz,
  delivery_rating       integer check (delivery_rating between 1 and 5),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists orders_restaurant_idx on public.orders (restaurant_id, created_at desc);
create index if not exists orders_customer_idx   on public.orders (customer_id, created_at desc);
create index if not exists orders_status_idx     on public.orders (status);
create index if not exists orders_created_idx    on public.orders (created_at desc);
-- Commission runs filter on exactly this pair (§7).
create index if not exists orders_delivered_idx  on public.orders (restaurant_id, created_at)
  where status = 'delivered';

drop trigger if exists set_updated_at on public.orders;
create trigger set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table if not exists public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,

  -- Kept only for reporting. NOT the source of the name or price below —
  -- those are the snapshot, and they must survive the item being edited or
  -- deleted entirely.
  menu_item_id   uuid,

  name           text    not null,
  unit_price     integer not null check (unit_price >= 0),
  quantity       integer not null check (quantity > 0),
  options_json   jsonb,
  options_label  text,
  options_hash   text,
  notes          text,
  created_at     timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);

create table if not exists public.order_status_history (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders(id) on delete cascade,
  status     text not null,
  by_email   text,                                -- snapshotted
  by_name    text,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists order_status_history_order_idx on public.order_status_history (order_id, created_at);

create table if not exists public.order_payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  amount       integer not null check (amount > 0),
  method       text not null,
  collected_by text,
  collected_at timestamptz not null default now()
);


-- ═══════════════════════════════════════════════════════════════════════════
--  6. Reviews
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.reviews (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  customer_id    uuid references public.profiles(id) on delete set null,
  order_id       uuid references public.orders(id) on delete set null,

  -- Snapshot: a review keeps the name it was written under even after the
  -- account is anonymised, or it would read as if nobody wrote it.
  customer_name  text not null,

  rating         integer not null check (rating between 1 and 5),
  body           text not null default '',

  reply          text,
  replied_at     timestamptz,

  is_reported    boolean not null default false,
  report_reason  text,
  removed_at     timestamptz,
  removed_by     text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists reviews_restaurant_idx on public.reviews (restaurant_id, created_at desc);
create index if not exists reviews_reported_idx   on public.reviews (is_reported) where is_reported;

drop trigger if exists set_updated_at on public.reviews;
create trigger set_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
--  7. Billing — invoices, attempts, payments, webhook events
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  plan_id        uuid references public.subscription_plans(id) on delete set null,

  amount         integer not null check (amount >= 0),
  currency       text    not null default 'XAF',
  status         text    not null default 'unpaid'
                   check (status in ('unpaid','paid','void')),

  period_start   timestamptz not null,
  period_end     timestamptz not null,
  issued_at      timestamptz not null default now(),
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists invoices_restaurant_idx on public.invoices (restaurant_id, issued_at desc);
create index if not exists invoices_unpaid_idx     on public.invoices (status) where status = 'unpaid';

drop trigger if exists set_updated_at on public.invoices;
create trigger set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

create table if not exists public.payment_attempts (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique,
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  restaurant_id   uuid not null references public.restaurants(id) on delete restrict,

  provider        text not null default 'camerpay',
  -- The provider's tracking id. CamerPay calls it replyTo.
  transaction_id  text,
  method          text,
  phone           text,
  amount          integer not null check (amount > 0),

  -- AN UNRECOGNISED PROVIDER STATUS MAPS TO 'pending', NEVER 'succeeded' (§6).
  -- Providers add statuses; defaulting to success gives away product for free.
  status          text not null default 'pending'
                    check (status in ('pending','succeeded','failed','abandoned')),

  raw_response    jsonb,
  settled_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists payment_attempts_invoice_idx on public.payment_attempts (invoice_id);
create index if not exists payment_attempts_txn_idx     on public.payment_attempts (provider, transaction_id);
-- The reconciler's query: attempts stuck pending for more than 5 minutes (§6).
create index if not exists payment_attempts_pending_idx on public.payment_attempts (created_at)
  where status = 'pending';

drop trigger if exists set_updated_at on public.payment_attempts;
create trigger set_updated_at before update on public.payment_attempts
  for each row execute function public.set_updated_at();

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid references public.payment_attempts(id) on delete set null,
  invoice_id   uuid not null references public.invoices(id) on delete restrict,
  amount       integer not null check (amount > 0),
  currency     text    not null default 'XAF',
  method       text,
  provider     text,
  confirmed_by text,                              -- 'webhook' | 'reconciler' | admin email
  created_at   timestamptz not null default now()
);

create index if not exists payments_invoice_idx on public.payments (invoice_id);

-- ── REPLAY SAFETY IS THIS CONSTRAINT (§6 rule 3, §12 hard rule #2) ────────
--
-- Every inbound event inserts against UNIQUE(provider, transaction_id, status).
-- A duplicate collides and is acknowledged without reprocessing.
--
-- Checking "have I seen this?" then inserting is a race that duplicate-credits
-- under retry — and providers retry constantly. The database decides, once.
create table if not exists public.payment_webhook_events (
  id              bigint generated always as identity primary key,
  provider        text not null,
  transaction_id  text not null,
  status          text not null,
  raw_body        text,                           -- stored verbatim, for audit
  signature_valid boolean,                        -- null when unsigned (CamerPay)
  processed       boolean not null default false,
  received_at     timestamptz not null default now(),
  constraint payment_webhook_events_unique unique (provider, transaction_id, status)
);

create index if not exists webhook_events_received_idx on public.payment_webhook_events (received_at desc);


-- ═══════════════════════════════════════════════════════════════════════════
--  8. Refunds
--
--  THEIR OWN ROWS, never an edit to the original payment (§14.5). Mutating the
--  original destroys the record of what was actually collected, and the two
--  numbers then disagree forever.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.refunds (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique,
  payment_id     uuid references public.payments(id) on delete restrict,
  invoice_id     uuid references public.invoices(id) on delete restrict,
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  order_id       uuid references public.orders(id) on delete set null,

  type           text not null default 'refund' check (type in ('refund','chargeback')),
  amount         integer not null check (amount > 0),
  currency       text    not null default 'XAF',
  reason         text    not null,
  status         text    not null default 'pending'
                   check (status in ('pending','completed','rejected')),

  created_by     text not null,                   -- snapshotted admin email
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index if not exists refunds_restaurant_idx on public.refunds (restaurant_id, created_at desc);
create index if not exists refunds_order_idx      on public.refunds (order_id);


-- ═══════════════════════════════════════════════════════════════════════════
--  9. Commission statements
--
--  Two rules that decide every figure (§7):
--    · Only DELIVERED and NON-REFUNDED orders count. Charging commission on a
--      cancelled order is charging for a sale that did not happen.
--    · DELIVERY FEES ARE EXCLUDED. That money is the restaurant's cost, not
--      their revenue.
--
--  commission_rate is SNAPSHOTTED onto the row at generation. If the rate
--  changes next month, last month's statement must not change — the restaurant
--  has already seen it (§12 rule 4).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.commission_statements (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants(id) on delete restrict,

  period_start       timestamptz not null,
  period_end         timestamptz not null,

  order_count        integer not null default 0 check (order_count >= 0),
  gross_sales        integer not null default 0 check (gross_sales >= 0),
  commission_rate    numeric(4,2) not null,       -- frozen at generation
  commission_amount  integer not null default 0 check (commission_amount >= 0),

  -- Regenerating recalculates DRAFTS ONLY and leaves issued/settled alone.
  -- Silently rewriting an issued statement is how you lose a tenant's trust
  -- permanently (§7).
  status             text not null default 'draft'
                       check (status in ('draft','issued','settled','written_off')),

  issued_at          timestamptz,
  settled_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (restaurant_id, period_start, period_end)
);

create index if not exists commission_status_idx on public.commission_statements (status);

drop trigger if exists set_updated_at on public.commission_statements;
create trigger set_updated_at before update on public.commission_statements
  for each row execute function public.set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Plan changes — the upgrade/downgrade trail
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.plan_changes (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  from_plan_id   uuid references public.subscription_plans(id) on delete set null,
  to_plan_id     uuid not null references public.subscription_plans(id) on delete restrict,
  invoice_id     uuid references public.invoices(id) on delete set null,
  changed_by     text,
  effective_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- 11. Row Level Security — deny by default on every table (B.1)
--
--  Only reviews get a public read policy: they appear on restaurant pages.
--  Everything else here is orders, money and operational history, reached
--  exclusively through the server.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.settings               enable row level security;
alter table public.audit_log              enable row level security;
alter table public.notifications          enable row level security;
alter table public.broadcasts             enable row level security;
alter table public.support_messages       enable row level security;
alter table public.orders                 enable row level security;
alter table public.order_items            enable row level security;
alter table public.order_status_history   enable row level security;
alter table public.order_payments         enable row level security;
alter table public.reviews                enable row level security;
alter table public.invoices               enable row level security;
alter table public.payment_attempts       enable row level security;
alter table public.payments               enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.refunds                enable row level security;
alter table public.commission_statements  enable row level security;
alter table public.plan_changes           enable row level security;

drop policy if exists "visible reviews are public" on public.reviews;
create policy "visible reviews are public" on public.reviews
  for select to anon, authenticated
  using (
    removed_at is null
    and exists (
      select 1 from public.restaurants r
      where r.id = reviews.restaurant_id and r.status = 'active'
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 12. Seed — platform settings only
--
--  No fake orders, invoices or commissions. Those must arrive through the real
--  flows, or every figure on the admin dashboard is fiction that looks real.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.settings (key, value, value_type, category, label, description) values
  ('brand_name',           'RestoLink',            'string',  'branding', 'Platform name',        'Shown on every page, tab, email and share card.'),
  ('brand_tagline',        'Commandez vos plats préférés au Cameroun', 'string', 'branding', 'Tagline', null),
  ('brand_logo_url',       '',                     'string',  'branding', 'Logo URL',             null),
  ('brand_favicon_url',    '',                     'string',  'branding', 'Favicon URL',          null),
  ('support_email',        'contact@restolink.cm', 'string',  'branding', 'Support email',        null),

  ('default_currency',     'XAF',                  'string',  'money',    'Default currency',     'Zero-decimal. Amounts are whole francs.'),
  ('service_charge_percent','5',                   'integer', 'money',    'Service charge %',     'Applied to food only, after discount, never to delivery.'),
  ('loyalty_points_per_1000','10',                 'integer', 'money',    'Points per 1000 FCFA', null),
  ('loyalty_point_value',  '1',                    'integer', 'money',    'Value of one point',   'In FCFA.'),

  ('subscription_grace_days','3',                  'integer', 'billing',  'Grace period (days)',  'Mobile money renewal is not instant; locking a tenant out mid-service costs them money and costs you the customer.'),
  ('platform_free_mode',   'false',                'boolean', 'billing',  'Free mode',            'Grants PAID-TIER limits, not Starter. Suspension still overrides it.'),
  ('platform_free_mode_until','',                  'string',  'billing',  'Free mode ends',       null),

  ('payment_provider',     'camerpay',             'string',  'payments', 'Active provider',      null),
  ('payments_enabled',     'false',                'boolean', 'payments', 'Payments enabled',     'Off until the provider is verified end to end.')
on conflict (key) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
-- 13. Verify
-- ═══════════════════════════════════════════════════════════════════════════

-- Expect 23 tables, every one with rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- Expect 0. Any row here is a table exposed to anyone holding the
-- publishable key, which ships in the JavaScript bundle.
select count(*) as tables_without_rls
from pg_tables
where schemaname = 'public' and not rowsecurity;

-- Expect the UNIQUE constraint that makes webhook replay safety structural.
select conname from pg_constraint where conname = 'payment_webhook_events_unique';
