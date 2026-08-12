# RestoLink — Frontend Specification

Companion to [dev.md](dev.md). This document is the **complete screen inventory and file structure** for the front end. It covers what gets built and where it lives; [dev.md](dev.md) covers when, and [explanation.md](explanation.md) covers why.

**Approach:** every screen is built against **typed fixtures** (`lib/fixtures/*.ts`) shaped exactly like the P1 Drizzle rows. A page reads `getOrders()` from a fixture module today and from a real query tomorrow — one import changes, the JSX does not. This is what makes frontend-first recoverable instead of a rewrite.

---

## 1. The count

**78 routes** (§14) = **68 screens** + **10 non-visual endpoints**.

| Area | Screens | Non-visual | Total | Shell |
|---|---:|---:|---:|---|
| Public | 7 | 2 | 9 | `(public)` |
| Auth | 6 | 1 | 7 | `(auth)` |
| Customer | 14 | 1 | 15 | `(customer)` |
| Manager | 21 | 2 | 23 | `(manager)` |
| Admin | 20 | 1 | 21 | `(admin)` |
| Machine | 0 | 3 | 3 | none |
| **Total** | **68** | **10** | **78** | 5 shells |

The 10 non-visual: `robots.txt`, `sitemap.xml`, `/logout`, `/api/orders/[id]/status`, `/m/branch/switch`, `/api/payments/[ref]/status`, `/a/health`, `POST /api/webhooks/sebpay`, `/api/cron/reconcile`, `/api/cron/expire`.

---

## 2. Every screen

Density column: **L** = full page layout, **M** = table/list + modals, **S** = form or simple view. This is your effort estimate.

### 2.1 Public — 7 screens · shell: marketing header + full footer

| # | Route | Screen | Density | Key UI |
|---|---|---|---|---|
| 1 | `/` | Homepage | **L** | Hero + search card, featured restaurants, popular dishes, how-it-works, testimonials, pricing summary, FAQ, CTA banner |
| 2 | `/restaurants` | Directory | **M** | Filter bar (text, city, cuisine, sort by rating), restaurant card grid, empty state, pagination |
| 3 | `/restaurants/[slug]` | Restaurant profile | **L** | Cover + logo header, menu by category, hours table, review list, "Order" / "Book a table" CTAs |
| 4 | `/pricing` | Plans | **M** | 3 plan cards **rendered from the plans table**, comparison table, FAQ |
| 5 | `/contact` | Contact | **S** | Form + honeypot, contact details, map placeholder |
| 6 | `/privacy` | Privacy | **S** | Long-form legal, table of contents |
| 7 | `/terms` | Terms | **S** | Long-form legal, table of contents |

### 2.2 Auth — 6 screens · shell: centred card, split-panel on desktop

| # | Route | Screen | Density | Key UI |
|---|---|---|---|---|
| 8 | `/login` | Sign in | **S** | Email + password, remember-me, **four distinct error states**: invalid / pending / pending-manager / suspended |
| 9 | `/register` | Customer sign-up | **S** | Name, email, phone, password + strength meter |
| 10 | `/register/restaurant` | Restaurant application | **M** | Multi-step: owner → restaurant → location/hours → review. Ends on a **"pending approval"** confirmation screen |
| 11 | `/forgot-password` | Request reset | **S** | Email only. **Always shows the same success state** |
| 12 | `/reset-password/[token]` | Set new password | **S** | Password + confirm, plus an expired-token state |
| 13 | `/invite/[token]` | Accept staff invite | **S** | Shows restaurant + branch role, **invitee sets their own password**, expired/already-used states |

### 2.3 Customer — 14 screens · shell: slim header + cart badge, sidebar on account pages

