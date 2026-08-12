# RestoLink — Implementation Phases (Remaining Work)

**Status snapshot (scan date):** migration layer, auth/RBAC, all server-action data layers
(`lib/data/*`), and the manager/admin UIs are done against real Supabase. What remains is
replacing fixture data with real reads in the customer + public areas, finishing the payment
webhook, and hardening.

---

## Phase 1 — Customer account: real data

The largest chunk. All backend actions already exist; the pages just need wiring.

| Page | Action |
|---|---|
| `(customer)/profile` | Wire to `updateOwnProfile`, `uploadOwnAvatar`, `changeOwnPassword` (copy pattern from `(admin)/a/profile/profile-form.tsx:83-199`) |
| `(customer)/settings` | Replace `FIXTURE_CUSTOMER` (`page.tsx:12,47`) with real session |
| `(customer)/reviews` | Replace `FIXTURE_CUSTOMER` + `fixtures/customer` with real review data |
| `(customer)/reservations` | Replace `FIXTURE_CUSTOMER` + fixtures with real reservations |
| `(customer)/orders` | Replace `FIXTURE_CUSTOMER` + `fixtures/orders` with real orders |
| `(customer)/orders/[id]` | Replace `fixtures/orders` with real order read |
| `(customer)/loyalty` | Replace `FIXTURE_CUSTOMER` + fixture ledger with real loyalty ledger |
| Cart | Replace fixture loyalty balance (`cart-parts.tsx:17`) with real balance |

**Depends on:** nothing (backends already exist).
**Done when:** no customer page imports from `lib/session.ts` or `lib/fixtures/customer.ts`.

---

## Phase 2 — Public site: real data

| Page | Action |
|---|---|
| `(public)/home-content` | Replace `ACTIVE_RESTAURANTS` + `POPULAR_DISHES` fixtures with DB reads |
| `components/marketing/hero` | Replace fixture cuisines/quartiers (`hero.tsx:25`) |
| `(public)/restaurants/restaurant-directory` | Replace `fixtures/restaurants` (`directory.tsx:10`) |
| `(public)/restaurants/[slug]` | Replace menu/reviews/restaurant fixtures (`page.tsx:11-13`) |
| `sitemap.ts` | Replace `ACTIVE_RESTAURANTS` fixture with live query |

**Depends on:** Phase 1 (shared read helpers).
**Done when:** no page imports from `lib/fixtures/restaurants.ts` or `lib/fixtures/menu.ts`.

---

## Phase 3 — Fixture purge

- Delete `FIXTURE_CUSTOMER`, `FIXTURE_MANAGER`, `FIXTURE_ADMIN` from `src/lib/session.ts`
- Delete `src/lib/fixtures/*` (restaurants, menu, customer, orders, billing, admin)
- Grep proves zero remaining imports

**Depends on:** Phases 1–2.
**Done when:** `rg "FIXTURE_|lib/fixtures" src` returns nothing.

---

## Phase 4 — Payments completion

- Resolve `TODO(0005)` in `src/app/api/webhooks/camerpay/route.ts:96` — record into `payment_webhook_events`
- Verify the single idempotent confirm path is shared by webhook + admin manual confirm (no second activation path)
- Verify `(manager)/m/billing/pay/[id]` and status polling pages are wired end to end

**Depends on:** none (can run parallel to Phases 1–3).
**Done when:** replaying the same signed webhook credits once; unknown status maps to `pending`.

---

## Phase 5 — Hardening & production readiness

- Add Vitest (package.json currently has no test framework) and port the 7 hard rules from dev.md §3 as tests
- RLS assertion in CI: any `public` table with `rowsecurity = false` fails the build
- Verify real credentials: Supabase project keys, CamerPay, email sending domain (nodemailer/Resend)
- Loading/error boundaries + empty states across route groups
- `npm run lint` and `npm run build` green

**Depends on:** Phases 1–4.
**Done when:** full order → kitchen → delivered → commission path passes end to end on real data; build + lint clean.