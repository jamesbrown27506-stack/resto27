# RestoLink — 2-Day Build Plan

**Source of truth:** [explanation.md](explanation.md). This document does not restate the spec — it *sequences* it. Every phase below cites the §section it implements. If this doc and `explanation.md` disagree, `explanation.md` wins.

**Target stack (decided, Appendix B):** Next.js App Router + Supabase Postgres + Drizzle + Supabase Auth + Tailwind/shadcn + Zod + Resend.
**Current repo:** bare `create-next-app` — Next 16.2.12, React 19.2.4, Tailwind 4, React Compiler on, TypeScript. Only [layout.tsx](src/app/layout.tsx) and [page.tsx](src/app/page.tsx) exist. The spec says "Next.js 15"; we're on 16 and everything in §13–§17 holds unchanged.

---

## 0. Read this before starting

### The honest scope statement

The spec describes **78 routes, 41 tables, 16 server modules, a live mobile-money gateway, a reconciler, and a data migration off a live MySQL database**. §17 budgets that as 9 phases with "keep the PHP app serving live traffic until phase 3 passes" — i.e. weeks, not days.

Two days is **~24 working hours**. This plan spends them like this:

| | Hours | What you get |
|---|---|---|
| **Day 1** | 12h | Schema, the seven hard rules as passing tests, auth/RBAC, the entire billing + webhook + reconciler stack, and a manager back-office a restaurant can run a service on |
| **Day 2** | 12h | Customer ordering, admin control plane, public site, data migration, hardening |

**What this means in practice:** at the end of Day 1 you have the *valuable* half — the part §1 calls businesses #2 and #3, the part a rewrite usually throws away. At the end of Day 2 you have all 78 routes standing up, but the UI will be functional-not-polished and the test suite will cover the money paths, not everything. Budget a Day 3+ for polish and the real cutover.

**Do not reorder to build the marketplace first.** §17: *"starting there buys months of a prettier product that cannot bill anyone."*

### The cut line

If you are behind at hour 20, ship these and stop:

- **Non-negotiable:** P0 → P7. That is schema, hard-rule tests, auth, billing, webhook, reconciler, manager service ops. Without these there is no product.
- **Ship if possible:** P8, P9, P10, P11, P12 — catalogue management, customer ordering, admin revenue.
- **Droppable to Day 3:** P13 (admin ops extras), P14 (public/SEO), P15 (UX pass), P16/P17 (migration + cutover).

Dropping P16/P17 is safe *because the PHP app keeps serving live traffic*. That is the whole point of the ordering.

### How the phases are sized

Each phase is scoped to be **one coherent generation / one agent session** — a single brief with everything it needs, no mid-phase context switching. Each carries:

- **Actor** — which of §2's five actors it serves
- **Depends on** — hard prerequisites
- **Build** — the concrete deliverables
- **Hard rules** — which of §12's seven this phase is responsible for
- **Done when** — verifiable, not "looks right"

---

## 1. Actors

Straight from §2. These are genuinely distinct, not four flavours of user, and the phase map is organised around them.

| Actor | Lives at | Authenticated as | Scoped to | Phases |
|---|---|---|---|---|
| **Guest** | public pages | nobody | — | P10 (cart), P14 |
| **Customer** | `/account`, `/orders`, … | `role = 'customer'` | themselves | P10, P11 |
| **Restaurant staff** | `/m/*` | `role = 'manager'` **+ a per-branch role** | one branch at a time | P7, P8, P9 |
| **Platform admin** | `/a/*` | `role = 'admin'` | everything | P12, P13 |
| **System operator** | server / cron | — | infrastructure | P0, P1, P6, P16, P17 |
| **Machine** (webhook, scheduler) | `/api/*` | HMAC / bearer token | one endpoint each | P5, P6 |

**The two-level permission model is not optional** (§2). `users.role = 'manager'` means only *"this person works at a restaurant"*. Real permission comes from `restaurant_staff.role` ∈ `owner | manager | kitchen | cashier | waiter`, per branch. P3 builds this; every manager phase depends on it. Flattening it onto the user record hits a wall the first time an owner opens a second location.

---

## 2. Phase map at a glance

| # | Phase | Actor | Est | Depends on |
|---|---|---|---|---|
| **P0** | Project skeleton, env, connections | Operator | 0.5h | — |
| **P1** | 41 tables in Drizzle + RLS lockdown + seed | Operator | 1.5h | P0 |
| **P2** | Platform modules: money, state, audit, notify, settings, storage | — | 1.0h | P1 |
| **P3** | Auth, RBAC, tenant resolution + 7 auth routes | All | 1.5h | P2 |
| **P4** | Subscription lifecycle: expiry, grace, lock, free mode | Staff/Admin | 1.0h | P3 |
| **P5** | Payment provider, idempotent confirm, SebPay webhook | Machine | 1.5h | P4 |
| **P6** | Reconciler, cron triggers, health endpoint | Machine/Operator | 0.75h | P5 |
| **P7** | Manager: shell, orders, kitchen, tickets, table-side | Staff | 1.75h | P3, P4 |
| **P8** | Manager: menu, modifiers, categories, tables, reservations, promotions | Staff | 1.5h | P7 |
| **P9** | Manager: billing pages, staff, customers, reviews, reports, profile | Staff | 1.0h | P5, P7 |
| **P10** | Customer: browse, cart, checkout | Customer/Guest | 1.75h | P8 |
| **P11** | Customer: orders, tracking, reservations, loyalty, account | Customer | 1.5h | P10 |
| **P12** | Admin: tenants, users, subscriptions, plans, payments, commissions, refunds | Admin | 1.75h | P5, P9 |
| **P13** | Admin: broadcast, moderation, analytics, support, audit, areas, impersonation, export, diagnostics | Admin | 1.75h | P12 |
| **P14** | Public site + SEO | Guest | 1.25h | P10 |
| **P15** | Cross-cutting UX: branding, XAF, timezone, dark mode, mobile, FR/EN | All | 0.75h | P14 |
| **P16** | MySQL → Supabase data migration | Operator | 1.5h | P1, P12 |
| **P17** | Hardening, full test sweep, cutover rehearsal | Operator | 1.75h | all |

**Day 1 = P0…P9 (12h). Day 2 = P10…P17 (12h).**

### If more than one person is working

Phases **P0 → P6 are a strict chain** — one person, no parallelism, this is the spine. After P6 lands, these split cleanly:

- **Track A (staff):** P7 → P8 → P9
- **Track B (customer + public):** P10 → P11 → P14
- **Track C (admin):** P12 → P13
- **Track D (operator):** P16 → P17