| # | Route | Screen | Density | Key UI |
|---|---|---|---|---|
| 14 | `/account` | Dashboard | **M** | Recent orders, upcoming reservations, loyalty balance card, favourites strip |
| 15 | `/browse` | Directory (signed in) | **M** | Same as `/restaurants` + favourite hearts |
| 16 | `/browse/[slug]` | Menu + order | **L** | Category nav, dish grid, **modifier picker sheet** (radio for required single, checkbox for multi, live price delta), sticky cart bar |
| 17 | `/cart` | Cart | **M** | Line items with `options_label`, qty steppers, promo code, loyalty slider, totals panel. **Works signed out** |
| 18 | `/checkout` | Checkout | **L** | Delivery/pickup toggle, address picker + new-address inline, schedule, payment method, notes, order summary. **"Delivery fee quoted on confirmation"** |
| 19 | `/orders` | Order history | **M** | Status filter chips, order cards, reorder button |
| 20 | `/orders/[id]` | Order detail | **L** | **Busiest page in the app.** Live status timeline, receipt, cancel, reorder, review form, manager reply, delivery rating |
| 21 | `/reservations` | Reservations | **M** | Booking form with availability check, upcoming/past lists, cancel |
| 22 | `/favorites` | Favourites | **S** | Restaurant card grid, empty state |
| 23 | `/addresses` | Address book | **M** | Cards with default badge, add/edit sheet, quartier + landmark fields |
| 24 | `/loyalty` | Loyalty | **M** | Balance hero, **full ledger table**, each row linking to its order |
| 25 | `/reviews` | My reviews | **M** | List with edit/delete, star editor |
| 26 | `/profile` | Profile | **S** | Name, phone, avatar upload, change password |
| 27 | `/settings` | Settings | **S** | Notification toggles, theme, **delete account → anonymise, with typed confirmation** |

### 2.4 Manager — 21 screens · shell: sidebar + branch switcher + subscription banner

Every screen is gated **twice** — branch, then capability. The shell renders only nav items the current branch role holds.

| # | Route | Screen | Density | Key UI |
|---|---|---|---|---|
| 28 | `/m` | Dashboard | **L** | Today's orders/revenue tiles, pending reservations, low-stock list, subscription state card |
| 29 | `/m/orders` | Order queue | **L** | Status columns or filter tabs, live-updating rows, **delivery-fee dialog on confirm** |
| 30 | `/m/orders/[id]` | Order detail | **M** | Items with options, status history timeline, record payment, print ticket |
| 31 | `/m/kitchen` | **Kitchen display** | **L** | Full-bleed dark card grid, oldest first, huge type, elapsed timer, one-tap advance. **Read from across a kitchen** |
| 32 | `/m/orders/[id]/ticket` | Thermal ticket | **S** | 80mm print stylesheet, auto-opens print dialog |
| 33 | `/m/table-order` | Table-side ordering | **L** | Table picker, fast menu grid, running ticket panel, send to kitchen |
| 34 | `/m/menu` | Menu | **M** | Category tabs, drag-to-reorder rows, availability toggle, stock badge, image upload, **plan-limit banner** |
| 35 | `/m/menu/[id]/modifiers` | Modifiers | **M** | Group list (min/max/required) → nested option rows with price deltas |
| 36 | `/m/categories` | Categories | **S** | Drag-to-reorder, icon picker |
| 37 | `/m/tables` | Tables | **M** | Grid of table cards, capacity, status, **plan-limit banner** |
| 38 | `/m/reservations` | Reservations | **M** | Day view, approve/decline, assign table, complete |
| 39 | `/m/promotions` | Promotions | **M** | Code list with usage bars, create sheet, **plan-limit banner** |
| 40 | `/m/customers` | Customers | **M** | Table: name, orders, spend, last seen |
| 41 | `/m/reviews` | Reviews | **M** | Review cards, public reply box, report abuse |
| 42 | `/m/reports` | Reports | **L** | Date range picker, sales chart, top dishes, order mix, peak hours. **Plan-gated overlay** |
| 43 | `/m/staff` | Staff | **M** | Staff table with branch-role select, invite-by-email sheet, pending invitations |
| 44 | `/m/billing` | Billing | **L** | Plan card, days remaining, **usage-vs-limit meters**, upgrade/downgrade, invoice list. **Reachable while locked** |
| 45 | `/m/billing/invoices/[id]` | Invoice | **S** | Printable invoice, PDF download |
| 46 | `/m/billing/pay/[id]` | Mobile money payment | **M** | Phone input → **waiting state with "approve on your handset"** → success/failure/timeout. Never assumes success |
| 47 | `/m/profile` | Restaurant profile | **L** | Logo + cover upload, description, hours editor, delivery settings |
| 48 | `/m/settings` | Settings | **S** | Notification preferences |

### 2.5 Admin — 20 screens · shell: dark sidebar + impersonation banner slot

