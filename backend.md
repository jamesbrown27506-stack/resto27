# RestoLink — Backend work, by actor

Companion to [dev.md](dev.md) (phases) and [frontend.md](frontend.md) (screens). This document enumerates the **server-side work each actor requires**, so the fixture-backed UI can be wired one actor at a time.

Written in actor order. This file currently covers **Guest**; the other four follow the same shape.

---

# 1. Guest

**Who:** an unauthenticated visitor. No account, no session, no tenant. §2 gives them a row in the actor table precisely because they are not "a logged-out customer" — they are the largest population on the site and the only one who converts.

**The non-obvious part:** *guests have a cart.* §2 is emphatic — *"forcing registration before someone can see a total is the single biggest drop-off point in food ordering."* That single sentence is most of the backend work below.

## 1.1 Surfaces a guest can reach

| Route | Screen | Access |
|---|---|---|
| `/` | Homepage | A |
| `/restaurants` | Directory | A |
| `/restaurants/[slug]` | Restaurant profile | A |
| `/pricing` | Plans | A |
| `/contact` | Support form | A |
| `/privacy`, `/terms` | Legal | A |
| `/robots.txt`, `/sitemap.xml` | Generated | A |
| `/cart` | **Basket — works signed out** | A |
| `/login`, `/register`, `/register/restaurant`, `/forgot-password`, `/reset-password/[token]`, `/invite/[token]` | Auth | A |

Auth is **built**. Everything else below is not.

---

## 1.2 Reads — 10 items

| # | Item | Tables | Notes |
|---|---|---|---|
| **G1** | **Restaurant directory** — text search, quartier, cuisine, sort by rating; `status = 'active'` only | `restaurants`, `service_areas` | Search needs `pg_trgm` + GIN (§16). `LIKE '%x%'` will not hold up |
| **G2** | **Restaurant detail by slug** — profile, delivery settings, branch label | `restaurants` | 404 on `pending`/`suspended`, not a redirect — a suspended tenant's page must not confirm it exists |
| **G3** | **Opening hours → open right now** | `restaurant_hours`, `service_areas` | Computed in `Africa/Douala`, not server-local. **See the caching note in §1.6 — this is the item that decides whether the directory can be static** |
| **G4** | **Menu tree** — categories → items → option groups → options | `categories`, `menu_items`, `menu_item_option_groups`, `menu_item_options` | Two-level options (§3). Respect `is_available` and `track_stock`/`stock_quantity` |
| **G5** | **Reviews + rating aggregate** | `reviews` | Exclude removed and reported-pending. `restaurants.rating` is denormalised — decide whether it is trigger-maintained or recomputed |
| **G6** | **Featured restaurants** (homepage) | `restaurants` | ⚠️ **"Featured" is undefined in the spec.** See §1.7 |
| **G7** | **Popular dishes** (homepage) | `order_items`, `orders`, `menu_items` | Aggregate over **delivered** orders only. The one guest query that grows with order volume — cache or materialise it |
| **G8** | **Plans for `/pricing`** | `subscription_plans` | §14.1: *rendered from the plans table, not hardcoded* — advertised limits must equal enforced limits |
| **G9** | **Branding + platform settings** | `settings` | Name, tagline, logo, favicon, service-charge %. `lib/branding` + `lib/settings` (§15). Cached key/value |
| **G10** | **Service areas / quartiers** for the filters | `service_areas` | Also gates whether a city is accepting signups |

## 1.3 Writes — 3 items

| # | Item | Tables | Rules that are easy to miss |
|---|---|---|---|
| **G11** | **Contact form** | `support_messages`, `rate_limits` | CSRF, honeypot, **per-IP rate limit** (§9). Feeds `/a/support` |
| **G12** | **Guest cart** — add, update quantity, remove, read | `cart_items` | `options_hash` fingerprints the chosen options so *"Pizza, large, extra cheese"* and *"Pizza, small"* are two lines, not quantity 2 of one (§3). Storage decision in §1.5 |
| **G13** | **Cart merge on sign-in** | `cart_items` | The whole point of G12. Runs on login **and** on registration. Needs a rule for the collision case — see §1.5 |

## 1.4 Generated endpoints — 2 items

| # | Item | Notes |
|---|---|---|
| **G14** | `robots.txt` | Real host from the request (§11), private areas disallowed |
| **G15** | `sitemap.xml` | **Every active restaurant, live.** A newly approved tenant must appear without a deploy |

## 1.5 The one real design decision: where the guest cart lives