Track B cannot start before P8 (it needs the menu/modifier data shape). Track C cannot start before P9 (shared billing components). P15 is a sweep by whoever finishes first.

---

# DAY 1 — Foundation and revenue infrastructure

> §17: *"revenue infrastructure before features. The current app already has revenue infrastructure, and losing it is the only way this rewrite actually fails."*

---

## P0 — Project skeleton, environment, connections

**Actor:** System operator · **Est:** 0.5h · **Depends on:** —

### Build

- Install: `drizzle-orm`, `drizzle-kit`, `postgres`, `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `resend`, `date-fns`, `date-fns-tz`, `vitest`.
- Init shadcn/ui on Tailwind 4.
- Folder layout exactly as §13 "Proposed layout": route groups `(public) (auth) (customer) (manager) (admin)`, plus `db/schema`, `db/migrations`, `lib/{auth,billing,commission,orders,payments,audit}`.
- `lib/env.ts` — Zod-validated environment, fails loudly at boot. Keys: `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SEBPAY_*`, `CRON_SECRET`, `RESEND_API_KEY`.
- **The two connection strings (B.5), correct on the first try:**
  - `db/index.ts` → `DATABASE_URL`, port **6543**, Supavisor transaction mode, `postgres(url, { prepare: false })`
  - `drizzle.config.ts` → `DIRECT_URL`, port **5432**, session mode
  - Getting these the wrong way round is *the* classic first-day error, and without `prepare: false` the failure is intermittent and baffling.
- **Base URL derived from the request, never from config** (§11). A stale `APP_URL` fails uniquely confusingly: homepage loads, every link 404s.
- Supabase server/browser clients via `@supabase/ssr`. `SUPABASE_SERVICE_ROLE_KEY` is server-only — **never in a Client Component, never in `NEXT_PUBLIC_*`** (B.1).

### Done when

`npm run build` passes · `drizzle-kit push` connects on 5432 · a runtime route reads through the pooler on 6543 · deleting one env var fails the build with a named error.

---

## P1 — The 41 tables, in Drizzle, with RLS off-by-default closed

**Actor:** System operator · **Est:** 1.5h · **Depends on:** P0

> §17 phase 0. §12: *"Port the schema first — it is the most valuable artifact here and it is stack-neutral."*

### Build

One Drizzle schema file per domain (§3 groupings):

| File | Tables |
|---|---|
| `db/schema/identity.ts` | `profiles`, `restaurant_staff`, `staff_invitations`, `password_resets`, `rate_limits`, `user_preferences` |
| `db/schema/tenants.ts` | `restaurants`, `restaurant_hours`, `restaurant_tables`, `service_areas` |
| `db/schema/menu.ts` | `categories`, `menu_items`, `menu_item_option_groups`, `menu_item_options`, `stock_movements` |
| `db/schema/orders.ts` | `orders`, `order_items`, `order_status_history`, `order_payments`, `cart_items` |
| `db/schema/billing.ts` | `subscription_plans`, `subscriptions`, `invoices`, `payment_attempts`, `payments`, `plan_changes`, `commission_statements`, `refunds`, `payment_webhook_events` |
| `db/schema/growth.ts` | `promotions`, `promotion_redemptions`, `loyalty_transactions`, `reviews`, `favorites` |
| `db/schema/platform.ts` | `settings`, `notifications`, `broadcasts`, `audit_log`, `support_messages`, `customer_addresses`, `reservations` |

**Port rules — §16, applied without exception:**

- `ENUM` → `text` + `CHECK` (not a native enum — adding a value carries migration ceremony you do not want mid-release)
- `TINYINT(1)` → `boolean`
- **Money → `integer` minor units.** XAF is zero-decimal. Whole francs. Keep a `currency` column. The old `DECIMAL(10,2)` carries a `.00` that can never be non-zero.
- `INT UNSIGNED AUTO_INCREMENT` → `integer generated always as identity` + `CHECK (x >= 0)` where it matters
- `ON UPDATE CURRENT_TIMESTAMP` → set in the application (Postgres has no equivalent)
- **All timestamps `timestamptz`, stored UTC, rendered `Africa/Douala`.** The current schema stores naive local time, which breaks the moment you open a second country.
- Restaurant search: `pg_trgm` + GIN on name/description/city/cuisine

**Identity (B.2):** `profiles.id uuid primary key references auth.users(id) on delete cascade`. ~15 of the 41 tables get `uuid` user FKs. **Do it now** — phase 0 rebuilds the schema anyway, and this is the only cheap moment to change an ID type.

**Keep, do not "clean up"** (§16): snapshot columns on `orders`/`order_items`, `commission_statements.commission_rate`, `audit_log.actor_email`/`actor_role`. They look redundant. They are not.

**Constraints that carry business rules into the schema:**

```sql
-- Webhook replay safety. This is a database constraint, not a code check. §6 rule 3.
ALTER TABLE payment_webhook_events
  ADD CONSTRAINT uq_webhook_event UNIQUE (provider, transaction_id, status);