| # | Route | Screen | Density | Key UI |
|---|---|---|---|---|
| 49 | `/a` | Dashboard | **L** | Platform KPI tiles, pending approvals queue, reported reviews, expiring subscriptions |
| 50 | `/a/restaurants` | Tenants | **M** | Table with status filters, approve/reject/suspend/reinstate, detail drawer |
| 51 | `/a/users` | Users | **M** | Table, suspend, anonymise, **create-admin flow with typed confirmation** |
| 52 | `/a/subscriptions` | Subscriptions | **M** | Table: tenant, plan, state (active/grace/locked), expiry, manual extend |
| 53 | `/a/plans` | **Plan builder** *(new)* | **M** | Plan rows with price, limits, commission %, feature flags, active toggle |
| 54 | `/a/payments` | Payments | **M** | Attempt table with state, **manual confirm dialog**, provider payload viewer |
| 55 | `/a/commissions` | Commissions | **L** | Period picker, generate, per-restaurant table, issue/settle/write-off, **issued rows read-only** |
| 56 | `/a/refunds` | Refunds | **M** | Refund/chargeback list, create-refund form |
| 57 | `/a/broadcast` | Broadcast | **M** | Audience picker (all managers / all customers / a plan / an area), composer, recipient count preview |
| 58 | `/a/reviews` | Moderation | **M** | Reported review cards, dismiss or remove. **No edit control anywhere** |
| 59 | `/a/analytics` | Analytics | **L** | Growth, revenue, order volume, top tenants — charts |
| 60 | `/a/support` | Support inbox | **M** | Two-pane: thread list + reply, resolve |
| 61 | `/a/notifications` | Notifications | **S** | The admin's own feed |
| 62 | `/a/audit` | Audit log | **M** | Filterable table, actor/impersonator columns, JSON diff drawer. **No mutation controls** |
| 63 | `/a/areas` | Service areas | **M** | City, country, currency, timezone, accepting-signups toggle |
| 64 | `/a/impersonate` | Impersonation | **S** | Tenant picker + confirm. Starts the **undismissable banner** |
| 65 | `/a/export` | CSV export | **S** | 8 report cards with date range + download |
| 66 | `/a/diagnostics` | Diagnostics | **M** | Run-check cards: ping gateway, fire signed webhook, send real email — with live results |
| 67 | `/a/tests` | Health checks | **M** | Passive check list, pass/fail rows |
| 68 | `/a/settings` | Platform settings | **L** | Tabbed: branding, free mode, currency, service charge, loyalty, commission, payments, grace days |

---

## 3. The five shells

Each route group owns a layout. This is what your PHP homepage did not do, and it is the fix.

| Shell | Header | Nav | Footer | Notes |
|---|---|---|---|---|
| `(public)` | Transparent → frosted on scroll | Horizontal + mobile drawer | Full 5-column | Marketing chrome |
| `(auth)` | Logo only | none | Minimal | Split panel: form left, image right on ≥1024px |
| `(customer)` | Slim + **cart badge** + avatar menu | Account sidebar on account pages | Compact | Cart badge is global state |
| `(manager)` | App bar + **branch switcher** + subscription banner | **Capability-filtered sidebar** | none | `/m/kitchen` and `/m/orders/[id]/ticket` **opt out of the shell entirely** |
| `(admin)` | Dark app bar + **impersonation banner slot** | Grouped sidebar | none | Banner is `position: sticky`, undismissable |

**Two screens deliberately escape their shell:** `/m/kitchen` (full-bleed, no chrome, maximum glanceability) and `/m/orders/[id]/ticket` (print-only, 80mm). Give each its own nested layout that renders `{children}` and nothing else.

---

## 4. File structure