§2 says the cart *"lives in the session and merges into the account on sign-in."* In PHP that meant a PHP session. There is no equivalent here, so pick one:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Cookie-scoped cart rows** | Issue an opaque `cart_token` cookie; `cart_items.cart_token` holds it. Merge on sign-in, then delete the guest rows | No junk in `auth.users`. Survives device restarts. Cart is server-side, so totals are computed by `lib/orders/totals` and never trusted from the client | Needs a sweeper for abandoned carts. One more identity concept |
| **B. Supabase anonymous sign-in** | `signInAnonymously()` gives every guest a real `auth.uid()` | RLS "own cart" policies are trivial. Merging is an identity link | **Writes a row to `auth.users` for every visitor**, including bots. Pollutes the table our whole identity model hangs off |
| **C. localStorage only** | What the fixture UI does today | Zero backend | Totals computed client-side and therefore untrustworthy; cart lost across devices; nothing to merge server-side. Contradicts `cart_items` existing in the schema at all |

**Recommendation: A.** B looks elegant until `auth.users` has 50 000 bot rows and every admin query over users has to filter them out. C cannot be right — if the client computes the total, the "one money function" (§4) is not the one money function.

**Whichever you pick, the merge needs a stated collision rule.** A guest with 2× Poulet DG signs in, and the account already has 1× Poulet DG with identical options — same `options_hash`. Sum to 3, or keep the larger? Sum is the friendlier default, but it must be a decision rather than whatever the first `INSERT` happens to do.

## 1.6 Cross-cutting — 4 items

| # | Item | Notes |
|---|---|---|
| **G16** | **Rate limiting** | `rate_limits` (key + IP + timestamp). Guests hit login, registration, password reset and contact — every unauthenticated write endpoint (§9) |
| **G17** | **RLS read policies for `anon`** | Even with `public` off the Data API, these are the deny-by-default backstop (B.1). Scope tightly: active restaurants, their menus, their non-removed reviews. Nothing else |
| **G18** | **Base URL derived from the request** | §11. A stale constant fails uniquely confusingly — homepage loads, every link 404s. Needed by G14, G15 and every email |
| **G19** | **Server-side money and time formatting** | XAF as `integer` minor units, rendered `Africa/Douala`. Already exists client-side; the server must agree or the receipt and the page disagree |

### The caching constraint worth deciding early

**G3 makes the directory time-dependent.** "Open now" changes without any write to the database, so `/restaurants` and `/restaurants/[slug]` cannot be fully static. Three ways out:

1. Render open/closed **on the client** from hours shipped with the page — pages stay static, one small hydration cost.
2. `revalidate: 300` on the route — simple, but up to five minutes of showing "open" to someone about to be disappointed.
3. Fully dynamic — correct, most expensive, and these are the highest-traffic pages on the site.

I would take **1**: the hours are already in the payload, and it keeps the two most-visited pages static.

## 1.7 Open questions

| # | Question | Blocks |
|---|---|---|
| 1 | **What makes a restaurant "featured"?** The spec never says. Options: highest rating with a review-count floor, an admin flag on `restaurants`, or paid placement. The third is a revenue decision, not a technical one | G6 |
| 2 | **Is `restaurants.rating` trigger-maintained or recomputed on read?** Denormalised in the schema; a review write must update it somewhere | G5 |
| 3 | **Cart merge collision rule** — sum or max? | G13 |
| 4 | **Abandoned-cart retention** — how long before guest carts are swept? | G12 |

## 1.8 What a guest must NOT be able to do

Negative requirements, because these are the actual security surface — and every one is a query that has to filter, not a feature to build.

- See `pending` or `suspended` restaurants anywhere: directory, detail, sitemap, search.
- See removed or under-moderation reviews.
- Learn whether an email is registered. `/forgot-password` **always reports success** (§14.2) — already built, but G11's contact form must not reintroduce the oracle.
- Read another guest's cart. If you take option A, `cart_token` must be opaque and unguessable — it is a bearer token in everything but name.
- Reach any `/m/*` or `/a/*` route, or any Server Action behind them. The proxy redirects, but **the page must re-check** — a Server Action invoked directly never passes through the proxy.
- Influence a total. Prices, discounts and the service charge come from the database via `lib/orders/totals`; nothing about money is accepted from the client.

## 1.9 Build phases

Each phase ends with something you can look at. Fixtures are retired as they are replaced — never deleted ahead of a replacement, or the build breaks.

### Phase 0 — Clean slate · ~30 min

Nothing is built. This is the purge.

- Delete test accounts: `diag-probe-8842@example.com`, the personal test account, and anything else under **Authentication → Users**.
- Run [0002_backfill_profiles.sql](supabase/migrations/0002_backfill_profiles.sql) §1 — expect zero rows.
- Confirm `0001_auth_profiles.sql` is applied: `public.profiles` exists and is empty.

**Done when:** `auth.users` and `public.profiles` are both empty, and signing up creates exactly one row in each.

**Not touched:** `src/lib/fixtures/*`. Still load-bearing for 68 screens.