-- Audit log is append-only by design. §14.5.
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
```

**Branches are rows in `restaurants`** (§3), sharing a `user_id`, distinguished by `branch_label`, one flagged `is_primary`. Not a separate table.

**RLS lockdown (B.1) — the step that leaks the whole database if skipped:**

Drizzle creates tables by migration, and **migration-created tables have RLS OFF**. The default outcome of this phase is 41 tables exposed to the internet through the anon key, which is in your JavaScript bundle. Do both:

- **A.** Supabase → Settings → API → Exposed schemas → **remove `public`**. The app talks to Postgres directly via Drizzle and loses nothing.
- **B.** `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` on all 41, no policies. Deny by default; the service role bypasses RLS by design.

Add B as the **last step of every migration that creates a table**, and assert it in CI. A table added in six months is exactly the one that gets forgotten.

**Do not express the capability matrix as RLS policies** (B.1). 20 capabilities × 5 branch roles + lock state + free mode + impersonation is unreadable and untestable as SQL, and duplicated — the app needs the same rules to decide what to render. RLS is the fence; `lib/auth/rbac` is the logic.

**Seed:** 3 subscription plans with limits *in the row* (§14.5 `/a/plans` — today they are hardcoded in PHP), `service_areas` (Douala: XAF, `Africa/Douala`), `settings` defaults (branding, service charge, loyalty rates, grace days = 3, `platform_free_mode`).

### Done when

41 tables exist · `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity` returns **0** · `public` is not in exposed schemas · seed runs idempotently · a `SELECT` with the anon key against `orders` returns nothing.

---

## P2 — Platform modules: the arithmetic, the state machine, the ledgers

**Actor:** cross-cutting · **Est:** 1.0h · **Depends on:** P1

> §15: *"The pages are the easy half. These are where the value is — port them first, with tests, before any UI."* §17 phase 1: **no UI at all.**

### Build

Set up Vitest first, then write these test-first.

| Module | Responsibility | Non-obvious part |
|---|---|---|
| `lib/orders/totals` | **The one money function** | `service_charge = (subtotal − discount) × pct`; `total = (subtotal − discount) + service_charge + delivery_fee − loyalty_value`. Service charge applies to **food only, after discount, never to delivery fee** — that money is the restaurant's cost, not revenue. **Duplicating this arithmetic anywhere else is how the basket, the receipt and the report start disagreeing.** |
| `lib/orders/transitions` | The state machine | `pending → confirmed → preparing → shipped → delivered`, `cancelled` from any non-terminal. Transitions declared in **one table**, validated centrally. Nothing skips or reverses. `delivered`/`cancelled` terminal. |
| `lib/orders/stock` | Decrement on confirm | Writes a `stock_movements` row every time. Audit trail, not a counter. |
| `lib/loyalty` | Append-only ledger | Balance is `SUM(points)`, **never a stored counter**. Positive earns, negative redeems. A stored balance drifts the first time two requests race; a ledger cannot. |
| `lib/promotions` | Validation | Window, minimum order, per-user cap, total cap |
| `lib/settings` | Cached key/value, typed getters | |
| `lib/branding` | Name, tagline, logo, favicon **from settings** | Renaming the platform renames every page, tab, email and share card at once |
| `lib/audit` | Writer | **Snapshots actor email and role onto every row** (actors get anonymised; the trail must survive them). Records impersonator separately from actor. **Never throws** — a failure to write history must not break the operation being recorded. |
| `lib/notify` | In-app rows + optional email | Gated by per-user preference. Resend wired on day one — Supabase's built-in SMTP is rate-limited and not for production. |
| `lib/storage` | Supabase Storage buckets | Public bucket for menu images; private for everything else. **Validate by actual content, never by extension or MIME header** — that is how you get a webshell. |
| `lib/csv` | Export writer | **Prefix any cell starting with `=`, `+`, `-`, `@`** or Excel executes it. UTF-8 BOM so accents read correctly. |

### The seven hard rules, as tests (§12)

Write these now. They are the specification made executable, and they are what the 476 PHP assertions actually encode. Ones marked ⏳ are stubs this phase and get filled by the phase that owns them.

1. ⏳ Subscription expiry with grace, fail-open dates, billing reachable while locked *(P4)*
2. ⏳ Idempotent payment confirmation with database-level replay safety *(P5)*
3. ⏳ Reconciliation for lost webhooks *(P6)*
4. ✅ **Snapshotting** — raising a menu price does not change last week's order; changing the commission rate does not change last month's statement
5. ⏳ Two-level RBAC *(P3)*
6. ⏳ Session invalidation on suspend *(P3)*
7. ✅ **Anonymise, never delete** — no `ON DELETE CASCADE` from `profiles` reaches `orders`

### Done when

`npm test` green · rules 4 and 7 covered by real assertions · 1/2/3/5/6 exist as failing-or-skipped stubs with names · **zero UI files written this phase.**

---

## P3 — Auth, RBAC, tenant resolution, and the 7 auth routes

**Actor:** all · **Est:** 1.5h · **Depends on:** P2

> §17 phase 2: *"A staff member sees exactly their capabilities, nothing more."*

### Build — modules

**`lib/auth/session`** — the guard every protected route goes through:

```ts
// The JWT proves who they are. It does not prove they are still allowed in.
if (profile.status !== 'active' || profile.deleted_at) {
  await supabase.auth.signOut();
  redirect('/login?reason=suspended');
}
```

This closes **the revocation gap** (B.2). PHP revokes instantly via `session_version`. Supabase Auth uses short-lived JWTs — `auth.admin.signOut(userId)` kills refresh tokens but **an already-issued access token stays valid for up to an hour**. Tolerable for moderation; not for fraud response. You are loading the profile every request anyway, so check `status` there. **Port the behaviour, not the mechanism.**

**`lib/auth/rbac`** — the capability matrix, 20 capabilities × 5 branch roles. **Pages check capabilities, never roles** (§9). Adding a role is then a data change, not an edit to every page. Exports `can()` and `requireCapability()`.

Capabilities named in §14.4:

```
orders.view      orders.advance    kitchen.display   menu.view       menu.edit
tables.view      tables.manage     reservations.view reservations.decide
promotions.manage customers.view   reviews.reply     reports.view    staff.manage
billing.manage   profile.edit      settings.manage
```

That is **17**. ⚠️ §9 says 20 — the remaining 3 must be read out of the PHP `functions.php` matrix, not invented. See Open Questions.

**`lib/auth/tenant`** — which branches may this user operate, which is active, and the locked-out check **with its billing exemption** (the `$allowLocked` flag).

### Build — routes (§14.2, all 7)

| Route | The non-obvious part |
|---|---|
| `/login` | **Returns a specific reason**: invalid / pending / pending-manager / suspended. Credentials were already proven correct, so naming the reason leaks nothing — and it is the difference between an applicant waiting patiently and one who thinks you lost their registration. Rate limited. |
| `/register` | Customer → active immediately |
| `/register/restaurant` | User **and** restaurant both `pending`. Admin notified, applicant emailed. |
| `/forgot-password` | **Always reports success**, whether or not the email exists — otherwise it is an account-enumeration oracle |
| `/reset-password/[token]` | Single-use, expiring. **Invalidates all sessions on success.** |
| `/invite/[token]` | Token stored as **sha256**. **The invitee sets their own password** — nobody else ever knows it. An existing account may not be absorbed without consent. |
| `/logout` | Clears session and remember cookie |

Plus: rate limiting on login/register/reset/contact (§9), CSRF on every state-changing form, Zod schema per action shared by form and server.

### Hard rules

**#5 two-level RBAC**, **#6 session invalidation.**

### Done when

A `kitchen`-role user at branch A sees `/m/kitchen` and gets 403 on `/m/staff` · the same human holding `owner` at branch B gets full access there after switching · **a crafted POST to `/m/branch/switch` naming a branch they cannot access is rejected** · suspending a user blocks their *next* request, not their next login · login returns all four distinct reasons.

---

## P4 — Subscription lifecycle: expiry, grace, lock, free mode

**Actor:** Staff / Admin · **Est:** 1.0h · **Depends on:** P3

> §5 — *"the part that leaks money."* The original code selected `WHERE status = 'active'` and **never looked at `end_date`**. Subscriptions that lapsed months ago still read active. Tenants kept every paid feature, were never asked to renew, and nothing showed it was happening.

### Build

`lib/billing/subscription`:

```
now ≤ end_date                    → active
end_date < now ≤ end_date + grace → in grace (full access, renewal banner)
now > end_date + grace            → LOCKED (limits drop to Starter)
```

Grace = 3 days, configurable. It exists because **mobile money renewal is not instant** — locking a restaurant out mid-service over a payment an hour late costs them real money and costs you the customer.

**Three rules that are easy to get wrong:**

- **`end_date = NULL` means "never expires"**, not "expired in 1970"
- **An unparseable date must fail open.** A malformed date is your bug; locking a paying tenant out over it is unacceptable.
- **The billing page stays reachable while locked.** Locking someone out of the only screen that can unlock them is a trap that guarantees they never pay. `$allowLocked` exists purely for this.

**Plan limits read from the plan row**, not hardcoded (§14.5 `/a/plans`):

| | Starter | Professional | Enterprise |
|---|---|---|---|
| Menu items | 20 | 100 | ∞ |
| Tables | 5 | 25 | ∞ |
| Active promotions | 1 | 10 | ∞ |
| Staff management | ✗ | ✓ | ✓ |
| Analytics | ✗ | ✓ | ✓ |
| Commission | 5% | 3% | 2% |

**Free mode:** `platform_free_mode` with optional auto-expiry. Grants **paid-tier limits, not Starter** — the point is removing friction, and a restaurant capped at 20 items is not experiencing the product. **Suspension still overrides free mode.** Free ≠ ungoverned.

### Hard rules

**#1 — leaks revenue silently when wrong.**

### Done when

All of these pass as tests: `end_date NULL` → active forever · `end_date` yesterday → in grace, full access, banner shows · `end_date` 5 days ago → locked, limits are Starter's · **locked tenant can still open `/m/billing`** and nothing else · garbage `end_date` string → active (fail open) · free mode on → Professional limits, not Starter · suspended + free mode → still suspended.

---

## P5 — Payment provider, the single confirm path, the webhook

**Actor:** Machine · **Est:** 1.5h · **Depends on:** P4

> §6. §17 phase 3: *"A real payment on a real handset activates a real plan."*

### Build

**`lib/billing/provider`** — the `PaymentProvider` interface with two drivers:

- `OfflinePaymentProvider` — shows transfer instructions, admin confirms receipt manually
- `SebPayPaymentProvider` — MTN MoMo / Orange Money via `sebpay.bj`

**`lib/payments/sebpay`** — client, phone normalisation, signature verify (**hex and base64, constant-time**), status mapping. **An unrecognised status maps to `pending`, never to success.** Providers add statuses; defaulting to success gives away product for free.

**`lib/billing/confirm` — `billing_confirm_payment()`, the single idempotent activation path.** The webhook calls it. The reconciler calls it. The admin's manual confirmation calls it. **Nothing else may activate a subscription.** This is the most important structural rule in the payment code — the moment there are two paths, they disagree, and the disagreement is money.

Flow: plan change → invoice → payment attempt → provider checkout → *out-of-band confirmation* → plan activates. Attempt + invoice + subscription + plan_change all in one transaction.

**`POST /api/webhooks/sebpay`** — the only unauthenticated write endpoint in the system. Five rules:

1. **HMAC is over the raw request bytes.** In Next.js: `await req.text()` **before** anything parses. `req.json()` destroys the exact bytes the signature covers, and `json_decode`→`json_encode` produces different bytes — usually failing *intermittently*, which is far worse than failing always.
2. **Verify before trusting.** Unsigned or wrongly signed → recorded, discarded, never acted on.
3. **Replay safety comes from the database constraint** built in P1, not check-then-act. Insert against `UNIQUE(provider, transaction_id, status)`; a duplicate collides and is acknowledged without reprocessing. "Have I seen this?" then insert is a race that duplicate-credits under retry — **and providers retry constantly.**
4. **Respond within 5 seconds.** Slow responses cause retries, which is how duplicate processing usually starts. Keep the handler lean.
5. **Re-check the amount.** A valid signature proves the message came from the provider. It does **not** prove it settles the invoice you think it does.

### Hard rules

**#2 — double-credits when wrong.**

### Done when

Firing the same signed webhook 5× credits **once** · re-encoding the body before verifying fails the signature (proves you read raw) · an unknown status string lands `pending` · a webhook whose amount ≠ invoice total is rejected · admin manual confirm and webhook confirm both route through `billing_confirm_payment` — grep proves no second activation path exists · handler p99 under 5s.

---

## P6 — Reconciler, cron triggers, health

**Actor:** Machine / operator · **Est:** 0.75h · **Depends on:** P5

> §6: *"Webhooks get lost — tunnels drop, hosts restart, deploys land mid-delivery. When that happens a customer has been debited while the invoice still reads unpaid, and nothing else in the system will ever notice."* **This is a safety net, not a convenience.**

### Build

**`GET /api/cron/reconcile`** — bearer-token protected. Asks SebPay directly about attempts stuck `pending` for >5 min. Applies **the same rules, through the same `billing_confirm_payment`** — including the amount check. Attempts older than 24h are abandoned. Writes `last_run_at`.

**`GET /api/cron/expire`** — nightly: expire lapsed subscriptions, send renewal reminders, lift free mode when its end date passes.

**`GET /a/health`** — public JSON: database reachable, gateway reachable, **last reconciler run**. For uptime monitoring.

**Scheduling via `pg_cron` + `pg_net` (B.3)** — cron is a **trigger only**; your app does the work:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('sebpay-reconcile', '*/10 * * * *', $$
  select net.http_post(
    url     := <base>||'/api/cron/reconcile',
    headers := jsonb_build_object('Authorization','Bearer '||current_setting('app.cron_secret')));
$$);

-- 02:00 Douala = 01:00 UTC. pg_cron runs UTC.
select cron.schedule('nightly-expire', '0 1 * * *', $$ ... /api/cron/expire ... $$);
```