```
src/
  app/
    layout.tsx                    root: fonts, theme provider, toaster
    (public)/
      layout.tsx                  marketing header + footer
      page.tsx                    /
      restaurants/page.tsx
      restaurants/[slug]/page.tsx
      pricing/page.tsx
      contact/page.tsx
      privacy/page.tsx
      terms/page.tsx
    (auth)/
      layout.tsx                  split panel
      login/page.tsx
      register/page.tsx
      register/restaurant/page.tsx
      forgot-password/page.tsx
      reset-password/[token]/page.tsx
      invite/[token]/page.tsx
    (customer)/
      layout.tsx                  slim header + cart badge
      account/page.tsx
      browse/page.tsx
      browse/[slug]/page.tsx
      cart/page.tsx
      checkout/page.tsx
      orders/page.tsx
      orders/[id]/page.tsx
      reservations/page.tsx
      favorites/page.tsx
      addresses/page.tsx
      loyalty/page.tsx
      reviews/page.tsx
      profile/page.tsx
      settings/page.tsx
    (manager)/
      layout.tsx                  sidebar + branch switcher + sub banner
      m/page.tsx
      m/orders/page.tsx
      m/orders/[id]/page.tsx
      m/orders/[id]/ticket/
        layout.tsx                ← escapes the shell, print stylesheet
        page.tsx
      m/kitchen/
        layout.tsx                ← escapes the shell, full-bleed
        page.tsx
      m/table-order/page.tsx
      m/menu/page.tsx
      m/menu/[id]/modifiers/page.tsx
      m/categories/page.tsx
      m/tables/page.tsx
      m/reservations/page.tsx
      m/promotions/page.tsx
      m/customers/page.tsx
      m/reviews/page.tsx
      m/reports/page.tsx
      m/staff/page.tsx
      m/billing/page.tsx
      m/billing/invoices/[id]/page.tsx
      m/billing/pay/[id]/page.tsx
      m/profile/page.tsx
      m/settings/page.tsx
    (admin)/
      layout.tsx                  dark sidebar + impersonation banner
      a/page.tsx
      a/restaurants/page.tsx
      a/users/page.tsx
      a/subscriptions/page.tsx
      a/plans/page.tsx
      a/payments/page.tsx
      a/commissions/page.tsx
      a/refunds/page.tsx
      a/broadcast/page.tsx
      a/reviews/page.tsx
      a/analytics/page.tsx
      a/support/page.tsx
      a/notifications/page.tsx
      a/audit/page.tsx
      a/areas/page.tsx
      a/impersonate/page.tsx
      a/export/page.tsx
      a/diagnostics/page.tsx
      a/tests/page.tsx
      a/settings/page.tsx
    api/…                         (P5/P6 — no UI)
    robots.ts                     Next metadata route
    sitemap.ts                    Next metadata route

  components/
    ui/                           shadcn primitives (button, input, dialog, …)
    layout/
      site-header.tsx  site-footer.tsx  mobile-drawer.tsx
      manager-sidebar.tsx  admin-sidebar.tsx
      branch-switcher.tsx  subscription-banner.tsx  impersonation-banner.tsx
    marketing/
      hero.tsx  hero-search-card.tsx  stat-strip.tsx  feature-row.tsx
      step-list.tsx  testimonial-grid.tsx  pricing-grid.tsx  faq.tsx  cta-banner.tsx
    restaurant/
      restaurant-card.tsx  restaurant-grid.tsx  restaurant-filters.tsx
      hours-table.tsx  review-list.tsx  rating-stars.tsx
    menu/
      dish-card.tsx  menu-category-nav.tsx  modifier-sheet.tsx  stock-badge.tsx
    cart/
      cart-line.tsx  cart-summary.tsx  cart-badge.tsx  qty-stepper.tsx
      promo-input.tsx  loyalty-redeem.tsx
    order/
      order-card.tsx  order-status-timeline.tsx  order-status-badge.tsx
      kitchen-ticket-card.tsx  receipt.tsx  delivery-fee-dialog.tsx
    billing/
      plan-card.tsx  usage-meter.tsx  invoice-table.tsx
      momo-payment-flow.tsx  lock-notice.tsx
    data/
      data-table.tsx  filter-bar.tsx  pagination.tsx  empty-state.tsx
      stat-tile.tsx  date-range-picker.tsx  confirm-dialog.tsx  typed-confirm.tsx
    charts/
      sales-chart.tsx  volume-chart.tsx  mix-chart.tsx

  lib/
    fixtures/                     ← typed mock data, one file per domain
      restaurants.ts  menu.ts  orders.ts  users.ts  billing.ts  admin.ts
    format/
      currency.ts                 XAF, integer in, "12 500 FCFA" out
      datetime.ts                 timestamptz in, Africa/Douala out
      order-status.ts             label + colour per state
    hooks/
      use-cart.ts  use-media-query.ts  use-toast.ts
    capabilities.ts               the 20 × 5 matrix, client-safe copy for nav
    nav.ts                        sidebar definitions keyed by capability

  styles/
    tokens.css                    design tokens (below)
```

---

## 5. Design system — from your homepage