---

### Phase G1 — Schema for the guest slice · ~2 h

13 of the 41 tables — the ones a guest reads or writes.

| Group | Tables |
|---|---|
| Platform | `settings`, `service_areas`, `subscription_plans` |
| Tenants | `restaurants`, `restaurant_hours` |
| Menu | `categories`, `menu_items`, `menu_item_option_groups`, `menu_item_options` |
| Guest-owned | `cart_items`, `support_messages`, `rate_limits` |
| Public content | `reviews` |

Plus: money as `integer` XAF, `timestamptz` everywhere, `text` + `CHECK` instead of enums, `pg_trgm` + GIN on the restaurant search columns, and **RLS enabled on every table with deny-by-default** (B.1).

Seed in two parts:
- **Platform data** — settings, service areas, three plans. Real, permanent.
- **Three restaurants with menus** — temporary scaffolding so the public pages have something to render. Replaced by manager CRUD later, and labelled in the seed file so it is obvious what to delete.

**Done when:** all 13 tables exist, `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity` returns 0, and the seed rows are visible in the Table Editor.

---

### Phase G2 — Data access layer · ~1 h

- Drizzle wired to both connection strings — 6543 pooled for runtime with `prepare: false`, 5432 direct for migrations (B.5).
- Schema files under `db/schema/`, one per domain.
- `lib/settings` (cached key/value) and `lib/branding` (name, tagline, logo, favicon) — §15.
- Server-side XAF and `Africa/Douala` formatting, matching the client formatters exactly.

**Done when:** the header brand name comes from the `settings` table, and changing that row changes every page.

**Fixtures retired:** none yet.

---

### Phase G3 — Directory and restaurant detail · ~2 h

Reads **G1–G5**.

- `/restaurants` — text search via `pg_trgm`, quartier and cuisine filters, sort by rating, active tenants only.
- `/restaurants/[slug]` — profile, hours, full menu tree with two-level options, reviews and rating.
- 404 for `pending` and `suspended` — not a redirect.
- Open/closed computed client-side from hours in the payload, so both pages stay static.

**Done when:** both pages render from Postgres and neither file imports a fixture.

**Fixtures retired:** `restaurants.ts` and `menu.ts` stop being used by the public routes.

---

### Phase G4 — Homepage · ~1.5 h

Reads **G6–G8, G10**.

- Featured restaurants (see the open question in §1.7 — needs a rule).
- Popular dishes — aggregate over **delivered** order items only.
- Pricing cards from `subscription_plans`, so advertised limits equal enforced limits.
- Quartier and cuisine lists for the hero search.

**Done when:** the homepage imports zero fixtures.

---

### Phase G5 — Guest cart · ~2.5 h

Writes **G12–G13**. The biggest phase, and the only stateful thing a guest owns.

- Opaque `cart_token` cookie; `cart_items` rows keyed to it.
- Add / update quantity / remove, with `options_hash` so option variants are separate lines.
- **Totals computed server-side by `lib/orders/totals`** — nothing about money is accepted from the client.
- Merge into the account on sign-in *and* on registration, summing quantities on an `options_hash` collision.
- Sweeper for abandoned carts.

**Done when:** a signed-out visitor builds a cart, signs in, and finds it intact with the same totals.

**Fixtures retired:** the seeded cart in `cart-provider.tsx`.

---

### Phase G6 — Contact form and rate limiting · ~1 h

Writes **G11**, cross-cutting **G16**.

- `/contact` → `support_messages`, with CSRF and a honeypot.
- `rate_limits` table plus the shared limiter, applied to contact, login, registration and password reset.

**Done when:** submitting the form twice in quick succession is refused, and the message appears in `support_messages`.

---

### Phase G7 — SEO endpoints · ~45 min

**G14–G15**, cross-cutting **G18**.

- `robots.txt` and `sitemap.xml` generated from the database.
- Base URL derived from the request, never from a constant.

**Done when:** activating a restaurant makes it appear in `sitemap.xml` with no deploy.

---

### Totals

**~11 hours across 8 phases.** At the end, every guest-reachable page runs on Postgres, and `lib/fixtures/restaurants.ts` and `menu.ts` survive only for the manager and admin screens — where they die as those actors are wired.

---

## 1.10 Totals

**19 work items** — 10 reads, 3 writes, 2 generated endpoints, 4 cross-cutting.

Against [dev.md](dev.md): G9, G16, G19 belong to **P2**; G17 to **P1**; the rest are **P14** (public site), with G12/G13 landing in **P10** alongside the cart UI.

Nothing here is hard in the way §12's seven rules are hard. The two that will take longest are **G7** (an aggregate that grows with the business) and **G12/G13** (the only stateful thing a guest owns).