- **Do not rewrite the reconciler as an Edge Function.** Edge Functions are Deno; your billing logic is in Next.js. Two copies of `billing_confirm_payment` is exactly the two-activation-paths failure §6 warns about.
- **The secret does not belong in the cron SQL** — anyone with database access can read `cron.job`. Vault secret or database setting.
- **`pg_net` is fire-and-forget** and will not tell you the sweep failed. That is why `last_run_at` surfaces on `/a/health`. *A reconciler that silently stopped three weeks ago is worse than no reconciler, because you believe you are covered.*

### Hard rules

**#3.**

### Done when

Kill the webhook, pay for real, wait 10 min → invoice settles anyway · `/a/health` shows a fresh `last_run_at` · an unauthenticated call to `/api/cron/reconcile` 401s · an attempt 25h old is abandoned, not confirmed · a reconciled payment does **not** double-credit one that the webhook already confirmed.

---

## P7 — Manager: shell, orders, kitchen, tickets, table-side

**Actor:** Restaurant staff · **Est:** 1.75h · **Depends on:** P3, P4

> §17 phase 4: *"A restaurant can run a service on it."* This is business #2 from §1 — the operational product, and the reason the rewrite is worth doing.

### Build (§14.4)

**Every page gated twice**: the branch must be one the user may operate, **and** their branch role must hold the capability.

