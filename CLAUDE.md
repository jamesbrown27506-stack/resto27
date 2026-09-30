# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Resto237 (formerly "RestoLink" in older docs/comments) — a multi-tenant food-ordering platform for Cameroon, live at https://resto237.online. Customers order delivery/pickup, reserve tables and pay by mobile money (CamerPay: MTN/Orange); restaurants run their service from a back-office; a platform admin oversees tenants, billing and payouts. Next.js 16 App Router + React 19 (React Compiler on) + Tailwind v4 + Supabase, deployed on Vercel. Android/iOS apps are Capacitor shells around the live site.

## Commands

The dev machine is Windows (PowerShell); scripts assume that where it matters.

```bash
npm run dev                                   # http://localhost:3000
npm run build                                 # production build (also the type check that matters)
npm run lint                                  # ESLint (next core-web-vitals + typescript)
npx tsc --noEmit                              # type check without building
npm test                                      # vitest run — all src/**/*.{test,spec}.{ts,tsx}
npx vitest run src/lib/orders/totals.test.ts  # one file
npx vitest run -t "service charge"            # tests matching a name
```

Mobile: `npm run mobile:sync` (cap sync), `npm run mobile:check` (verifies Firebase/signing files without printing them), `npm run mobile:apk` (builds the signed APK into `public/downloads/resto237-<version>.apk` and rewrites `src/lib/app-release.json`; bump `versionCode`/`versionName` in `android/app/build.gradle` first; `-- --skip-build` republishes the last build). See `docs/MOBILE_RELEASE.md`.

Tests are pure unit tests of `src/lib` modules — there is no DB/integration harness. Modules marked `"use server"` or importing `server-only`/the Supabase admin client are awkward to import in tests; put testable logic in a plain module next to them (the existing pattern: e.g. `reservations/cancellation.ts` holds the rules, the action calls it).

## Architecture

### Route groups and roles
- `src/app/(public)` — marketing, restaurant directory `/restaurants/[slug]`, SEO guide pages `/explore/guide/*`.
- `src/app/(auth)` — login/register/invite/reset.
- `src/app/(customer)` — `/account`, `/orders`, `/checkout`, `/reservations`, … Guests may use `/browse` and `/cart`; the account is only required at checkout.
- `src/app/(manager)/m/*` — restaurant back-office. **The prefix is `/m`, not `/manager`.**
- `src/app/(admin)/a/*` — platform admin. **The prefix is `/a`, not `/admin`.** `/a/health` is an unauthenticated JSON uptime endpoint.
- `src/app/api/cron/*` — background sweeps; `src/app/api/webhooks/camerpay` — payment callback; `src/app/api/push/sync`.