Your palette and type pairing carry over unchanged. They are good: the sage/cream/tan reads as *restaurant*, not as *generic SaaS*, and Playfair over Inter gives the display voice without costing legibility.

```css
/* styles/tokens.css */
:root {
  /* Core — preserved from index.php */
  --primary:        #5F7257;   /* sage */
  --primary-dark:   #3D4F38;
  --primary-light:  #EFF5EE;
  --primary-accent: #D4A373;   /* tan */
  --accent-dark:    #B07D4E;
  --bg:             #F7F4ED;   /* cream */
  --bg-white:       #FFFFFF;
  --border:         #E4DDD0;
  --text:           #1C1C1C;
  --text-secondary: #5A5A52;
  --text-light:     #9A9488;
  --error:          #E04848;

  /* ADDED — the original has no semantic states beyond error */
  --success:        #4A7C59;
  --warning:        #C98A3C;   /* grace-period banners */
  --info:           #4A6E8A;

  --font-display: 'Playfair Display', Georgia, serif;
  --font-body:    'Inter', system-ui, sans-serif;

  --r-sm: 6px; --r-md: 12px; --r-lg: 20px; --r-xl: 32px; --r-full: 9999px;
  --shadow-sm: 0 2px 8px rgba(0,0,0,.06);
  --shadow-md: 0 6px 24px rgba(0,0,0,.10);
  --shadow-lg: 0 16px 48px rgba(0,0,0,.14);
  --t: .22s ease;
}
```

### Order-status colours — define once, use in five places

The same state machine renders on `/orders/[id]`, `/m/orders`, `/m/kitchen`, `/a` and every receipt. One map in `lib/format/order-status.ts`:

| State | Colour | Meaning |
|---|---|---|
| `pending` | `--text-light` | Awaiting restaurant |
| `confirmed` | `--info` | Accepted, fee set |
| `preparing` | `--warning` | In the kitchen |
| `shipped` | `--primary` | Out for delivery |
| `delivered` | `--success` | Terminal |
| `cancelled` | `--error` | Terminal |

### Subscription-state colours — the banner users see daily

| State | Treatment |
|---|---|
| `active` | No banner |
| `grace` | `--warning` banner, "Renew by <date>", dismissible per session |
| `locked` | `--error` banner, **undismissable**, links to `/m/billing` |
| `free mode` | `--info` banner, "Free until <date>" |

---

## 6. What I'd change from the PHP version

Your instinct on the design is right. These are delivery problems, not taste problems.

### Must fix

| # | Issue | Why | Fix |
|---|---|---|---|
| 1 | **One 3,959-line self-contained file** with its own `<head>` | §10 calls it the worst structural decision in the codebase. It has already caused branding not applying, missing SEO tags, and a mobile drawer collapsing to a sliver — because every global change has to be made twice | `(public)/layout.tsx` + `components/marketing/*`. The homepage becomes ~120 lines of composition |
| 2 | **Font Awesome via CDN** (`cdnjs`) | Render-blocking stylesheet, ~30KB for maybe 40 icons, plus a third-party dependency on every page load in a market with expensive mobile data | `lucide-react` — tree-shaken, no network request, ~1KB for what you use |
| 3 | **Google Fonts via `<link>`** | Two `preconnect`s and a render-blocking request. Causes a visible font swap | `next/font/google` — self-hosted at build, zero layout shift, no preconnect needed |
| 4 | **No dark mode anywhere** | §15 and `user_preferences` both require it. Retrofitting a theme after 68 screens costs far more than building with it | Tokens as CSS variables under `:root` / `[data-theme="dark"]`, set from `user_preferences` |
| 5 | **`backdrop-filter` containing-block trap** | You already hit this and fixed it with the `::before` workaround — the comment in your file documents it well | Render the drawer through a **portal** to `document.body`. It stops being possible to reintroduce |
| 6 | **Hero autoplay carousel** (3 panels, 5s rotation) | Rotating heroes measurably hurt conversion and inflate LCP — the first paint waits on the largest image, and most users never see panel 2 or 3 | Keep **one** hero. Move the three modes into the search card as **tabs** (Order · Book a table · Explore). Same information, one image, no timer |
| 7 | **No `prefers-reduced-motion` guard** | The blob pulse, autoplay bar and fade-ins run unconditionally. This is a vestibular-trigger issue, not a preference | One global `@media (prefers-reduced-motion: reduce) { animation: none; transition: none; }` |
| 8 | **FAQ `max-height: 200px`** | Any answer taller than 200px is silently clipped mid-sentence | `grid-template-rows: 0fr → 1fr` — animates to true content height |