| Route | Capability | Notes |
|---|---|---|
| `/m` | any | Today's orders, revenue, pending reservations, low stock, subscription state |
| `/m/orders` | `orders.view` / `.advance` | **Confirming a delivery order prompts for the delivery fee** and stamps `delivery_fee_set_at` |
| `/m/orders/[id]` | `orders.view` | Detail, status history, items with options, record payment |
| `/m/kitchen` | `kitchen.display` | **Kitchen display.** Confirmed + preparing, oldest first, auto-refreshing, one-tap advance. **High contrast, large type — read from across a kitchen.** |
| `/m/orders/[id]/ticket` | `orders.view` | Printable 80mm thermal ticket, auto-opens print dialog |
| `/m/table-order` | `orders.advance` | **Waiter table-side ordering.** Writes the *same rows* as an online order, so kitchen, tickets, stock, reports and payment all work unchanged. |
| `/m/branch/switch` | any | **Validated against the user's allowed list** — a crafted POST must not select a branch they cannot access |

**The delivery fee is quoted, not calculated** (§4). Orders are placed with `delivery_fee = 0`. The restaurant enters it on confirm, based on where the customer actually is. This reflects how delivery works in Douala — the price depends on the quartier and the courier's judgement, and no distance formula gets it right. The consequence, which is intentional and not an oversight: **the customer commits to a total they have not yet seen.**

**Realtime (B.4)** — publication, not a global switch:

```sql
alter publication supabase_realtime add table public.orders;
```

Kitchen and order tracking subscribe. **Keep a polling fallback.** Realtime tells you when *our own row* changes; if the webhook or the writer is silent, Realtime is as silent as polling was.

### Done when

An order placed by a customer appears on `/m/kitchen` **without a refresh** · confirming a delivery order without entering a fee is impossible · a table-side order produces a kitchen ticket identical in shape to an online one · a `waiter` cannot open `/m/kitchen` unless their matrix row grants it · branch switch to a foreign branch is rejected server-side.

---

## P8 — Manager: menu, modifiers, categories, tables, reservations, promotions

**Actor:** Restaurant staff · **Est:** 1.5h · **Depends on:** P7

### Build (§14.4)

| Route | Capability | Notes |
|---|---|---|
| `/m/menu` | `menu.view` / `.edit` | CRUD, image upload, availability, stock, tags, allergens, **drag-to-reorder** |
| `/m/menu/[id]/modifiers` | `menu.edit` | **Two levels** (§3): a *group* ("Size", "Extras") with `min_select`/`max_select`/`is_required`, containing *options* each with a `price_delta` |
| `/m/categories` | `menu.edit` | Categories, icons, drag-to-reorder |
| `/m/tables` | `tables.view` / `.manage` | Number, capacity, status |
| `/m/reservations` | `reservations.view` / `.decide` | Approve, decline, assign a table, complete |
| `/m/promotions` | `promotions.manage` | Codes, percentage, minimum order, usage caps, date window |

**Plan limits enforced here** (P4): menu items, tables, active promotions. A locked tenant drops to Starter limits — existing rows stay, new ones are refused with a link to `/m/billing`.

`dietary_tags` and `allergens` stay comma-separated strings — **denormalised on purpose**, they are display filters and are never joined on (§3).

Images through `lib/storage`: **validated by actual content**, public bucket, stored outside any executable path.

### Done when

A Starter tenant is refused the 21st menu item with a billing link, and the 20 existing ones still work · a modifier group with `is_required, min 1, max 1` renders as a radio picker · drag-to-reorder persists across reload · uploading a `.php` renamed to `.jpg` is rejected on content.

---

## P9 — Manager: billing, staff, customers, reviews, reports, profile

**Actor:** Restaurant staff · **Est:** 1.0h · **Depends on:** P5, P7

### Build (§14.4)

| Route | Capability | Notes |
|---|---|---|
| `/m/billing` | `billing.manage` | Plan, days remaining, usage vs limits, upgrade/downgrade, invoice history. **Must stay reachable while locked** |
| `/m/billing/invoices/[id]` | `billing.manage` | On screen and as PDF |
| `/m/billing/pay/[id]` | `billing.manage` | **Mobile money.** SebPay has no hosted checkout: ask for the number, start the collection, **then wait**. The payer approves on their handset — **nothing here may assume success** |
| `/api/payments/[ref]/status` | `billing.manage` | Poll target. **Falls back to asking the provider directly** if the webhook is late — a payer already debited must not watch a spinner forever |
| `/m/staff` | `staff.manage` | Invite by email, assign branch role, deactivate. Invitations expire. |
| `/m/customers` | `customers.view` | Who orders here, frequency, spend |
| `/m/reviews` | `reviews.reply` | Read, reply publicly, report abuse |
| `/m/reports` | `reports.view` | Sales over time, top dishes, order mix, peak hours. **Plan-gated** |
| `/m/profile` | `profile.edit` | Restaurant profile, logo, cover, hours, delivery settings |
| `/m/settings` | `settings.manage` | Notification preferences **that actually fire** |

**Realtime on `payment_attempts`** for the waiting page — plus the polling fallback, kept deliberately (B.4): *"Realtime makes the happy path instant; it does nothing for the failure path, and the failure path is the one that costs you a customer."*

