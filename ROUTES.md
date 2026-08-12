# RestoLink — Route index

**Dev server: http://localhost:3000** — already running (PID 22408).
To restart it: `taskkill /PID 22408 /F` then `npm run dev`.

> ⚠️ **The admin area is `/a`, not `/admin`.** Likewise the manager area is `/m`, not `/manager`. Short prefixes are what §14.4 and §14.5 specify — they're typed dozens of times a day by staff.

Everything reads fixtures, so no sign-in is required — **every screen below is directly reachable by URL**, including the manager and admin areas. Auth gating arrives in P3.

Two controls sit in the header on every public page: **FR / EN** and the **light/dark switch**.

---

## Quick jump — the three dashboards

| Dashboard | URL | Who it's for |
|---|---|---|
| **Customer** | http://localhost:3000/account | Diners |
| **Manager** | http://localhost:3000/m | Restaurant staff |
| **Admin** | http://localhost:3000/a | Platform operators |

The three screens most worth looking at first:

- **Kitchen display** — http://localhost:3000/m/kitchen (full-bleed, forced dark, escapes the shell)
- **Order detail** — http://localhost:3000/orders/o_2 (live status timeline; the busiest page in the app)
- **Commissions** — http://localhost:3000/a/commissions (snapshotted rates, issued rows locked)

---

## 1. Public — 7 screens

| Screen | URL |
|---|---|
| Homepage | http://localhost:3000/ |
| Restaurant directory | http://localhost:3000/restaurants |
| Restaurant profile | http://localhost:3000/restaurants/chez-marcel-akwa |
| Second branch of the same tenant | http://localhost:3000/restaurants/chez-marcel-bonapriso |
| Other tenants | `/restaurants/le-ndole-dor` · `/restaurants/mami-nyanga` · `/restaurants/la-terrasse-bonamoussadi` · `/restaurants/poisson-braise-deido` |
| Pricing | http://localhost:3000/pricing |
| Contact | http://localhost:3000/contact |
| Privacy | http://localhost:3000/privacy |
| Terms | http://localhost:3000/terms |

Generated, not screens: http://localhost:3000/robots.txt · http://localhost:3000/sitemap.xml

---

## 2. Auth — 6 screens

| Screen | URL |
|---|---|
| Sign in | http://localhost:3000/login |
| Customer sign-up | http://localhost:3000/register |
| Restaurant application (4 steps) | http://localhost:3000/register/restaurant |
| Forgot password | http://localhost:3000/forgot-password |
| Reset password | http://localhost:3000/reset-password/abc123 |
| Accept staff invite | http://localhost:3000/invite/abc123 |

**State variants** — these branches are otherwise only reachable by getting the server to produce them:

| Variant | URL |
|---|---|
| Login — bad credentials | http://localhost:3000/login?reason=invalid |
| Login — account pending | http://localhost:3000/login?reason=pending |
| Login — restaurant awaiting approval | http://localhost:3000/login?reason=pending-manager |
| Login — suspended | http://localhost:3000/login?reason=suspended |
| Reset link expired | http://localhost:3000/reset-password/expired |
| Invite expired | http://localhost:3000/invite/expired |
| Invite — email already has an account | http://localhost:3000/invite/existing |

---

## 3. Customer — 14 screens

| Screen | URL |
|---|---|
| Dashboard | http://localhost:3000/account |
| Browse (signed in, with favourites) | http://localhost:3000/browse |
| Order from a restaurant | http://localhost:3000/browse/chez-marcel-akwa |
| Cart | http://localhost:3000/cart |
| Checkout | http://localhost:3000/checkout |
| Order history | http://localhost:3000/orders |
| Order detail | http://localhost:3000/orders/o_2 |
| Reservations | http://localhost:3000/reservations |
| Favourites | http://localhost:3000/favorites |
| Addresses | http://localhost:3000/addresses |
| Loyalty | http://localhost:3000/loyalty |
| My reviews | http://localhost:3000/reviews |
| Profile | http://localhost:3000/profile |
| Settings | http://localhost:3000/settings |

**Order states to compare** — every stage of the lifecycle has a fixture:

| State | URL |
|---|---|
| Pending, delivery fee not yet quoted | http://localhost:3000/orders/o_1 |
| Preparing (promo applied) | http://localhost:3000/orders/o_2 |
| Confirmed, dine-in | http://localhost:3000/orders/o_3 |
| Out for delivery | http://localhost:3000/orders/o_4 |
| Delivered (review + rating available) | http://localhost:3000/orders/o_5 |
| Cancelled | http://localhost:3000/orders/o_6 |

Try `/browse/chez-marcel-akwa` → tap **Poulet DG** to see the two-level modifier sheet (required size, capped extras, price deltas), then `/cart`.

---

## 4. Manager — 21 screens

