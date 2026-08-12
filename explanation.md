
# RestoLink — What This System Actually Is

**Purpose of this document:** you are considering rebuilding on a different stack. This describes the system as *behaviour and data*, not as PHP, so it can be rebuilt in anything. Where a decision was hard-won — where the obvious implementation is wrong — that is called out, because those are the parts a rewrite silently loses.

Read §1 and §12 first. §2–§11 are reference.

---

## 1. What it is in one paragraph

A **multi-tenant restaurant SaaS for Cameroon**. Restaurants sign up, get a public listing, and manage their menu, orders, tables, reservations, staff and promotions. Diners browse restaurants, order food for delivery or pickup, book tables, earn loyalty points and leave reviews. The platform charges restaurants a **monthly subscription** (Starter / Professional / Enterprise) paid by **mobile money**, plus a **commission** on order value. A platform administrator oversees every tenant: approvals, suspensions, billing, refunds, commissions, broadcasts and a full audit trail.

**Three separate businesses live in one codebase:**

1. **A marketplace** — diners find restaurants and order (the consumer product)
2. **A restaurant back-office** — orders, kitchen, tables, staff, stock (the operational product)
3. **A subscription business** — plans, invoices, dunning, commission, refunds (the revenue product)

Most food-delivery clones are only #1. The value here is #2 and #3, and they are where nearly all the non-obvious logic sits. **A rewrite that only reproduces #1 has thrown away most of the work.**

**Current scale:** ~29,700 lines of PHP across 96 files, 41 database tables, 2,800 lines of CSS, 318 lines of shared JS. Three runtime dependencies (phpdotenv, PHPMailer, a vendored FPDF).

---

## 2. The actors

Five, and they are genuinely distinct — not four flavours of "user".

| Actor                      | Where they live | Authenticated as            | Scoped to               |
| -------------------------- | --------------- | --------------------------- | ----------------------- |
| **Guest**            | public pages    | nobody                      | —                      |
| **Customer**         | `/customer/*` | `users.role = 'customer'` | themselves              |
| **Restaurant staff** | `/manager/*`  | `users.role = 'manager'`  | one*branch* at a time |
| **Platform admin**   | `/admin/*`    | `users.role = 'admin'`    | everything              |
| **System operator**  | server          | —                          | infrastructure          |

The subtlety is **restaurant staff**. `users.role` is only `'manager'` — it says *"this person works at a restaurant"*, nothing more. Their actual permission comes from a **second, per-restaurant role** in `restaurant_staff.role`: `owner | manager | kitchen | cashier | waiter`.

That two-level model exists because one person can hold different roles at different branches. A rewrite that flattens permission onto the user record cannot express this, and will hit a wall the first time an owner opens a second location.

**Guests have a shopping cart.** It lives in the session and merges into the account on sign-in. This is deliberate — forcing registration before someone can see a total is the single biggest drop-off point in food ordering.

---

## 3. Data model

41 tables. Grouped by what they are *for*, since that is what a rewrite needs.

### Identity and access

| Table                 | Carries                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `users`             | name, email, password hash, phone, role, status,`deleted_at`, **`session_version`** |
| `restaurant_staff`  | user ↔ restaurant ↔ per-branch role                                                         |
| `staff_invitations` | email invite,**sha256 of the token**, expiry, status                                    |
| `password_resets`   | email, token, expiry,`used`                                                                 |
| `rate_limits`       | key + IP + timestamp                                                                          |
| `user_preferences`  | per-user key/value (dark mode, email opt-ins)                                                 |

**`session_version`** is an integer on the user. It is copied into the session at login and compared on every request. Bumping it invalidates every existing session for that user instantly — used on suspend, on password change, on role change. Without it, suspending an account does nothing until the person happens to log out. **This is the single most important column in the auth model and it is trivial to forget.**

**`deleted_at`** marks anonymisation, not deletion. Deleting a user with orders would destroy the restaurant's sales history and the platform's commission record. Instead the identity fields are overwritten and the rows stay. Any rewrite that uses `ON DELETE CASCADE` from `users` will silently destroy financial history.

### Tenants

| Table                 | Carries                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `restaurants`       | profile, slug, status (`active/pending/suspended`), rating, delivery settings, **`branch_label`**, **`is_primary`**, `service_area_id` |
| `restaurant_hours`  | opening hours per weekday                                                                                                                                  |
| `restaurant_tables` | table number, capacity, status                                                                                                                             |
| `service_areas`     | city, country, currency, timezone, accepting-signups flag                                                                                                  |

**Branches are rows in `restaurants`, not a separate table.** A restaurant with three locations is three rows sharing a `user_id`, distinguished by `branch_label`, one flagged `is_primary`. Everything downstream — menu, orders, staff, subscription — hangs off a branch, which is what you want: branches genuinely have different menus and different staff.

### Menu

`categories` → `menu_items` → `menu_item_option_groups` → `menu_item_options`

Options are two levels: a **group** ("Size", "Extras") with `min_select`/`max_select`/`is_required`, containing **options** each with a `price_delta`. Stock lives on the item (`track_stock`, `stock_quantity`, `low_stock_threshold`) with an audit trail in `stock_movements`.

`dietary_tags` and `allergens` are comma-separated strings. Denormalised on purpose — they are display filters, never joined on.

### Orders

| Table                    | Carries                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `orders`               | 40 columns — money, status, delivery address snapshot, payment, cancellation, delivery rating |
| `order_items`          | quantity,**`unit_price`**, **`options_json`**, **`options_label`**     |
| `order_status_history` | every transition, who and when                                                                 |
| `order_payments`       | amount, method, who collected it                                                               |
| `cart_items`           | pre-order basket with`options_hash`                                                          |

**The order snapshots everything.** Delivery name, phone, address, quartier, landmark are copied onto the order — not referenced from `customer_addresses`. Item price and chosen options are copied onto `order_items` — not referenced from `menu_items`. If the restaurant raises a price tomorrow, last week's order must not change. **A normalised design with foreign keys here is a correctness bug, not a cleaner schema.**

`options_hash` on `cart_items` is a fingerprint of the chosen options, so "Pizza, large, extra cheese" and "Pizza, small" are two lines in the basket rather than quantity 2 of one line.

### Money — restaurant → platform

`subscription_plans` → `subscriptions` → `invoices` → `payment_attempts` → `payments`
plus `plan_changes`, `commission_statements`, `refunds`, `payment_webhook_events`

### Money — customer → restaurant

`promotions`, `promotion_redemptions`, `loyalty_transactions`

Loyalty is an **append-only ledger**. Balance is `SUM(points)`, never a stored counter. Positive earns, negative redeems. A stored balance drifts the first time two requests race; a ledger cannot.

### Platform operations

`settings` (key/value), `notifications`, `broadcasts`, `audit_log`, `support_messages`, `favorites`, `reviews`, `customer_addresses`, `reservations`

---

## 4. The order lifecycle

```
pending → confirmed → preparing → shipped → delivered
   ↓          ↓           ↓          ↓
        cancelled (from any non-terminal state)
```

Transitions are declared in one table and validated centrally — nothing may skip a state or move backwards. `delivered` and `cancelled` are terminal.

**The delivery fee is quoted, not calculated.** An order is placed with `delivery_fee = 0`. When the restaurant confirms it, *they* enter the fee based on where the customer actually is, and `delivery_fee_set_at` is stamped. This reflects how delivery really works in Douala — the price depends on the quartier and the courier's judgement, and no distance formula gets it right.

The consequence: **the customer commits to a total they have not yet seen.** That is a genuine product risk and a rewrite might choose differently, but the current behaviour is intentional, not an oversight.

**Money is computed in exactly one function:**

```
service_charge = (subtotal − discount) × service_charge_percent
total          = (subtotal − discount) + service_charge + delivery_fee − loyalty_value
```