Reports are SQL — `GROUP BY`, `SUM`, date ranges. This is why Postgres won (§A.3): *"this app is a reporting app wearing a marketplace costume."*

### Done when

A locked tenant reaches `/m/billing` and nothing else · the waiting page resolves via Realtime, and **also** resolves with Realtime disabled · a Starter tenant sees `/m/reports` gated, not broken · a staff invite email lands and the invitee sets their own password.

---

# DAY 2 — The consumer product, the control plane, and cutover

---

## P10 — Customer: browse, cart, checkout

**Actor:** Customer + Guest · **Est:** 1.75h · **Depends on:** P8

> §17 phase 5: *"A diner can complete an order."*

### Build (§14.3)

| Route | Access | Notes |
|---|---|---|
| `/browse` | C | Signed-in directory with favourite toggles |
| `/browse/[slug]` | C | Menu with **option pickers**, add to cart, stock and availability respected |
| `/cart` | **A** | Line items with options, quantity, promo code, loyalty redemption, live totals |
| `/checkout` | C | Delivery or pickup, address picker or new address, scheduling, payment method, notes |

**Guests have a cart** (§2). It lives in the session and **merges into the account on sign-in**. This is deliberate — *forcing registration before someone can see a total is the single biggest drop-off point in food ordering.*

**`options_hash` on `cart_items`** (§3) is a fingerprint of the chosen options, so "Pizza, large, extra cheese" and "Pizza, small" are two lines rather than quantity 2 of one line.

**The order snapshots everything** (§3) — this is hard rule #4 and the most tempting thing to "clean up":

- Delivery name, phone, address, quartier, landmark **copied onto the order**, not referenced from `customer_addresses`
- Item price and chosen options **copied onto `order_items`** (`unit_price`, `options_json`, `options_label`), not referenced from `menu_items`

If the restaurant raises a price tomorrow, last week's order must not change. **A normalised design with foreign keys here is a correctness bug, not a cleaner schema.**

**Delivery fee shows as "quoted on confirmation", not zero** (§14.3). Never render `0 FCFA` — that is a promise you are about to break.

All totals through `lib/orders/totals`. No arithmetic in a component.

Payment: `cash_on_delivery` or `pay_at_restaurant` only (§6). Online order payment is modelled in `order_payments` but not wired to a gateway.

### Done when

A guest builds a cart, signs in, and the cart is intact · two variants of the same dish are two cart lines · a promo code + loyalty redemption produce a total that matches `lib/orders/totals` exactly · checkout shows "quoted on confirmation" · **raising a dish price after ordering does not change the placed order** · ordering an out-of-stock item is refused.

---

## P11 — Customer: orders, tracking, reservations, loyalty, account

**Actor:** Customer · **Est:** 1.5h · **Depends on:** P10

### Build (§14.3)

| Route | Notes |
|---|---|
| `/account` | Recent orders, upcoming reservations, loyalty balance, favourites |
| `/orders` | History with status filters |
| `/orders/[id]` | **The busiest page in the app**: receipt, **live status timeline**, cancel while allowed, reorder, write a review, read the manager's reply, rate the delivery |
| `/api/orders/[id]/status` | Poll target. **Tiny by design** — reload only when something changed |
| `/reservations` | Book (date, time, guests, availability check via Server Action), list, cancel |
| `/favorites` | Saved restaurants |
| `/addresses` | Address book with a default. **Editing an address never rewrites a past order** |
| `/loyalty` | Balance and full ledger, **each entry traceable to its order** |
| `/reviews` | Own reviews, edit, delete |
| `/profile` | Name, phone, avatar, password |
| `/settings` | Notification preferences, theme, **account deletion → anonymise, never delete** |

**Account deletion** is hard rule #7. `deleted_at` marks anonymisation: identity fields overwritten, every other row stands. Deleting a user with orders would destroy the restaurant's sales history and the platform's commission record.

Order tracking subscribes to Realtime on `orders`, with `/api/orders/[id]/status` as the fallback. Keep both (B.8).

### Done when

The timeline advances without a refresh when the kitchen taps advance · cancel is offered only in non-terminal states and refused server-side otherwise · **editing a saved address leaves an existing order's delivery snapshot untouched** · deleting an account anonymises and leaves orders + commission intact · the loyalty balance equals `SUM(points)` of the visible ledger.

---

## P12 — Admin: tenants, users, subscriptions, plans, payments, commissions, refunds

**Actor:** Platform admin · **Est:** 1.75h · **Depends on:** P5, P9

> §17 phase 6: *"You can run the business."* This is business #3 from §1.

### Build (§14.5)

| Route | Notes |
|---|---|
| `/a` | Platform KPIs, pending approvals, reported reviews, expiring subscriptions |
| `/a/restaurants` | Approve, reject, suspend, reinstate. Approval **emails the applicant** |
| `/a/users` | Suspend (revokes sessions), anonymise, **create other administrators** — typed confirmation, password complexity, **all other admins notified**, audited distinctly |
| `/a/subscriptions` | Every tenant subscription, plan, expiry, manual extension |
| `/a/plans` | **NEW — plan builder.** Price, limits, commission, features, active flag. Today the limits are hardcoded in PHP; they live in the row now (P1/P4) |
| `/a/payments` | Payment attempts. **Manual confirmation calls the same idempotent handler the webhook calls** |
| `/a/commissions` | Generate a period, review per restaurant, issue, settle, write off. Every transition audited |
| `/a/refunds` | Refunds and chargebacks as **their own rows** — never by editing the original payment |

**`lib/commission`** (§7), separate from subscriptions:

- **Only `delivered`, non-refunded orders count.** Charging commission on a cancelled order is charging for a sale that did not happen.
- **Delivery fees excluded** — that money is the restaurant's cost, not their revenue.
- **The rate is snapshotted onto the statement** when generated. If the rate changes next month, last month's statement must not change — the restaurant has already seen it.
- `draft → issued → settled | written_off`. Regenerating recalculates **drafts only** and leaves issued/settled alone. *Silently rewriting an issued statement is how you lose a tenant's trust permanently.*

The core query is one `SELECT` (§A.2) — this is exactly what Postgres bought you.

### Done when

Approving a pending restaurant emails the applicant and makes it publicly visible · suspending a user blocks their next request · creating an admin requires typed confirmation and notifies every other admin · **regenerating a period leaves an issued statement byte-identical** · changing the commission rate does not alter a statement already issued · a refund creates a row and leaves the original payment untouched · a commission run excludes cancelled orders and delivery fees.

---

## P13 — Admin: broadcast, moderation, analytics, support, audit, areas, impersonation, export, diagnostics