### Should fix

| # | Issue | Fix |
|---|---|---|
| 9 | FAQ toggles are `div`s | `<button aria-expanded>` — keyboard and screen-reader operable |
| 10 | Cuisine pills are `div`s with an `.active` class | Real `<input type="radio">` in a fieldset, styled. Works without JS, announces state |
| 11 | Mobile drawer has no focus trap or Escape handler | shadcn `Sheet` gives you both |
| 12 | `<img>` for hero and cards | `next/image` — AVIF/WebP, correct sizing, no CLS. **Matters most on Cameroonian mobile data** |
| 13 | Decorative blobs are real DOM nodes with 60px blur | Two large blurs are a real paint cost on mid-range Android. CSS gradient background instead |
| 14 | No skeleton or error states | `loading.tsx` + `error.tsx` per route group — free in App Router |
| 15 | English-only strings | Route every string through one dictionary now. FR is then a data change, not a refactor |

### Keep exactly as-is

- The palette. Sage + cream + tan is genuinely distinctive and reads as hospitality.
- Playfair Display for headings, Inter for body.
- **The floating search card.** It is the right shape for the product, and the comment in your file about *"a restaurant booking widget, not a flight search"* is the correct instinct.
- The `--r-xl: 32px` radius language — soft, warm, consistent.
- `theme-color: #B07D4E` for the mobile browser chrome.
- Your SEO head block: canonical, OG/Twitter, JSON-LD with `areaServed: Cameroon`, and the conditional favicon that avoids 404ing on every hit. All of it ports to Next `metadata` exports almost line for line.

---

## 7. Frontend build order

Component library first — otherwise you build the same table five times.

| # | Stage | Output | Est |
|---|---|---|---|
| **F0** | Tokens, fonts, theme provider, shadcn init, `lib/format/*` | Dark mode toggles, XAF renders, dates render in Douala | 1h |
| **F1** | Shared primitives: `data-table`, `filter-bar`, `stat-tile`, `empty-state`, `confirm-dialog`, `pagination`, `rating-stars`, `order-status-badge` | Storybook-able in isolation | 1.5h |
| **F2** | The 5 shells + navigation + `lib/nav.ts` + `lib/capabilities.ts` | Every route group renders with correct chrome | 1.5h |
| **F3** | Fixtures — `lib/fixtures/*` typed to the P1 schema | Every page has realistic data to render | 1h |
| **F4** | Public 7 + auth 6 | The marketing site is done | 3h |
| **F5** | Customer 14 | Browse → cart → checkout → track works on fixtures | 4h |
| **F6** | Manager 21 | Kitchen display and order queue are the two to get right | 5h |
| **F7** | Admin 20 | Mostly `data-table` + `filter-bar` reuse — fastest if F1 was done properly | 4h |
| **F8** | Responsive + a11y + reduced-motion sweep | Everything works at 375px and via keyboard | 1.5h |

**~22.5 hours.** That is your two days spent entirely on the front end, with zero backend. Worth being explicit about: this delivers 68 rendering screens and **nothing that can take an order or bill anyone** — the wiring in [dev.md](dev.md) P1–P6 still has to happen afterwards.

**If F0–F3 are done well, F4–F7 go roughly 3× faster than if they aren't.** Do not skip F1 to start on the homepage.

---

## 8. Open questions

| # | Question | Blocks |
|---|---|---|
| 1 | **Kitchen display: dark or light?** It escapes the theme system either way — a kitchen screen is glanced at from 3m, often in bright light. I'd go high-contrast dark with very large type | F2, F6 |
| 2 | **FR / EN / both?** Cheap now, expensive at screen 68 | F0 |
| 3 | **Do you have real photography** for the hero, restaurant covers and dishes? Stock food photos are the fastest way to look like a template. If not, plan for a placeholder system that degrades gracefully | F3, F4 |
| 4 | **Mobile-first or desktop-first?** Diners are ~all mobile; managers are ~all desktop or tablet. I'd build `(public)`/`(customer)` mobile-first and `(manager)`/`(admin)` desktop-first | F2 |
| 5 | **Charts library** for `/m/reports` and `/a/analytics`. The PHP used Chart.js from a CDN; Recharts is the natural React choice | F1, F7 |