The service charge applies to food only, after discount, never to the delivery fee (that money is the restaurant's cost, not revenue). Duplicating this arithmetic anywhere else is how totals start disagreeing between the basket, the receipt and the report.

---

## 5. Subscriptions, and the part that leaks money

Three plans. Limits are enforced in code, not read from the database:

|                   | Starter | Professional | Enterprise |
| ----------------- | ------- | ------------ | ---------- |
| Menu items        | 20      | 100          | ∞         |
| Tables            | 5       | 25           | ∞         |
| Active promotions | 1       | 10           | ∞         |
| Staff management  | ✗      | ✓           | ✓         |
| Analytics         | ✗      | ✓           | ✓         |
| Commission        | 5%      | 3%           | 2%         |

### Expiry — the bug worth knowing about

The original code selected `WHERE status = 'active'` and **never looked at `end_date`**. A subscription that lapsed months ago still read as active. Tenants kept every paid feature, were never asked to renew, and nothing anywhere showed it was happening. Revenue leaked silently.

Correct behaviour, and what a rewrite must reproduce:

```
now ≤ end_date                    → active
end_date < now ≤ end_date+grace   → in grace (full access, renewal banner)
now > end_date + grace            → LOCKED (limits drop to Starter)
```

Grace is 3 days, configurable. It exists because **mobile money renewal is not instant** — locking a restaurant out mid-service over a payment an hour late costs them real money and costs you the customer.

Three rules that are easy to get wrong:

- **`end_date = NULL` means "never expires"**, not "expired in 1970". Free/lifetime plans have no end date.
- **An unparseable date must fail open.** A malformed date is your bug; locking a paying tenant out because of it is unacceptable.
- **The billing page must stay reachable while locked.** Locking someone out of the only screen that can unlock them is a trap that also guarantees they never pay. A `$allowLocked` flag exists purely for this.

### Free mode

A platform-wide switch (`platform_free_mode`) makes everything free while the product is unknown, with an optional auto-expiry date. Critically, free mode grants **paid-tier limits**, not Starter limits — the point is to remove friction, and a restaurant capped at 20 menu items is not experiencing the product.

Suspension still overrides free mode. Free ≠ ungoverned.

---

## 6. Payments

### Restaurant → platform (subscriptions)

Behind a `PaymentProvider` interface with two implementations:

- **`OfflinePaymentProvider`** — shows transfer instructions, an admin confirms receipt manually
- **`SebPayPaymentProvider`** — real mobile money (MTN MoMo, Orange Money) via `sebpay.bj`

**Flow:** plan change → invoice → payment attempt → provider checkout → *out-of-band confirmation* → plan activates.

`billing_confirm_payment()` is the **single, idempotent activation path**. The webhook calls it. The reconciler calls it. The admin's manual confirmation calls it. Nothing else may activate a subscription. This is the most important structural rule in the payment code — the moment there are two paths, they disagree, and the disagreement is money.

### Webhook security — five non-obvious rules

The webhook is the only unauthenticated write endpoint in the system.

1. **The HMAC is over the raw request bytes.** Read the body before anything parses it, and never re-encode. `json_decode` then `json_encode` produces different bytes and the signature fails — usually intermittently, which is far worse than failing always.
2. **Verify before trusting.** An unsigned or wrongly signed event is recorded and discarded, never acted on.
3. **Replay safety comes from a database constraint**, not from a check-then-act. Every event inserts against `UNIQUE(provider, transaction_id, status)`; a duplicate collides and is acknowledged without reprocessing. Checking "have I seen this?" then inserting is a race that duplicate-credits under retry — and providers retry constantly.
4. **Respond within 5 seconds.** Slow responses cause retries, which is how duplicate processing usually starts.
5. **Re-check the amount.** A valid signature proves the message came from the provider. It does not prove it settles the invoice you think it does.

One more, across the whole gateway: **an unrecognised status maps to `pending`, never to success.** Providers add statuses. Defaulting to success gives away product for free.

### The reconciler

Webhooks get lost — tunnels drop, hosts restart, deploys land mid-delivery. When that happens a customer has been debited while the invoice still reads unpaid, and *nothing else in the system will ever notice*, because the only thing that would have noticed was the webhook.

A scheduled sweep (every 10 min) asks the provider directly about attempts stuck in `pending` for more than 5 minutes, and applies the same rules — including the amount check. Attempts older than 24h are abandoned. **This is a safety net, not a convenience.** Any rewrite needs it.

### Customer → restaurant (orders)

Currently `cash_on_delivery` or `pay_at_restaurant` only. Online order payment is modelled in `order_payments` but not wired to a gateway.

---

## 7. Commission

Separate from subscriptions. The platform takes a percentage of order value by plan tier.

Two rules that matter:

- **Only `delivered` and non-refunded orders count.** Charging commission on a cancelled order is charging for a sale that did not happen.
- **Delivery fees are excluded.** That money is the restaurant's cost, not their revenue.

The commission rate is **snapshotted onto the statement** when it is generated. If the rate changes next month, last month's statement must not change — the restaurant has already seen it.

Statements go `draft → issued → settled | written_off`. Regenerating recalculates drafts and leaves issued/settled alone. Silently rewriting an issued statement is how you lose a tenant's trust permanently.

---

## 8. What each area does

### Public (`/`, `/public/*`)

Homepage with hero search, restaurant directory with filters, restaurant detail with menu and reviews, pricing, contact, privacy, terms. Generated `robots.txt` and `sitemap.xml` (the sitemap lists every active restaurant, live).

### Auth (`/auth/*`)

Login, customer registration, restaurant registration (creates a **pending** restaurant awaiting admin approval), password reset, staff invitation acceptance.

Login returns a **specific reason** on failure — invalid / pending / pending-manager / suspended. The credentials were already proven correct, so naming the reason leaks nothing, and it is the difference between an applicant waiting patiently and one who thinks you lost their registration.

### Customer (`/customer/*` — 14 pages)

Dashboard, restaurant browse and detail, cart and checkout, order list, single order (receipt, live status timeline, cancel, reorder, review, delivery rating), reservations, favourites, saved addresses, loyalty, reviews, profile, settings.

### Manager (`/manager/*` — 23 pages)

Dashboard, orders, **kitchen display**, in-house table ordering, menu, modifiers, categories, tables, reservations, promotions, staff, customers, reviews, reports, subscription, invoices and payment, branch switcher, printable tickets, profile, settings.

Every page is gated twice: by branch (`require_restaurant()`) and by capability (`require_capability()`).

### Admin (`/admin/*` — 19 pages)

Dashboard, restaurants (approve / suspend), users (including **creating other administrators**), subscriptions, payments, commissions, refunds and chargebacks, broadcasts, review moderation, analytics, notifications, support inbox, **audit log**, service areas, **impersonation**, diagnostics, tests, CSV export (8 reports), settings.

**Impersonation** lets an admin view the platform as a tenant, with a loud undismissable banner and both start and stop written to the audit log. The audit log records the impersonator separately from the actor — otherwise the trail shows the tenant doing things they never did.

---

## 9. Cross-cutting rules

**RBAC** is a capability matrix — 20 capabilities × 5 branch roles. Pages check capabilities, never roles. Adding a role is a data change; adding a check per page is not.

**Audit log** snapshots the actor's email and role onto every row. Actors get anonymised; the trail must survive them. `audit_log()` never throws — a failure to write history must not break the operation being recorded.

**Notifications** are in-app rows plus optional email, gated by per-user preference.

**CSV export** prefixes any cell starting with `=`, `+`, `-` or `@` — otherwise Excel executes it as a formula. Files carry a UTF-8 BOM so Excel reads accents correctly.

**Uploads** are validated by actual content, stored outside the executable path, and the upload directory has its own rule denying every script extension. Trusting the extension or the MIME header is how you get a webshell.

**Rate limiting** on login, registration, password reset and contact.

**CSRF** token on every state-changing form.

**Branding** is centralised — name, tagline, logo, favicon come from settings, so renaming the platform renames every page, tab, email and share card at once.

---

## 10. Frontend as it stands

Server-rendered PHP. No build step, no framework, no bundler. Vanilla JS (318 shared lines) plus Chart.js from a CDN for analytics. CSS is one hand-written 2,800-line stylesheet with custom properties, light/dark themes and a responsive breakpoint at 768px (900px on the homepage).

The homepage is a **3,959-line self-contained file** with its own `<head>` and its own inline stylesheet. It does not use the shared header. This is the single worst structural decision in the codebase — every global change has to be made twice, and it has already caused real bugs (branding not applying, SEO tags missing, a mobile drawer that collapsed to a sliver). **If you keep the PHP stack, fixing this is the highest-value refactor available. If you rewrite, do not recreate it.**

Five AJAX endpoints exist (cart, order status polling, table availability, payment status polling, reorder). There is no general API — pages render HTML.

---

## 11. Deployment shape

Runs on plain shared hosting: PHP 8.0+, MySQL/MariaDB, Apache with `mod_rewrite`. No cron on free tiers, so the reconciler is designed to be callable by an external scheduler.

`.htaccess` denies dotfiles, config and dump extensions, archives, `includes/`, `vendor/`, `scripts/`, and scripts inside the uploads directory.

**The base URL is derived from the request, not from configuration.** A stale `APP_URL` fails in a uniquely confusing way — the homepage loads while every link 404s — because the homepage is reached by typing the domain and never consults it. Whatever the stack, derive it.

`database/upgrade.php` is idempotent, driven by `INFORMATION_SCHEMA`, and safe to run repeatedly. It is the recovery path for a database restored from an older dump.

**Test coverage today: 476 assertions across 15 suites**, run against a live server over real HTTP — not mocked. They cover RBAC, tenant locking, expiry, commissions, the payment gateway, branding, free mode, admin operations and base-URL detection. **This is the asset most at risk in a rewrite.** They are shell and PHP scripts and will not port, but the *cases* they encode are the specification — port those before porting code.

---

## 12. If you change stack — read this

### What is actually hard here

Ranked by how expensive it is to get wrong:

1. **Subscription expiry with grace, fail-open dates, and a reachable billing page while locked** — leaks revenue silently when wrong
2. **Idempotent payment confirmation with database-level replay safety** — double-credits when wrong
3. **Reconciliation for lost webhooks** — customers pay and get nothing when missing
4. **Snapshotting** — order prices, commission rates, audit actors. Normalise these and history rewrites itself
5. **Two-level RBAC** — user role + per-branch role
6. **Session invalidation via `session_version`** — suspension does nothing without it
7. **Anonymise, never delete** — cascading deletes destroy financial history

None of these are PHP problems. **All of them reappear identically in Next.js, Laravel, Django or Rails.** A rewrite gets you a new UI and a new deployment story; it does not get you these for free, and re-deriving them costs months.

### What a rewrite genuinely buys you

- A real API, which you need for a mobile app
- Component reuse instead of a 3,959-line homepage
- A typed schema (Prisma/Drizzle/Eloquent) instead of hand-written SQL in 96 files
- Modern tooling — hot reload, typed tests, CI

### What it costs

- 41 tables of migrations
- 96 pages of UI
- Payment integration re-verified against live SebPay
- 476 assertions re-expressed
- New hosting: **Vercel runs neither PHP nor MySQL, and serverless functions cannot run the reconciler** — you need a separate database host and a separate scheduler

### The recommendation

**Don't rewrite to escape the two bugs you hit this week.** Both were a CSS containing-block rule and a stale config string. Neither is caused by PHP, and both reappear in React.

If the real goal is a **mobile app**, the cheap path is to expose JSON endpoints from this codebase and build React Native against them — keeping billing, RBAC, commissions and the payment integration that are already tested against a live gateway.

If you rewrite anyway, do it in this order:

1. **Port the schema first** — it is the most valuable artifact here and it is stack-neutral
2. **Port §12's seven hard rules as tests, before any feature code**
3. **Keep PHP serving live traffic** until the new stack passes them
4. Build the marketplace last — it is the easy part, and rewriting it first creates months where you have a prettier product that cannot bill anyone

**Suggested target if you go:** Next.js (App Router) + PostgreSQL + Drizzle, on Railway or Render rather than Vercel — because you need a persistent database, a background scheduler for reconciliation, and a webhook endpoint that is not cold-starting when the provider's 5-second timeout is counting down.

---

---

# Part II — The Rebuild Specification

Everything below assumes **Next.js (App Router) + PostgreSQL on Neon + Drizzle**. §13 explains why. §14 is the page-by-page build list — the part to work from.

---

## 13. Stack decision

### Database: Neon (Postgres), not Convex

Convex is a genuinely good product and it wins on two things this app cares about — **built-in reactivity** (the kitchen display, live order lists and payment-status waiting pages become trivial) and **built-in cron** (the reconciler). Those are real, and worth acknowledging before dismissing them.

It still loses here, for four reasons:

**1. Over half this application is reporting, and reporting is SQL.**
Eight admin CSV exports, the analytics dashboard, manager reports, and commission statements computed as `SUM(order value) GROUP BY restaurant WHERE delivered AND period`. Postgres does that in one query. Convex has no `GROUP BY`, no `SUM`, no window functions — you page through documents and aggregate in JavaScript. At three restaurants that is fine. At three hundred it is a rewrite, and it is the kind of rewrite that arrives exactly when the business starts working.

**2. Financial invariants belong in the schema.**
The webhook's replay safety is `UNIQUE(provider, transaction_id, status)` — enforced by the database, once, forever. Convex has no unique constraints. Its mutations *are* serializable transactions, so a check-then-insert inside one mutation is genuinely safe — this is not a correctness hole. But the invariant then lives in code that a future you has to remember to write, on every path, instead of in the schema where it cannot be forgotten. For money, that difference matters.

**3. You already have a working relational schema with live data.**
41 MySQL tables port to Postgres largely mechanically. To Convex they are a document-model redesign plus a hand-written data migration — weeks, not days, and every hour of it is spent re-deriving decisions you already made correctly.

**4. Lock-in.**
Neon is standard Postgres. If Neon disappears or gets expensive you move to Supabase, RDS, Railway or a box, and your code does not change. Convex is a bet on one vendor's query API.

**Choose Convex instead if** the product becomes primarily real-time and collaborative and the reporting stays trivial. That is not this app.

> **Worth five minutes before you commit:** **Supabase** is also Postgres, and closes the two gaps that make Convex attractive — it ships Realtime (row-level change subscriptions) and `pg_cron`. If live updates matter to you more than they currently do, Supabase gets you Convex's reactivity without giving up SQL. Neon is the better pure database (faster branching, cleaner scale-to-zero); Supabase is the better all-in-one. Either is defensible. Convex is the one I would argue against.

### The rest

| Concern     | Choice                                                         | Why                                                                                                                                                                                                                                                                          |
| ----------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework   | Next.js 15, App Router                                         | Server Components suit a mostly-read app; Server Actions replace the POST handlers                                                                                                                                                                                           |
| Database    | **Supabase Postgres**                                    | **Chosen.** Postgres, so every reporting advantage in Appendix A holds — plus the cron, realtime, storage and auth you would otherwise assemble yourself. See Appendix B for the specifics that come with it                                                          |
| ORM         | **Drizzle**                                              | SQL-shaped, no engine binary (matters on serverless), migrations are plain SQL files. Prisma is fine if you prefer it — but you will drop to raw SQL for the reports either way, and Drizzle makes that natural instead of an escape hatch                                  |
| Auth        | **Supabase Auth**                                        | Password reset, email verification and OAuth-later for free. Costs you integer user IDs — see B.2. Whatever you choose,**check `users.status` server-side on every request**                                                                                        |
| Styling     | Tailwind + shadcn/ui                                           | The existing 2,800-line stylesheet does not port. Do not try                                                                                                                                                                                                                 |
| Money       | `integer` minor units                                        | **XAF is a zero-decimal currency** — there are no centimes. Store whole francs as `integer`. The current `DECIMAL(10,2)` carries a `.00` that can never be non-zero. Keep a `currency` column for the multi-region plan                                       |
| Validation  | Zod                                                            | One schema per action, shared by the form and the server                                                                                                                                                                                                                     |
| Email       | Resend or Brevo                                                | Supabase sends auth emails, but its built-in SMTP is rate-limited and not for production. Wire a real provider on day one                                                                                                                                                    |
| Files       | **Supabase Storage**                                     | Buckets for logos, covers, dish photos, avatars. Public bucket for menu images, private for anything else                                                                                                                                                                    |
| Hosting     | **Vercel is now fine**                                   | This reverses the earlier advice. It was ruled out because its free-tier cron runs once a day — but the schedule now lives in`pg_cron`, so that objection is gone. Keep the webhook handler lean (B.4). Railway or Render remain good if you prefer a long-running server |
| Scheduling  | **`pg_cron` + `pg_net`** → your own `/api/cron/*` | Keeps the reconciler logic in TypeScript beside the billing module instead of duplicating it in an Edge Function. See B.3                                                                                                                                                    |
| Real-time   | **Supabase Realtime**, on three tables only              | `orders` (kitchen + tracking) and `payment_attempts` (the waiting page). Everything else polls or does not move. Enabling Realtime table-by-table is deliberate — it is a publication, not a free upgrade                                                               |
| Connections | **Supavisor pooler**                                     | Transaction mode (port 6543) for the app, direct/session (5432) for Drizzle migrations. Getting these the wrong way round is the classic first-day error                                                                                                                     |

### Proposed layout

```
app/
  (public)/          home, restaurants, pricing, contact, legal
  (auth)/            login, register, reset, invite
  (customer)/        account, orders, reservations, loyalty, …
  (manager)/         dashboard, orders, kitchen, menu, staff, billing, …
  (admin)/           tenants, billing, commissions, audit, ops, …
  api/
    webhooks/sebpay/ POST, raw body — see §6
    cron/reconcile/  token-protected
db/
  schema/            Drizzle tables, one file per domain
  migrations/        generated SQL
lib/
  auth/              session, RBAC, capability matrix
  billing/           invoices, plan changes, confirmation, providers
  commission/        period calculation, statements
  orders/            totals, transitions, stock
  payments/sebpay/   client, signature, status mapping
  audit/             audit log writer
```

---

## 14. Every page to be built

**78 routes**, grouped by area. Legend: **A** = anyone, **C** = customer, **S** = restaurant staff (capability in brackets), **X** = platform admin.

### 14.1 Public — 9 routes

| Route                   | Replaces                         | What it does                                                                                                                                                                                                                                                                                                              | Access |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `/`                   | `index.php`                    | Hero with working search (query + city →`/restaurants`), featured restaurants, popular dishes, pricing summary, contact. **Build from shared components — do not recreate the 3,959-line monolith.** Needs canonical, OG/Twitter tags, and `WebSite` + `Organization` JSON-LD with `areaServed: Cameroon` | A      |
| `/restaurants`        | `public/restaurants.php`       | Directory. Filters: text, city, cuisine, sort by rating. Active restaurants only                                                                                                                                                                                                                                          | A      |
| `/restaurants/[slug]` | `public/restaurant-detail.php` | Profile, menu by category, hours, reviews, "order" and "book a table" CTAs.`Restaurant` JSON-LD                                                                                                                                                                                                                         | A      |
| `/pricing`            | `public/pricing.php`           | **Rendered from the plans table, not hardcoded** — advertised limits must equal enforced limits                                                                                                                                                                                                                    | A      |
| `/contact`            | `public/contact.php`           | Support form →`support_messages`. CSRF, honeypot, per-IP rate limit                                                                                                                                                                                                                                                    | A      |
| `/privacy`            | `privacy.php`                  | Legal. Brand name from settings, never hardcoded                                                                                                                                                                                                                                                                          | A      |
| `/terms`              | `terms.php`                    | Legal                                                                                                                                                                                                                                                                                                                     | A      |
| `/robots.txt`         | `robots.php`                   | Generated, carries the real host, private areas disallowed                                                                                                                                                                                                                                                                | A      |
| `/sitemap.xml`        | `sitemap.php`                  | Generated. Lists every active restaurant, live                                                                                                                                                                                                                                                                            | A      |

### 14.2 Auth — 7 routes

| Route                       | Replaces                         | What it does                                                                                                                                                                 | Access |
| --------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `/login`                  | `auth/login.php`               | Email + password, remember-me.**Returns a specific reason on failure**: invalid / pending / pending-manager / suspended. Rate limited                                  | A      |
| `/register`               | `auth/register-customer.php`   | Customer signup → active immediately                                                                                                                                        | A      |
| `/register/restaurant`    | `auth/register-restaurant.php` | Restaurant application → user*and* restaurant both **pending**, admin notified, applicant emailed                                                                   | A      |
| `/forgot-password`        | `auth/forgot-password.php`     | Sends a reset link.**Always reports success**, whether or not the email exists — otherwise it is an account-enumeration oracle                                        | A      |
| `/reset-password/[token]` | `auth/reset-password.php`      | Single-use, expiring token. Invalidates all sessions on success                                                                                                              | A      |
| `/invite/[token]`         | `auth/accept-invite.php`       | Staff invitation.**The invitee sets their own password** — nobody else ever knows it. Token stored as sha256; an existing account may not be absorbed without consent | A      |
| `/logout`                 | `auth/logout.php`              | Clears session and remember cookie                                                                                                                                           | any    |

### 14.3 Customer — 15 routes

| Route                       | Replaces                             | What it does                                                                                                                                                      | Access |
| --------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `/account`                | `customer/dashboard.php`           | Recent orders, upcoming reservations, loyalty balance, favourites                                                                                                 | C      |
| `/browse`                 | `customer/restaurants.php`         | Signed-in directory with favourite toggles                                                                                                                        | C      |
| `/browse/[slug]`          | `customer/restaurant-detail.php`   | Menu with**option pickers** (§3), add to cart, stock and availability respected                                                                            | C      |
| `/cart`                   | `ajax_add_to_cart.php`             | Line items with options, quantity, promo code, loyalty redemption, live totals.**Works for guests**                                                         | A      |
| `/checkout`               | in`customer/restaurant-detail.php` | Delivery or pickup, address picker or new address, scheduling, payment method, notes.**Delivery fee shows as "quoted on confirmation", not zero**           | C      |
| `/orders`                 | `customer/orders.php`              | History with status filters                                                                                                                                       | C      |
| `/orders/[id]`            | `customer/order.php`               | The busiest page in the app: receipt,**live status timeline**, cancel (while allowed), reorder, write a review, read the manager's reply, rate the delivery | C      |
| `/reservations`           | `customer/reservations.php`        | Book (date, time, guests, availability check), list, cancel                                                                                                       | C      |
| `/favorites`              | `customer/favorites.php`           | Saved restaurants                                                                                                                                                 | C      |
| `/addresses`              | `customer/addresses.php`           | Address book with a default.**Editing an address never rewrites a past order**                                                                              | C      |
| `/loyalty`                | `customer/loyalty.php`             | Balance and full ledger, each entry traceable to its order                                                                                                        | C      |
| `/reviews`                | `customer/reviews.php`             | Own reviews, edit and delete                                                                                                                                      | C      |
| `/profile`                | `customer/profile.php`             | Name, phone, avatar, password                                                                                                                                     | C      |
| `/settings`               | `customer/settings.php`            | Notification preferences, theme,**account deletion → anonymise, never delete**                                                                             | C      |
| `/api/orders/[id]/status` | `ajax_order_status.php`            | Poll target for the live timeline. Tiny by design — reload only when something changed                                                                           | C      |

*(`ajax_table_availability.php` becomes a Server Action on `/reservations`.)*

### 14.4 Manager — 23 routes

Every one is gated **twice**: the branch must be one the user may operate, *and* their branch role must hold the capability.

| Route                          | Replaces                      | What it does                                                                                                                                                                               | Capability                           |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `/m`                         | `manager/dashboard.php`     | Today's orders, revenue, pending reservations, low stock, subscription state                                                                                                               | any                                  |
| `/m/orders`                  | `manager/orders.php`        | Order queue.**Confirming a delivery order prompts for the delivery fee** and stamps `delivery_fee_set_at`                                                                          | `orders.view` / `orders.advance` |
| `/m/orders/[id]`             | in`manager/orders.php`      | Detail, status history, items with options, record payment                                                                                                                                 | `orders.view`                      |
| `/m/kitchen`                 | `manager/kitchen.php`       | **Kitchen display.** Confirmed + preparing, oldest first, auto-refreshing, one-tap advance. High contrast, large type — read from across a kitchen                                  | `kitchen.display`                  |
| `/m/orders/[id]/ticket`      | `manager/ticket.php`        | Printable 80mm thermal ticket, auto-opens the print dialog                                                                                                                                 | `orders.view`                      |
| `/m/table-order`             | `manager/table-order.php`   | **Waiter table-side ordering.** Writes the same rows as an online order, so kitchen, tickets, stock, reports and payment all work unchanged                                          | `orders.advance`                   |
| `/m/menu`                    | `manager/menu.php`          | Dishes: CRUD, image, availability, stock, tags, allergens,**drag-to-reorder**                                                                                                        | `menu.view` / `menu.edit`        |
| `/m/menu/[id]/modifiers`     | `manager/modifiers.php`     | Option groups and options with price deltas                                                                                                                                                | `menu.edit`                        |
| `/m/categories`              | `manager/categories.php`    | Categories, icons, drag-to-reorder                                                                                                                                                         | `menu.edit`                        |
| `/m/tables`                  | `manager/tables.php`        | Tables, capacity, status                                                                                                                                                                   | `tables.view` / `tables.manage`  |
| `/m/reservations`            | `manager/reservations.php`  | Approve, decline, assign a table, complete                                                                                                                                                 | `reservations.view` / `.decide`  |
| `/m/promotions`              | `manager/promotions.php`    | Codes, percentage, minimum order, usage caps, date window.**Plan-limited**                                                                                                           | `promotions.manage`                |
| `/m/customers`               | `manager/customers.php`     | Who orders here, frequency, spend                                                                                                                                                          | `customers.view`                   |
| `/m/reviews`                 | `manager/reviews.php`       | Read, reply publicly, report abuse                                                                                                                                                         | `reviews.reply`                    |
| `/m/reports`                 | `manager/reports.php`       | Sales over time, top dishes, order mix, peak hours.**Plan-gated**                                                                                                                    | `reports.view`                     |
| `/m/staff`                   | `manager/staff.php`         | Invite by email, assign branch role, deactivate. Invitations expire                                                                                                                        | `staff.manage`                     |
| `/m/billing`                 | `manager/subscription.php`  | Current plan, days remaining, usage against limits, upgrade/downgrade, invoice history.**Must stay reachable while locked**                                                          | `billing.manage`                   |
| `/m/billing/invoices/[id]`   | `manager/invoice.php`       | Invoice on screen and as PDF                                                                                                                                                               | `billing.manage`                   |
| `/m/billing/pay/[id]`        | `manager/pay-invoice.php`   | **Mobile money payment.** SebPay has no hosted checkout: ask for the number, start the collection, then wait. The payer approves on their handset — nothing here may assume success | `billing.manage`                   |
| `/m/branch/switch`           | `manager/switch-branch.php` | Sets the active branch.**Validated against the user's allowed list** — a crafted POST must not select a branch they cannot access                                                   | any                                  |
| `/m/profile`                 | `manager/profile.php`       | Restaurant profile, logo, cover, hours, delivery settings                                                                                                                                  | `profile.edit`                     |
| `/m/settings`                | `manager/settings.php`      | Notification preferences that actually fire                                                                                                                                                | `settings.manage`                  |
| `/api/payments/[ref]/status` | `ajax_payment_status.php`   | Poll target for the waiting page.**Falls back to asking the provider directly** if the webhook is late — a payer already debited must not watch a spinner forever                   | `billing.manage`                   |

*(`ajax_reorder.php` becomes a Server Action on `/m/menu` and `/m/categories`.)*

### 14.5 Admin — 21 routes

| Route                | Replaces                    | What it does                                                                                                                                                                     |
| -------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/a`               | `admin/dashboard.php`     | Platform KPIs, pending approvals, reported reviews, expiring subscriptions                                                                                                       |
| `/a/restaurants`   | `admin/restaurants.php`   | Approve, reject, suspend, reinstate. Approval emails the applicant                                                                                                               |
| `/a/users`         | `admin/users.php`         | All users. Suspend (revokes sessions), anonymise,**create other administrators** — typed confirmation, password complexity, all other admins notified, audited distinctly |
| `/a/subscriptions` | `admin/subscriptions.php` | Every tenant subscription, plan, expiry, manual extension                                                                                                                        |
| `/a/plans`         | *new*                     | **Plan builder** — price, limits, commission, features, active flag. Today the limits are hardcoded in PHP; move them into the plan row                                   |
| `/a/payments`      | `admin/payments.php`      | Payment attempts. Manual confirmation calls**the same idempotent handler** the webhook calls                                                                               |
| `/a/commissions`   | `admin/commissions.php`   | Generate a period, review per restaurant, issue, settle, write off. Every transition audited                                                                                     |
| `/a/refunds`       | `admin/refunds.php`       | Refunds and chargebacks as**their own rows** — never by editing the original payment                                                                                      |
| `/a/broadcast`     | `admin/broadcast.php`     | One message to an audience (all managers, all customers, a plan, an area), in-app plus optional email                                                                            |
| `/a/reviews`       | `admin/reviews.php`       | Moderate flagged reviews: dismiss the report, or remove. No editing — rewriting someone's words under their name is worse than either outcome                                   |
| `/a/analytics`     | `admin/analytics.php`     | Growth, revenue, order volume, top tenants                                                                                                                                       |
| `/a/support`       | `admin/support.php`       | Inbox from the contact form, reply, resolve                                                                                                                                      |
| `/a/notifications` | `admin/notifications.php` | The admin's own notifications                                                                                                                                                    |
| `/a/audit`         | `admin/audit.php`         | **Read-only by design.** No delete action, and no write path except the audit writer itself                                                                                |
| `/a/areas`         | `admin/areas.php`         | Service areas — city, currency, timezone, accepting signups. Douala only today                                                                                                  |
| `/a/impersonate`   | `admin/impersonate.php`   | Become a tenant briefly. Loud undismissable banner; start and stop both audited; the log records the impersonator separately from the actor                                      |
| `/a/export`        | `admin/export.php`        | 8 CSV reports.**Escape leading `=`, `+`, `-`, `@`** or Excel executes the cell. UTF-8 BOM                                                                          |
| `/a/diagnostics`   | `admin/diagnostics.php`   | Actively exercise the system — ping the gateway, fire a signed webhook at your own endpoint, send a real email                                                                  |
| `/a/tests`         | `admin/tests.php`         | Passive health: schema present, settings sane, gateway configured                                                                                                                |
| `/a/settings`      | `admin/settings.php`      | Branding, free mode, currency, service charge, loyalty rates, commission rates, payment toggles, grace days                                                                      |
| `/a/health`        | *new*                     | Public JSON: database reachable, gateway reachable, last reconciler run. For uptime monitoring                                                                                   |

### 14.6 Machine endpoints — 3

| Route                         | Replaces                         | Notes                                                                                                                                                                                    |
| ----------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/webhooks/sebpay` | `webhooks/sebpay.php`          | **Read the raw body first.** In Next.js that means `await req.text()` before any parsing — `req.json()` destroys the exact bytes the HMAC covers. All five rules in §6 apply |
| `GET /api/cron/reconcile`   | `scripts/sebpay-reconcile.php` | Bearer-token protected. Called every 10 minutes by an external scheduler                                                                                                                 |
| `GET /api/cron/expire`      | *new*                          | Nightly: expire lapsed subscriptions, send renewal reminders, lift free mode when its end date passes                                                                                    |

---

## 15. Server-side modules

The pages are the easy half. These are where the value is — port them **first**, with tests, before any UI.

| Module                       | Responsibility                                                                                                                  | Ported from        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `lib/auth/rbac`            | 20 capabilities × 5 branch roles.`can()`, `requireCapability()`                                                            | `functions.php`  |
| `lib/auth/tenant`          | Which branches may this user operate; which is active; the locked-out check with its billing exemption                          | `functions.php`  |
| `lib/billing/provider`     | `PaymentProvider` interface plus Offline and SebPay drivers                                                                   | `billing.php`    |
| `lib/billing/confirm`      | **The single idempotent activation path.** Nothing else may activate a subscription                                       | `billing.php`    |
| `lib/billing/subscription` | Expiry, grace, lock state, free mode                                                                                            | `functions.php`  |
| `lib/commission`           | Period sales (delivered, non-refunded, excluding delivery fees), statement generation with rate snapshot                        | `commission.php` |
| `lib/orders/totals`        | **The one money function.** Never duplicated                                                                              | `functions.php`  |
| `lib/orders/transitions`   | The state machine                                                                                                               | `functions.php`  |
| `lib/orders/stock`         | Decrement on confirm, movement ledger                                                                                           | `functions.php`  |
| `lib/payments/sebpay`      | Client, phone normalisation, signature verify (hex and base64, constant-time),**status mapping where unknown → pending** | `sebpay.php`     |
| `lib/audit`                | Writer that snapshots actor email and role, and**never throws**                                                           | `functions.php`  |
| `lib/notify`               | In-app plus email, gated by preference                                                                                          | `functions.php`  |
| `lib/loyalty`              | Append-only ledger, balance as`SUM`                                                                                           | `functions.php`  |
| `lib/promotions`           | Validation: window, minimum, per-user cap, total cap                                                                            | `functions.php`  |
| `lib/settings`             | Cached key/value with typed getters                                                                                             | `functions.php`  |
| `lib/branding`             | Name, tagline, logo, favicon from settings                                                                                      | `functions.php`  |

---

## 16. MySQL → Postgres port notes

Mostly mechanical. These are the parts that are not:

| MySQL                           | Postgres                                 | Note                                                                                                                          |
| ------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ENUM('a','b')`               | `text` + `CHECK`, or a native enum   | Prefer`text` + check constraint — adding a value to a Postgres enum carries migration ceremony you do not want mid-release |
| `TINYINT(1)`                  | `boolean`                              |                                                                                                                               |
| `DECIMAL(10,2)` for money     | **`integer` minor units**        | XAF has no centimes. Whole francs, plus a`currency` column                                                                  |
| `INT UNSIGNED AUTO_INCREMENT` | `integer generated always as identity` | No unsigned in Postgres — add`CHECK (x >= 0)` where it matters                                                             |
| `TIMESTAMP … ON UPDATE`      | trigger, or set it in the application    | Postgres has no`ON UPDATE CURRENT_TIMESTAMP`                                                                                |
| `utf8mb4`                     | Postgres is UTF-8 always                 | Nothing to do                                                                                                                 |
| `LIKE '%x%'` search           | `pg_trgm` + GIN, or `tsvector`       | The restaurant search will thank you                                                                                          |

**Keep, do not "clean up":** the snapshot columns on `orders` and `order_items`, `commission_statements.commission_rate`, and `audit_log.actor_email` / `actor_role`. They look redundant. They are not — see §12.

**Timezone:** store `timestamptz` in UTC, render in `Africa/Douala`. The current schema stores naive local time, which breaks the moment you open a second country.

---

## 17. Build order

Do not build the marketplace first. It is the fun part and the least valuable, and starting there buys months of a prettier product that cannot bill anyone.

| Phase       | Deliverable                                                                  | Done when                                                    |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **0** | Schema and migrations, seeded from the live MySQL dump                       | Row counts match the old database                            |
| **1** | §15 modules plus tests for §12's seven hard rules —**no UI at all** | Tests pass. This is the specification made executable        |
| **2** | Auth, RBAC, tenant resolution, branch switching                              | A staff member sees exactly their capabilities, nothing more |
| **3** | Billing: plans, invoices, SebPay, webhook, reconciler, expiry, lock          | A real payment on a real handset activates a real plan       |
| **4** | Manager back-office: orders, kitchen, menu, tables, staff                    | A restaurant can run a service on it                         |
| **5** | Customer: browse, cart, checkout, orders, reservations, loyalty              | A diner can complete an order                                |
| **6** | Admin: approvals, commissions, refunds, audit, export, broadcast             | You can run the business                                     |
| **7** | Public site and SEO                                                          | Google can find it                                           |
| **8** | Cut over                                                                     | Old app read-only, DNS moved, both watched for a week        |

Keep the PHP app serving live traffic until phase 3 passes.

**The order above is deliberate: revenue infrastructure before features.** The current app already has revenue infrastructure, and losing it is the only way this rewrite actually fails.

---

# Appendix A — Neon vs Convex, measured against this project

Not a general comparison. Every row below is judged against something RestoLink actually does.

**What they are:** Neon is *a database* — serverless Postgres, nothing else. Convex is *a backend* — document database, serverless functions, real-time subscriptions, cron, file storage and full-text search in one product. So this is not really "which database". It is "one product, or five".

> Pricing and free-tier limits move. Anything quantitative below should be re-checked before you commit.

---

## A.1 Scorecard

| #  | What this project does                                                                                                             | Neon (Postgres)                                                               | Convex                                                                                                                                                      | Wins                         |
| -- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1  | **Commission statements** — `SUM(order value) GROUP BY restaurant` over a date range, excluding delivery fees and refunds | One query. ~15 lines                                                          | No`GROUP BY`, no `SUM`. Read every order in the period, aggregate in JS, paginate to avoid limits                                                       | **Neon**, decisively   |
| 2  | **8 admin CSV exports** + analytics + manager reports                                                                        | `SELECT` with joins and aggregates                                          | Document reads + manual joins + manual aggregation, per report                                                                                              | **Neon**, decisively   |
| 3  | **Kitchen display** — must show new orders without a refresh                                                                | Poll every 10s, or add Pusher/Ably                                            | `useQuery` — updates push automatically. Zero extra code                                                                                                 | **Convex**, decisively |
| 4  | **Order tracking + payment waiting page**                                                                                    | Two polling endpoints (already built in PHP)                                  | Reactive queries. The two`/api/*/status` routes in §14 disappear                                                                                         | **Convex**             |
| 5  | **Reconciler every 10 min**                                                                                                  | No built-in scheduler. Token-protected route + cron-job.org / Railway cron    | `crons.interval()` in the codebase                                                                                                                        | **Convex**             |
| 6  | **Webhook replay safety**                                                                                                    | `UNIQUE(provider, transaction_id, status)`. Enforced by the schema, forever | No unique constraints. Check-then-insert inside a mutation —*safe*, because mutations are serializable — but the rule lives in code you must not forget | **Neon**               |
| 7  | **Confirm payment atomically** — attempt + invoice + subscription + plan_change                                             | `BEGIN … COMMIT`                                                           | Mutations are ACID and serializable with automatic retry. Genuinely equal                                                                                   | **Tie**                |
| 8  | **41 relational tables, migrating from live MySQL**                                                                          | Mechanical port. Days                                                         | Document-model redesign + hand-written migration. Weeks                                                                                                     | **Neon**, decisively   |
| 9  | **Multi-tenant scoping** — every query filtered by branch                                                                   | `WHERE restaurant_id = ?`, add an index                                     | `.withIndex("by_restaurant")`. Indexes must be declared explicitly or the query scans                                                                     | **Tie**                |
| 10 | **Money**                                                                                                                    | `integer` minor units, exact                                                | JS numbers are float64. Whole XAF francs are exact up to 2^53, so fine — but never store decimals, and`v.int64()` exists if you want certainty           | **Tie**, with care     |
| 11 | **Restaurant search** (name, description, city, cuisine)                                                                     | `pg_trgm` + GIN, or `tsvector`                                            | Built-in full-text search index                                                                                                                             | **Convex**, slightly   |
| 12 | **Image uploads** (logos, covers, dishes, avatars)                                                                           | Not a database concern — add S3 / R2 / UploadThing                           | Built-in file storage                                                                                                                                       | **Convex**             |
| 13 | **Auth with server-side session revocation**                                                                                 | Auth.js + a sessions table. Delete rows to revoke                             | Convex Auth or Clerk. Revocation needs the same deliberate design                                                                                           | **Tie**                |
| 14 | **Audit log — append-only, never editable**                                                                                 | `REVOKE UPDATE, DELETE`. Enforced by the database                           | Convention only. Any mutation with the right code can rewrite it                                                                                            | **Neon**               |
| 15 | **Ad-hoc "why does this number look wrong?"**                                                                                | `psql`, any SQL client, any BI tool                                         | Dashboard + writing a query function and deploying it                                                                                                       | **Neon**, decisively   |
| 16 | **Services to run and pay for**                                                                                              | Database + host + cron + storage + realtime ≈ 4–5                           | One                                                                                                                                                         | **Convex**, decisively |
| 17 | **Lock-in**                                                                                                                  | Standard Postgres. Move to Supabase, RDS, Railway, a box — code unchanged    | Proprietary query API. Self-hosting exists; the ecosystem does not travel                                                                                   | **Neon**               |
| 18 | **Getting help** — docs, Stack Overflow, AI assistance                                                                      | Postgres is 30 years of training data                                         | Small, new, moving fast                                                                                                                                     | **Neon**               |

**Tally: Neon 8, Convex 5, tied 5.** But this is not decided by count — see A.3.

---

## A.2 The same feature, both ways

Concrete, because the scorecard hides how different these feel.

### Commission for last month, per restaurant

**Postgres** — the whole thing:

```sql
SELECT r.id, r.name,
       COUNT(o.id)                        AS order_count,
       SUM(o.subtotal - o.discount_amount) AS gross
FROM restaurants r
JOIN orders o ON o.restaurant_id = r.id
WHERE o.status = 'delivered'
  AND o.created_at >= $1 AND o.created_at < $2
  AND NOT EXISTS (SELECT 1 FROM refunds f WHERE f.order_id = o.id)
GROUP BY r.id, r.name;
```

**Convex** — the shape you end up with:

```ts
// No GROUP BY, no SUM, no NOT EXISTS. All of it in application code.
const orders = await ctx.db.query("orders")
  .withIndex("by_status_and_date", q =>
    q.eq("status", "delivered").gte("createdAt", start).lt("createdAt", end))
  .collect();                          // every order in the period, into memory

const refunded = new Set(
  (await ctx.db.query("refunds").collect()).map(r => r.orderId)
);

const byRestaurant = new Map();
for (const o of orders) {
  if (refunded.has(o._id)) continue;
  const acc = byRestaurant.get(o.restaurantId) ?? { count: 0, gross: 0 };
  acc.count++; acc.gross += o.subtotal - o.discountAmount;
  byRestaurant.set(o.restaurantId, acc);
}
```

That works. It is also every reporting query you will ever write, and `.collect()` on a growing table is a cliff — Convex caps how much a single function may read, so past a certain volume this becomes paginated batching, which is another rewrite of the same code.

Convex does ship an aggregate component that maintains running counts and sums incrementally, and it is good at what it does. But every aggregate must be **declared in advance**. That is fine for a fixed dashboard tile and wrong for "show me commission for 12 March to 4 April, grouped by restaurant, excluding refunds" — which is exactly what an admin panel is.

### Kitchen display

**Postgres:**

```ts
// Poll. Works, but it is a request every 10s per screen, forever.
const { data } = useSWR("/api/kitchen", fetcher, { refreshInterval: 10_000 });
```

**Convex:**

```ts
// Pushes. New order appears the moment it is written.
const orders = useQuery(api.kitchen.active, { restaurantId });
```

This one is not close. If a kitchen screen is core to the product, Convex hands you something Postgres makes you build.

---

## A.3 What actually decides it

Ignore the tally. Two facts settle this:

**1. This app is a reporting app wearing a marketplace costume.**
Count the screens: 8 CSV exports, platform analytics, manager reports, commission statements, subscription overview, payment history, audit search. Against three genuinely real-time screens: kitchen, order tracking, payment waiting.

Convex makes the three easy and the twenty painful. Postgres makes the twenty trivial and the three merely tedious — and *tedious is already solved*, because the PHP app polls today and it works.

**2. Reporting gets worse over time; polling does not.**
A polling interval that is fine at 3 restaurants is fine at 300. An aggregation-in-JavaScript that is fine at 3 restaurants breaks at 300 — and it breaks precisely when the business starts working, which is the worst possible moment to be rewriting your billing reports.

Everything else — cron, file storage, search, one bill instead of five — is real convenience that you can buy back for roughly the price of a coffee per month.

---

## A.4 Verdict

**Neon.** Add a cron service and object storage; keep polling for the three live screens.

**Flip to Convex if** you decide the kitchen display and live order feed are the *product* — the thing restaurants pay for and talk about — rather than a feature. Then the reporting pain is a cost worth paying, and you should design the aggregates deliberately from day one instead of discovering them.

**Do not flip because of the setup convenience.** Four extra services sounds heavy and is roughly two afternoons: Neon (free), Railway (~$5/mo, gives you cron), cron-job.org (free), Cloudflare R2 (free tier). Weighed against redesigning 41 relational tables as documents and rewriting every report, it is not close.

**And consider Supabase once more.** It is Postgres — so §A.1 rows 1, 2, 8, 14, 15, 17 and 18 all stay in the win column — while shipping Realtime, `pg_cron`, storage and auth. It is the honest answer to "I want Convex's convenience without giving up SQL". Neon is the better raw database; Supabase is the better fit for a solo developer who does not want to assemble five services.

**Ranked, for this project:**

|   | Choice             | Why                                                                                                                   |
| - | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1 | **Supabase** | Postgres, plus the cron / realtime / storage / auth you would otherwise bolt on                                       |
| 2 | **Neon**     | The better database; assemble the rest yourself. Pick this if you want the cleanest data layer and do not mind wiring |
| 3 | **Convex**   | Only if real-time becomes the product                                                                                 |

---

# Appendix B — Supabase specifics

Decided: **Supabase**. This is what comes with that choice — the parts that are not just "Postgres with a nicer dashboard".

Read **B.1 first.** It is the one that loses data if you get it wrong.

---

## B.1 RLS is not optional here — and Drizzle will not turn it on for you

Supabase publishes every table in the `public` schema through an auto-generated REST API (PostgREST). That API is reached with the **anon key, which is public by design** — it ships to the browser, it is in your JavaScript bundle, it is not a secret.

The only thing standing between that key and your data is **Row Level Security**.

Tables created through the Supabase dashboard get RLS switched on by default. **Tables created by a migration do not** — and Drizzle creates tables by migration. So the default outcome of following §17 phase 0 is 41 tables, RLS off, exposed to the internet through a key you have published.

That means anyone could read `users`, `orders`, `payments` and `audit_log`. It is the single most common way a Supabase project leaks.

**Fix it two ways, and do both:**

**A. Take `public` off the Data API.** Settings → API → Exposed schemas → remove `public`. Your app talks to Postgres directly over the connection string via Drizzle, so it loses nothing. This alone closes the hole.

**B. Enable RLS on every table anyway, deny by default.** Belt and braces, and it survives someone re-exposing the schema later:

```sql
-- Run for every table. No policies = nothing gets through except the
-- service role, which bypasses RLS by design.
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
```

Add this as the last step of every migration that creates a table, and verify it in CI — a table added in six months' time is exactly the one that gets forgotten.

### Do not rewrite the capability matrix as RLS policies

Tempting, and wrong. Your authorization is 20 capabilities × 5 branch roles, plus tenant lock state, plus free mode, plus impersonation. Expressed as SQL policies that is unreadable, untestable and duplicated — because the application still needs the same rules to decide what to render.

**Keep authorization in `lib/auth/rbac` (§15), server-side.** Use RLS purely as a deny-by-default backstop. One source of truth for permissions; the database is the fence, not the logic.

The `service_role` key bypasses RLS entirely. It belongs in server environment variables only — **never in a Client Component, never in `NEXT_PUBLIC_*`.**

---

## B.2 Supabase Auth changes your user IDs

`auth.users.id` is a **UUID**. The standard pattern is a `public.profiles` row keyed to it:

```sql
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  phone       text,
  role        text not null default 'customer',   -- customer | manager | admin
  status      text not null default 'active',     -- active | pending | suspended
  avatar_url  text,
  deleted_at  timestamptz
);
```

**The cost:** every foreign key to a user becomes `uuid` instead of `integer` — around 15 of your 41 tables (`orders`, `reviews`, `restaurants`, `restaurant_staff`, `audit_log`, `loyalty_transactions`, and so on).

**Do it anyway**, for one reason: phase 0 rebuilds the schema regardless, and that is the *only* cheap moment to change an ID type. Doing it later means migrating live financial rows.

**Note the `on delete cascade` above and remember §12.** Deleting an `auth.users` row would cascade into profiles and — if you let it — into orders. **Do not cascade past `profiles`.** Anonymise: overwrite name, email and phone, set `deleted_at`, leave every other row standing.

### The revocation gap

Your PHP app revokes a session **instantly** — `session_version` is compared on every request.

Supabase Auth uses short-lived JWTs plus refresh tokens. `auth.admin.signOut(userId)` kills the refresh tokens, but **an access token already issued stays valid until it expires** (one hour by default). A suspended user could keep acting for up to an hour.

For suspension-as-moderation that may be tolerable. For suspension-as-fraud-response it is not.

**The fix costs nothing:** you are loading the profile on every authenticated request anyway. Check `status` there and reject. That is exactly what `enforce_session_validity()` does today — port the behaviour, not the mechanism.

```ts
// lib/auth/session.ts — the guard every protected route goes through.
// The JWT proves who they are. It does not prove they are still allowed in.
if (profile.status !== 'active' || profile.deleted_at) {
  await supabase.auth.signOut();
  redirect('/login?reason=suspended');
}
```

**If you would rather keep integer IDs**, use Auth.js v5 with database sessions instead and skip Supabase Auth. It is a defensible choice — you keep instant revocation and a simpler port, at the cost of owning password reset, email verification and any future OAuth yourself.

---

## B.3 The reconciler, on `pg_cron`

The reconciler must call SebPay over HTTP. `pg_cron` runs SQL, not HTTP — so pair it with `pg_net`, which makes async HTTP requests from inside Postgres.

**Do not** rewrite the reconciler as a Supabase Edge Function. Edge Functions are Deno; your billing logic is in your Next.js app. Two copies of `billing_confirm_payment` is precisely the "two activation paths" failure §6 warns about.

Let `pg_cron` be a **trigger only** — it pokes your app, your app does the work:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every 10 minutes: ask our own app to run the sweep.
select cron.schedule(
  'sebpay-reconcile',
  '*/10 * * * *',
  $$
  select net.http_post(
    url     := 'https://yourdomain.cm/api/cron/reconcile',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.cron_secret'))
  );
  $$
);