**Actor:** Platform admin · **Est:** 1.75h · **Depends on:** P12

### Build (§14.5)

| Route | Notes |
|---|---|
| `/a/broadcast` | One message to an audience (all managers, all customers, a plan, an area), in-app + optional email |
| `/a/reviews` | Moderate flagged reviews: dismiss the report, or remove. **No editing** — rewriting someone's words under their name is worse than either outcome |
| `/a/analytics` | Growth, revenue, order volume, top tenants |
| `/a/support` | Inbox from the contact form, reply, resolve |
| `/a/notifications` | The admin's own notifications |
| `/a/audit` | **Read-only by design.** No delete action, no write path except the audit writer itself |
| `/a/areas` | Service areas — city, currency, timezone, accepting signups. Douala only today |
| `/a/impersonate` | Become a tenant briefly. **Loud undismissable banner**; start and stop both audited; **the log records the impersonator separately from the actor** — otherwise the trail shows the tenant doing things they never did |
| `/a/export` | 8 CSV reports. **Escape leading `=` `+` `-` `@`** or Excel executes the cell. UTF-8 BOM |
| `/a/diagnostics` | **Actively exercise the system** — ping the gateway, fire a signed webhook at your own endpoint, send a real email |
| `/a/tests` | Passive health: schema present, settings sane, gateway configured |
| `/a/settings` | Branding, free mode, currency, service charge, loyalty rates, commission rates, payment toggles, grace days |

### Done when

Impersonation shows an undismissable banner, and the audit rows name both impersonator and actor · a CSV cell `=1+1` exports as text and opens inert in Excel, with accents intact · `/a/audit` has no mutation path, and `REVOKE` from P1 proves it at the database · `/a/diagnostics` fires a genuinely signed webhook that the P5 handler accepts · changing the brand name in `/a/settings` renames every page, tab and email.

---

## P14 — Public site and SEO

**Actor:** Guest · **Est:** 1.25h · **Depends on:** P10

> §17 phase 7: *"Google can find it."* Deliberately near-last: it is the easy part.

### Build (§14.1, all 9)

| Route | Notes |
|---|---|
| `/` | Hero with **working** search (query + city → `/restaurants`), featured restaurants, popular dishes, pricing summary, contact. Canonical + OG/Twitter tags, `WebSite` + `Organization` JSON-LD with `areaServed: Cameroon` |
| `/restaurants` | Directory. Filters: text, city, cuisine, sort by rating. Active only |
| `/restaurants/[slug]` | Profile, menu by category, hours, reviews, order + book CTAs. `Restaurant` JSON-LD |
| `/pricing` | **Rendered from the plans table, not hardcoded** — advertised limits must equal enforced limits |
| `/contact` | → `support_messages`. CSRF, honeypot, per-IP rate limit |
| `/privacy`, `/terms` | Brand name from settings, never hardcoded |
| `/robots.txt` | Generated, real host, private areas disallowed |
| `/sitemap.xml` | Generated. Lists every active restaurant, **live** |

**The one thing to get right** (§10): the old homepage is a **3,959-line self-contained file** with its own `<head>` and inline stylesheet, not using the shared header. The spec calls it *"the single worst structural decision in the codebase"* — it has already caused branding not applying, missing SEO tags, and a mobile drawer collapsing to a sliver. **Build `/` from the same shared components as every other page. Do not recreate it.**

### Done when

`/` uses the shared layout — grep finds no second `<head>` · homepage search reaches `/restaurants` with filters applied · `/pricing` changes when a plan row changes · `robots.txt` and `sitemap.xml` carry the request-derived host, not a config string · a newly approved restaurant appears in the sitemap without a deploy.

---

## P15 — Cross-cutting UX pass

**Actor:** all · **Est:** 0.75h · **Depends on:** P14

### Build

- **Branding centralised** (§9) — name, tagline, logo, favicon from settings, everywhere including emails and share cards
- **XAF formatting** — integer minor units in, `12 500 FCFA` out. **No decimals anywhere.** One formatter.
- **Timezone** — `timestamptz` in, `Africa/Douala` out. One renderer.
- Dark mode from `user_preferences`; responsive at 768px (§10)
- Empty states, loading states, error boundaries on every route group
- **FR/EN** — see Open Questions; if unresolved, ship FR-first strings through a single dictionary so it is a data change later, not a refactor

### Done when

No hardcoded brand string survives a grep · no `.00` renders anywhere · a timestamp written at 23:30 Douala shows as 23:30, not 22:30 · every route group has a loading and an error boundary.

---

## P16 — MySQL → Supabase data migration

**Actor:** System operator · **Est:** 1.5h · **Depends on:** P1, P12

> B.6: *"You have real rows — 3 restaurants, 8 users, orders, subscriptions, notifications. They must survive."*

### Build

1. **Schema first, data second.** All 41 tables already exist from P1. **Do not let an import tool infer types** — it will guess `text` for money and `timestamp` for `timestamptz`.
2. **Users are the hard part.** Supabase Auth owns `auth.users` and passwords are bcrypt in MySQL. The Admin API **can** accept bcrypt hashes on import, so existing passwords keep working — **verify with two test accounts before migrating the rest.**
3. **Map integer IDs to UUIDs once**, into a temporary `id_map` table, then rewrite every foreign key from it. **Do not generate UUIDs twice.**
4. **Reconcile by counting.** Row counts per table, plus `SUM(total_amount)` on orders and `SUM(amount)` on payments. **If the money does not match to the franc, stop.**
5. **Freeze writes during cutover.** PHP app read-only first. *An order placed mid-migration is an order that vanishes.*

### Done when

Two test accounts log in with their **old** passwords · row counts match per table · order and payment sums match **to the franc** · no orphaned foreign key · `id_map` retained for forensics, not dropped.

---

## P17 — Hardening, full test sweep, cutover rehearsal

**Actor:** System operator · **Est:** 1.75h · **Depends on:** everything

> §11: *"Test coverage today: 476 assertions across 15 suites… **This is the asset most at risk in a rewrite.** They will not port, but the cases they encode are the specification."*

### Build

**Port the *cases*, not the code.** The 15 PHP suites cover RBAC, tenant locking, expiry, commissions, the payment gateway, branding, free mode, admin operations and base-URL detection. Walk each suite and assert the same behaviour in Vitest. This is the highest-value hour on Day 2 — it is what tells you the rewrite is actually equivalent.

**Security sweep (§9):**