Active branch is **Chez Marcel — Akwa** (owner role). The branch switcher in the sidebar swaps to **Bonapriso**, where the same person is only a *manager* and the subscription is in **grace** — the two-level permission model, visible.

| Screen | URL |
|---|---|
| Dashboard | http://localhost:3000/m |
| Order queue | http://localhost:3000/m/orders |
| Order detail | http://localhost:3000/m/orders/o_2 |
| **Kitchen display** | http://localhost:3000/m/kitchen |
| Thermal ticket (80 mm, auto-prints) | http://localhost:3000/m/orders/o_2/ticket |
| Table-side ordering | http://localhost:3000/m/table-order |
| Menu | http://localhost:3000/m/menu |
| Modifiers for a dish | http://localhost:3000/m/menu/m_1/modifiers |
| Categories | http://localhost:3000/m/categories |
| Tables | http://localhost:3000/m/tables |
| Reservations | http://localhost:3000/m/reservations |
| Promotions | http://localhost:3000/m/promotions |
| Customers | http://localhost:3000/m/customers |
| Reviews | http://localhost:3000/m/reviews |
| Reports (plan-gated) | http://localhost:3000/m/reports |
| Staff | http://localhost:3000/m/staff |
| Billing | http://localhost:3000/m/billing |
| Invoice | http://localhost:3000/m/billing/invoices/inv_1 |
| **Mobile-money payment** | http://localhost:3000/m/billing/pay/inv_3 |
| Restaurant profile | http://localhost:3000/m/profile |
| Settings | http://localhost:3000/m/settings |

**Things to try here:**

- `/m/orders` → advance order **RL-2408-0147**. A delivery order *cannot* reach "confirmed" without the fee dialog — §4 enforced in the UI, not just documented.
- `/m/billing/pay/inv_3` → enter any number and pay. The waiting state has **success / refusal / timeout** buttons so all three outcomes are reachable. Read the timeout copy: it deliberately does not claim failure.
- `/m/kitchen` → tickets turn amber at 15 min and red at 25 min.
- Sidebar → **switch branch** → Bonapriso, to see the grace-period banner and a reduced capability set.

---

## 5. Admin — 20 screens

| Screen | URL |
|---|---|
| Dashboard | http://localhost:3000/a |
| Restaurants (approve / suspend) | http://localhost:3000/a/restaurants |
| Users | http://localhost:3000/a/users |
| Subscriptions | http://localhost:3000/a/subscriptions |
| Plan builder | http://localhost:3000/a/plans |
| Payments | http://localhost:3000/a/payments |
| Commissions | http://localhost:3000/a/commissions |
| Refunds | http://localhost:3000/a/refunds |
| Broadcast | http://localhost:3000/a/broadcast |
| Review moderation | http://localhost:3000/a/reviews |
| Analytics | http://localhost:3000/a/analytics |
| Support inbox | http://localhost:3000/a/support |
| Notifications | http://localhost:3000/a/notifications |
| Audit log | http://localhost:3000/a/audit |
| Service areas | http://localhost:3000/a/areas |
| Impersonation | http://localhost:3000/a/impersonate |
| CSV export | http://localhost:3000/a/export |
| Diagnostics | http://localhost:3000/a/diagnostics |
| Health checks | http://localhost:3000/a/tests |
| Platform settings | http://localhost:3000/a/settings |

Machine endpoint: http://localhost:3000/a/health (JSON — includes `lastReconcilerRun`)

**Things to try here:**

- `/a/restaurants` → **Eru House** is pending approval.
- `/a/subscriptions` → four states side by side: active, grace, locked, and one with **no end date** (never expires).
- `/a/users` → creating an administrator requires typing `CREER ADMIN`; anonymising requires typing `ANONYMISER`.
- `/a/audit` → there is no edit or delete control anywhere, and one row records both actor *and* impersonator.
- `/a/settings` → **Facturation** tab → toggle free mode.

---

## 6. Not a route — dev tool

| | URL |
|---|---|
| Living style guide (all tokens + primitives, both themes) | http://localhost:3000/styleguide |

---

## Language coverage

| Surface | FR | EN |
|---|:--:|:--:|
| Header, footer, nav, skip link | yes | yes |
| Hero (all 3 slides) | yes | yes |
| Homepage — every section | yes | yes |
| Pricing cards | yes | yes |
| Auth shell + sign-in | yes | yes |
| Restaurant directory | yes | partial |
| Customer / manager / admin screens | yes | **still French** |

The i18n machinery is in place — `lib/i18n/dictionaries.ts` plus `useLocale()`. Extending coverage is adding key/value pairs and swapping literals for `t("…")`, not a refactor. The back-office was left for last on purpose: it is roughly 50 screens of dense copy, and its audience is far more likely to be francophone than the public marketplace is.