-- Nightly at 02:00 Douala time: expire lapsed subscriptions, send reminders,
-- lift free mode when its end date passes.  (pg_cron runs on UTC.)
select cron.schedule('nightly-expire', '0 1 * * *',
  $$ select net.http_post(url := 'https://yourdomain.cm/api/cron/expire', ...) $$);
```

Two things to get right:

- **The secret does not belong in the cron SQL.** Anyone with database access can read `cron.job`. Put it in a Vault secret or a database setting, as above.
- **`pg_net` is fire-and-forget.** It will not tell you the sweep failed. Have `/api/cron/reconcile` write a `last_run_at` row, and surface it on `/a/health` (§14.5). A reconciler that silently stopped three weeks ago is worse than no reconciler, because you believe you are covered.

---

## B.4 Realtime, on exactly three tables

Realtime is a Postgres publication, not a global switch. Add only what actually needs to push:

```sql
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.payment_attempts;
```

That covers all three live screens:

| Screen                  | Table                | Replaces                       |
| ----------------------- | -------------------- | ------------------------------ |
| Kitchen display         | `orders`           | 10-second polling              |
| Customer order tracking | `orders`           | `/api/orders/[id]/status`    |
| Payment waiting page    | `payment_attempts` | `/api/payments/[ref]/status` |

**Keep the polling fallback on the payment page.** Realtime tells you when *our own row* changes — and our row only changes when the webhook arrives. If the webhook is lost, Realtime is as silent as polling was. The waiting page must still ask SebPay directly after a while (§14.4). Realtime makes the happy path instant; it does nothing for the failure path, and the failure path is the one that costs you a customer.

Realtime respects RLS. With `public` off the Data API (B.1) you will subscribe with the anon key and a user JWT, so those tables need read policies even though the rest of the app goes through Drizzle. Scope them tightly:

```sql
-- A customer may watch only their own order.
create policy "own orders" on public.orders
  for select using (user_id = auth.uid());