- CSRF / origin check on every state-changing action
- Rate limiting live on login, registration, password reset, contact
- Uploads validated by content, outside the executable path
- **RLS assertion in CI** — a query listing any `public` table with `rowsecurity = false` fails the build
- `SUPABASE_SERVICE_ROLE_KEY` grep-verified absent from any client bundle

**Cutover rehearsal (§17 phase 8):**

1. PHP app to read-only
2. Run P16 against production data
3. Reconcile counts and sums
4. Point DNS
5. **Watch both for a week**

**Do not skip B.7:** Supabase pauses free projects after **7 days without activity**, and unpausing is manual. A live product never trips this; a staging project does. *Do not discover this the morning of a demo.*

### Done when

All seven §12 hard rules have passing tests · the RLS assertion runs in CI and fails when a table is added without it · a full order → kitchen → delivered → commission → statement path passes end to end on migrated data · the cutover has been rehearsed at least once against a copy.

---

## 3. The seven hard rules — ownership map

§12 ranks these by how expensive they are to get wrong. Every one reappears identically in Next.js — **a rewrite does not get them for free.** If a phase below slips, its rule slips with it.

| # | Rule | Cost of getting it wrong | Owner | Test lives in |
|---|---|---|---|---|
| 1 | Subscription expiry, grace, fail-open dates, billing reachable while locked | Leaks revenue **silently** | **P4** | P4 |
| 2 | Idempotent payment confirmation, DB-level replay safety | **Double-credits** | **P5** | P5 |
| 3 | Reconciliation for lost webhooks | Customers pay and get nothing | **P6** | P6 |
| 4 | Snapshotting — order prices, commission rates, audit actors | **History rewrites itself** | **P2, P10, P12** | P2, P10, P12 |
| 5 | Two-level RBAC (user role + per-branch role) | Wall at the second location | **P3** | P3 |
| 6 | Session invalidation on suspend | **Suspension does nothing** | **P3** | P3 |
| 7 | Anonymise, never delete | Cascades destroy financial history | **P1, P11** | P2, P11 |

---

## 4. Open questions — answer before P3

These block real work. Everything else can proceed on assumptions.

| # | Question | Blocks | Assumption if unanswered |
|---|---|---|---|
| 1 | **The 3 unnamed capabilities.** §9 says 20; §14.4 names 17. Read them out of PHP `functions.php` — **do not invent them**, or a role silently gains or loses access | P3 | Ship 17, leave the matrix open for extension |
| 2 | **SebPay credentials + a test handset.** §17 phase 3 is only done when *"a real payment on a real handset activates a real plan"* | P5, P6 | Build against `OfflinePaymentProvider`; SebPay verified Day 3 |
| 3 | **Production MySQL dump** — available, and can the PHP app go read-only for the cutover window? | P16 | Migration rehearsed on a stale copy only |
| 4 | **Team size.** Drives whether the Day 2 tracks run in parallel | scheduling | Solo; strictly sequential |
| 5 | **FR / EN / both.** Retrofitting i18n costs more than building with it | P15 | FR-first, strings behind one dictionary |
| 6 | **Domain + Resend sending domain.** Auth and approval emails need it on day one | P3 | Resend test domain; real one before cutover |
| 7 | **Supabase project tier.** B.7 — free projects pause after 7 idle days, and unpausing is manual | P0 | Free for build, paid before cutover |

---

## 5. Rules that are easy to lose in a fast build

A checklist, not new information — every line is a §reference. These are the ones that get dropped when someone is moving quickly, and each one costs money or trust.

- [ ] **RLS on all 41 tables**, `public` removed from exposed schemas *(B.1 — the most common Supabase leak)*
- [ ] **`prepare: false`** on the runtime client; 6543 runtime / 5432 migrations *(B.5)*
- [ ] **Money is `integer` XAF.** No decimals, ever *(§13)*
- [ ] **One money function.** Grep for arithmetic anywhere else *(§4)*
- [ ] **One activation path.** Grep for a second one *(§6)*
- [ ] **Raw body before parsing** in the webhook *(§6 rule 1)*
- [ ] **Unknown provider status → `pending`**, never success *(§6)*
- [ ] **Re-check the amount** on every confirmation *(§6 rule 5)*
- [ ] **`end_date NULL` = never expires.** Malformed date = **fail open** *(§5)*
- [ ] **Billing page reachable while locked** *(§5)*
- [ ] **Free mode grants paid-tier limits**, not Starter. Suspension still overrides *(§5)*
- [ ] **Commission excludes delivery fees and cancelled orders**; rate snapshotted; issued statements immutable *(§7)*
- [ ] **Orders snapshot price, options and address.** No FKs to live data *(§3)*
- [ ] **Loyalty is a ledger.** `SUM(points)`, never a stored balance *(§3)*
- [ ] **Audit log never throws**, snapshots actor email + role, records impersonator separately *(§9)*
- [ ] **CSV: escape `=` `+` `-` `@`, UTF-8 BOM** *(§9)*
- [ ] **Uploads validated by content**, stored outside the executable path *(§9)*
- [ ] **Base URL derived from the request** *(§11)*
- [ ] **Login names the specific failure reason** *(§14.2)*
- [ ] **Forgot-password always reports success** *(§14.2)*
- [ ] **Branch switch validated server-side** against the allowed list *(§14.4)*
- [ ] **Guest cart merges on sign-in** *(§2)*
- [ ] **Delivery fee shows "quoted on confirmation", never `0`** *(§14.3)*
- [ ] **Keep both polling fallbacks** even with Realtime on *(B.4)*
- [ ] **`/` built from shared components** — no second `<head>` *(§10)*
- [ ] **Anonymise, never cascade-delete** *(§12)*

---

## 6. Success criteria, restated as §17 states them

The plan is complete when each of these is true — not when the routes exist.

| §17 Phase | This plan | Done when |
|---|---|---|
| 0 | P1 | Row counts match the old database |
| 1 | P2 | Tests pass. **The specification made executable** |
| 2 | P3 | A staff member sees exactly their capabilities, nothing more |
| 3 | P4–P6 | **A real payment on a real handset activates a real plan** |
| 4 | P7–P9 | **A restaurant can run a service on it** |
| 5 | P10–P11 | A diner can complete an order |
| 6 | P12–P13 | You can run the business |
| 7 | P14–P15 | Google can find it |
| 8 | P16–P17 | Old app read-only, DNS moved, both watched for a week |

**Keep the PHP app serving live traffic until P6 passes.** That is not caution — it is what makes an aggressive two-day schedule safe to attempt at all.