### Auth is layered — the proxy is not authorization
- `src/proxy.ts` (Next 16's renamed middleware) only refreshes the Supabase session and bounces anonymous users off protected prefixes. It cannot see profile status, role or capabilities.
- `lib/auth/session.ts` — `getCurrentProfile` / `requireRole` / `requireSuperAdmin` / `superAdminOrError`. Admins are simple or super (`profiles.is_super_admin`, 0063); critical switches (money, gateways, fees, admins, impersonation) are super-only, enforced in the actions. Always `supabase.auth.getUser()`, never `getSession()`. Profile `status` (and, for managers, the restaurant's status) is re-checked on every request so suspension takes effect immediately.
- **Two-level permissions:** `profiles.role = 'manager'` only means "works at a restaurant". Real permission is `restaurant_staff.role` (owner/manager/kitchen/cashier/waiter) **per branch**, resolved by `lib/auth/branch.ts` (`requireCapability`). The active branch comes from a cookie/session, never from an action argument. Pages and UI check **capabilities** (`lib/capabilities.ts`), never roles.
- **Every Server Action re-checks auth itself** — an action is a POST endpoint that never passes through the layout guarding its page.
- Admin impersonation of a tenant lives in `lib/auth/impersonation.ts`; the audit log records both actor and impersonator.

### Data access
- `lib/supabase/server.ts`: `createClient()` (user session, RLS applies) and `createAdminClient()` (secret key, **bypasses RLS**). Most server reads/writes use the admin client with explicit `restaurant_id`/`customer_id` filters; RLS is the deny-by-default backstop, not the permission logic.
- `lib/data/*.ts` are server read layers; `lib/data/*-actions.ts` are `"use server"` Server Actions, mostly returning `ActionResult` (`{ ok: true; note? } | { ok: false; error }`, defined in `admin-actions.ts`). Customer-facing flows (checkout, payments) additionally return a stable machine `reason` code that the caller maps to dictionary strings; the French `error` is the fallback.
- **Anything that grants paid service or moves money must be a plain server module (`import "server-only"`), never a `"use server"` export** — e.g. `lib/payments/collect.ts`, `lib/data/invoice-activation.ts`. Otherwise it is reachable from a URL.
- Side-effect writers never throw: `notify()`, the audit writer, order-status history, `stampHeartbeat()`. A failed notification/log must not undo the operation it records.

### Money
- All amounts are integer XAF (zero-decimal). Times are `timestamptz`, rendered in `Africa/Douala` (`lib/format/*`).
- `lib/orders/totals.ts` is **the one money function** — service charge applies to food after discount, never to the delivery fee. Never add up totals anywhere else.
- Delivery fees are quoted by the restaurant on confirmation and **paid in cash to the rider** — they are stored (`delivery_fee`, `delivery_fee_set_at`) but never added to `orders.total`, which is exactly the amount paid online (0059). The UI shows "to be confirmed" until `delivery_fee_set_at` is stamped.
- Order flow is payment-first: `pending` (restaurant must accept) → `awaiting_customer` (customer pays the food) → `confirmed` → … Both waits are bounded by the admin setting `order_response_minutes` (default 15, `lib/orders/deadline.ts`); the order-nag cron cancels what outlives it and returns stock/points (`lib/orders/cancellation-effects.ts`).
- Paid orders can be cancelled by the restaurant or admin: `cancel_paid_order` (0059) debits the restaurant and writes a pending `refunds` row; `lib/payments/refund-payouts.ts` sends it to Mobile Money (claim → send → confirm, retried by the reconciler). The restaurant's share of undelivered paid orders and online deposits of upcoming bookings is held back from withdrawals (`ordersInProgressHold`).
- Order/reservation/snapshot columns (prices, commission rates, actor email/role) are deliberate snapshots — don't "normalise" them away. Loyalty is an append-only ledger (balance = SUM), not a counter.

### Payments (CamerPay or SasPay — Cameroon only)
- Two gateways: `lib/payments/camerpay/client.ts` and `lib/payments/saspay/client.ts` (docs in `docs/SASPAY.md`). A super admin picks the collection and payout gateway separately (settings `payment_provider_collect` / `payment_provider_payout`, Payments → Gateways, `lib/payments/gateway.ts`). Each attempt stores its `provider` and SasPay payouts store `reply_to = "saspay:<id>"`, so confirmation always returns to the gateway that took the money. Everything is pinned to CM / XAF / MTN+Orange numbers.
- `lib/payments/collect.ts` initiates and settles attempts for subscription / reservation / order / wallet / dining kinds (`dining` = one part-payment of a table bill, `raw_response.diningPaymentId`).
- The payment service fee (`service_charge_percent`) is the gateway's cut and applies to every customer Mobile Money payment: online orders, reservation deposits (`reservations.deposit_fee`, kept by the platform) and table-bill payments (on share + tip). Cash and pay-at-restaurant carry no fee.
- `payment_mode` setting: `sandbox` (attempts succeed instantly, no money moves) vs `live`.
- Three paths reach a pending attempt — browser poll, webhook, reconciler cron — and all funnel into the same resolver using conditional (compare-and-swap) updates so racing paths credit exactly once. The verdict comes only from `confirmTransaction()`; the webhook body is treated as a hint (CamerPay callbacks are unsigned).
- **Orange is customer-initiated (2026-09):** CamerPay answers an Orange `retrait` with `etat:false` / HTTP 404 and a code to dial (`#150*14*…*amount# (MERCHANT NAME)`). That is a pending payment, not a refusal: `dialInstructionFromRefusal` (notification.ts) reads it, the attempt stays pending with `raw_response.customerDial`, and every check re-sends the same `retrait` (`claimDialledCollection` in collect.ts) until it is accepted — after which the report still gives the verdict. The identify action is `IDENTIFIE`, not `identifier`.
- `settled_at` means "finished, nothing owed" — a success is stamped only after the subscription is extended / wallet credited, so "succeeded and unsettled" is the reconciler's work queue.
- Refunds and withdrawals: `lib/payments/refund-payouts.ts` (all customer refunds — orders, bookings, late payments on orders no longer payable), `lib/payments/withdrawals.ts`. The resolver asks CamerPay before expiring an attempt past its 5-minute window.
- Contact between customers and restaurants is **in-app chat only** — never show phone numbers or WhatsApp links to the other side (product decision: it lets both sides bypass the platform). Restaurants may only open a thread with a customer who ordered/booked there.

### Table service & bookings (0068)
- A `dining_sessions` row is one **bill**; a table can hold many. `kind` solo/group, a group has a 4-char `join_code`. Guests may order before the waiter confirms presence (`presence_confirmed_at`); `decide_dining_item` refuses dishes of unconfirmed guests. Waiter orders go onto a bill (`staff_add_dining_items`), never a separate ticket (Enterprise). Payments are parts in `dining_payments` (online split modes + optional tip, or the remaining in cash); `dining_try_close` closes a covered bill. Pure previews in `lib/dining/bill.ts` mirror the SQL.
- Every reservation has a voucher code (`R237-XXXX-XXXX`, `/v/<code>`, `lib/reservations/voucher.ts`), redeemed once by `redeem_reservation_voucher`, which seats the booking and deducts the deposit from a bill. Bookings can hold several tables (`reservation_tables`); availability is a floor simulation (`lib/reservations/tables.ts`, loaded by `lib/data/booking-rules.ts`) plus closures, arrivals cap, max party (above it: group request) and the admin horizon settings.

### Background jobs
- `/api/cron/{reconcile,expire,order-nag,delivery-monitor,reservation-clock}` are scheduled by **pg_cron + pg_net in Supabase** (migration `0045_pg_cron_schedule.sql`), not by `vercel.json` (there is none). Since 0065 every job is **gated in the database**: `select net.http_get(…) where public.cron_due_<job>()`, so Vercel is only called when something is due. If you add a sweep to a route, extend its `cron_due_*` function in SQL too, or the new work never triggers a call. Vercel Hobby CPU is tight: don't add cron routes or fast polling — reuse the existing sweeps, poll only while visible and only while something is pending.
- Each route calls `requireCronAuth()` (`Authorization: Bearer $CRON_SECRET`; unset secret fails closed) and `stampHeartbeat()` into `ops_heartbeats`, which `/a/health` reads.
- `next.config.ts` redirects alternate hosts to the canonical domain **except `/api/cron/`** — a cross-host redirect drops the bearer header and every sweep 401s. Keep that exemption.

### Notifications
`lib/notify.ts` is the single fan-out point: event + recipients → per-recipient preferences → in-app row, email (`lib/mail.ts`, SMTP via nodemailer, diverted to `MAIL_TEST_INBOX` in test mode), web push (`lib/push.ts`, VAPID) and Firebase/FCM for the native apps (`lib/firebase/*`, `lib/notification-provider.ts`). A missing preference row means "default", not "off". The service worker is `public/sw.js` (served no-cache).

Back-office freshness is **live, not polled** (0066): triggers bump `restaurant_signals.version` when orders, reservations, table requests or chats change; `lib/realtime/restaurant-signal.ts` holds one Realtime channel per branch and screens re-read on change (`useRestaurantSignal`), polling only as a 5-minute net while live. If you add something the back office counts, add a trigger that bumps the signal.

Palettes: `color_palette` setting (`classic` | `ndole`, Admin → Appearance) sets `data-palette` on `<html>`; the Ndolé tokens live in `globals.css`. Use the colour tokens, never raw hex, or a component will ignore the palette.

### Database & migrations
- `supabase/migrations/NNNN_*.sql`, plain SQL, applied **by hand in the Supabase SQL editor** (no Supabase CLI config in the repo). Numbers are not unique (two `0045_`, two `0050_`); give new ones the next free number.
- Production may lag the migrations. Code touching newly-added columns uses migration-tolerant fallbacks: detect a missing column via `isMissingColumn` (Postgres `42703` **or** PostgREST `PGRST204`, see `lib/data/missing-column.test.ts`) and retry without it.
- Schema conventions: `text` + `CHECK` instead of enums, integer money, `timestamptz`, `enable row level security` on every new table. Branches are rows in `restaurants`, not a separate table. Complex multi-row money operations are Postgres functions (e.g. `cancel_customer_reservation`) so they run in one transaction.

### i18n
French is the source language, English is typed against it. Strings live in `lib/i18n/dict/<screen>.ts` via `defineDict({ fr, en })` (a missing English key is a compile error), aggregated in `lib/i18n/dictionaries.ts`; use `useLocale()` on the client and `getLocale()` / `getTranslator()` from `locale-server.ts` on the server. Public pages take `?lang=en` (set by the proxy). Server-generated copy convention: French for customers/managers, English for the admin area.

### Mobile (Capacitor)
`capacitor.config.ts` points the native WebView at the live HTTPS site (`server.url`, overridable with `CAPACITOR_SERVER_URL`); `mobile-shell/index.html` is only the offline fallback page. Everything server-side keeps running on Vercel. Native-only code lives in `src/lib/capacitor/*` and `src/components/capacitor/*`; `native/android/` holds a first-party plugin. Signing keys, `keystore.properties` and `google-services.json` are gitignored and must never be committed. Phone bottom-bar tabs for every role are defined in `src/lib/mobile-tabs.ts`.

### Security headers
The CSP in `next.config.ts` allow-lists the Supabase host for `img-src`, `media-src` and `connect-src` (REST + realtime wss) plus Firebase/GA. Any new off-origin asset type or third-party host needs an explicit entry there, or it fails silently in the browser. Server Action body limit is 4 MB because uploads (`lib/uploads.ts`, 2 MB max, magic-byte sniffed) go through actions.

## Repo docs

- `explanation.md` is the original product spec. Code comments citing `§N` (e.g. "§12 hard rule #6") refer to its sections.
- `dev.md`, `backend.md`, `frontend.md`, `implementation.md` and `ROUTES.md` are early build plans from the fixture era. They're good for intent, but they're stale on specifics: fixtures are gone, there's no Drizzle, and the payment provider is CamerPay, not SebPay.
- `NOTIFICATIONS_SETUP.md`, `FIREBASE_SETUP.md`, `docs/firebase-notifications.md` and `docs/MOBILE_RELEASE.md` are current setup guides.
- `.env.example` documents every environment variable.

## Conventions

- Comments in this codebase explain *why* at length (often with a boxed `─────` block describing a past incident). Preserve them when editing nearby code, and match that style for non-obvious decisions.
- Commit messages recently use `feat:` / `fix:` prefixes with a short imperative summary.