```

---

## B.5 Connections, and the first-day mistake

Supabase gives you three connection strings. Using the wrong one is the most common opening error:

| Use           | Port | Mode                            | For                                                                          |
| ------------- | ---- | ------------------------------- | ---------------------------------------------------------------------------- |
| App runtime   | 6543 | Supavisor,**transaction** | Serverless functions. Many short connections                                 |
| Migrations    | 5432 | **Session** / direct      | Drizzle Kit. Transaction mode cannot run DDL or prepared statements properly |
| Local tooling | 5432 | Direct                          | `psql`, backups                                                            |

```ts
// drizzle.config.ts — migrations
dbCredentials: { url: process.env.DIRECT_URL! }      // 5432

// db/index.ts — runtime
const client = postgres(process.env.DATABASE_URL!, { prepare: false })  // 6543
```

`prepare: false` matters: transaction-mode pooling does not support prepared statements, and the error you get without it is intermittent and baffling.

---

## B.6 Migrating the live MySQL data

You have real rows — 3 restaurants, 8 users, orders, subscriptions, notifications. They must survive.

1. **Schema first, data second.** Build all 41 tables in Supabase with Drizzle. Do not let an import tool infer types — it will guess `text` for money and `timestamp` for `timestamptz`.
2. **Users are the hard part.** They cannot simply be inserted: Supabase Auth owns `auth.users`, and passwords are bcrypt in MySQL. Supabase Auth *can* accept bcrypt hashes on import through the Admin API, so existing passwords keep working. Verify that with two test accounts before migrating the rest.
3. **Map integer IDs to UUIDs once**, into a temporary `id_map` table, then rewrite every foreign key from it. Do not generate UUIDs twice.
4. **Reconcile by counting.** Row counts per table, plus `SUM(total_amount)` on orders and `SUM(amount)` on payments. If the money does not match to the franc, stop.
5. **Freeze writes during the cutover.** Put the PHP app in read-only mode first. An order placed mid-migration is an order that vanishes.

---

## B.7 Free tier — the one gotcha

Supabase pauses free projects after **7 days without activity**. A live product with real traffic never trips this. A staging project you touch fortnightly does — and unpausing is manual.

Either keep one paid project for production, or accept that staging will need waking up. Do not discover this the morning of a demo.

---

## B.8 Revised at-a-glance

|                 | Was (Neon plan)           | Now (Supabase)                                                  |
| --------------- | ------------------------- | --------------------------------------------------------------- |
| Database        | Neon                      | Supabase Postgres                                               |
| Auth            | Auth.js + sessions table  | Supabase Auth +`profiles` (**UUID ids**)                |
| Files           | UploadThing / R2          | Supabase Storage                                                |
| Cron            | cron-job.org → API route | `pg_cron` + `pg_net` → API route                           |
| Realtime        | polling everywhere        | Realtime on`orders` + `payment_attempts`; polling elsewhere |
| Hosting         | Railway / Render          | **Vercel is fine now** — the cron objection is gone      |
| Services to run | 4–5                      | 2 (Supabase + host)                                             |
| New risk        | —                        | **RLS off by default on migrated tables (B.1)**           |

Nothing in §14 (the 78 routes), §15 (the modules), §16 (the Postgres port) or §17 (the build order) changes. Two routes get *easier* — the order-status and payment-status pollers become subscriptions — but keep them: they are the fallback when Realtime or the webhook is silent.
