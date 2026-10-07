# Resto237 go-live audit — 5 October 2026

## Decision

**Operational status: live and taking payments.** The production site is reachable and the database records three succeeded CamerPay attempts. The owner also reports that payment is working in use. Zero recorded webhook deliveries does **not** establish a payment failure; polling or reconciliation can complete payments. The privacy wording was corrected and verified on the live site. Production email mode and links still need an authenticated check before a clean public-launch sign-off. Callback delivery is a resilience and monitoring follow-up. iOS distribution has separate blockers.

The initial audit examined commit `aa0c2ca`. Privacy corrections were pushed as commit `7db8ed9` to `main`; Vercel marked that production deployment Ready, and the live `/privacy` page served the new text. No payment, refund, email, database migration, or account mutation was performed. Aggregates below were read on 5 October 2026 and will change.

## Release gates that passed

| Check | Result |
| --- | --- |
| Production build | `npm run build` passed, including TypeScript and page generation. The sandbox blocked a first attempt with `spawn EPERM`; the permitted rerun passed. |
| Unit tests | 85 files, 719 tests passed. |
| ESLint | 0 errors, 22 warnings; most warnings are in generated Android assets, with a few unused values in application code. |
| npm advisories | `npm audit` and `npm audit --omit=dev` both found 0 known vulnerabilities at audit time. |
| Deployment | Latest Vercel production deployment was Ready; its callback diagnostic reported build `aa0c2ca`, matching local `HEAD`. |
| Public routes | `/`, `/restaurants`, `/explore`, `/pricing`, `/privacy`, `/terms`, `/contact`, `/login`, `/sitemap.xml`, and `/manifest.webmanifest` returned 200. Sample page loads took about 0.7–3.5 seconds from this audit host. |
| Access boundaries | Anonymous `/a`, `/m`, and `/orders` redirected to login. `/api/cron/reconcile` returned 401 without its bearer token. |
| Health | `/a/health` returned `ok`: database reachable and reconciler current at the time checked. It explicitly does **not** probe the payment gateway. |
| SEO and browser headers | Live sitemap had 176 canonical-domain URLs, including restaurant, dish, and English pages. HTTPS response included HSTS, CSP, `nosniff`, frame protection, and a referrer policy. |
| Public visual check | Desktop and true 390px emulated mobile homepage renders were inspected. The mobile document width and scroll width were both 390px; no horizontal page overflow was observed. |
| Secret handling | `.env.local` is ignored; the tracked file is `.env.example`. A pattern scan found no tracked service-role or private signing key. Firebase browser API keys in client files are public identifiers by design. |

## Items to close for a clean launch audit

### 1. Published privacy wording was inaccurate — resolved

The previous `/privacy` page said orders were paid only in cash at delivery or at the restaurant, although checkout offers **Mobile Money** and **wallet** payment. It also overstated anonymisation after account deletion. The French and English policy, account deletion notice, and update date were corrected in commit `7db8ed9`.

**Verified:** The new production `/privacy` page returns 200, includes the Mobile Money and retained-record disclosures, and no longer contains the cash-only claim. A qualified legal review of the privacy policy and terms remains appropriate before broad promotion; this technical audit does not certify legal compliance.

### 2. CamerPay callbacks are unverified, while payments are succeeding

The active collection and payout gateway settings both select **CamerPay**. The production database held four payment attempts (three `succeeded`, one `failed`) and **zero** `payment_webhook_events` rows. The callback URL responds to GET, but that only proves the route exists. The reconciler recently ran and can settle missed callbacks. These facts support that payments are being recorded as successful; they leave the callback delivery path unverified.

**Operational follow-up:** Confirm CamerPay has `https://resto237.online/api/webhooks/camerpay` registered. Use the next authorized real transaction or provider-side delivery log to check that a callback is recorded, the order is marked paid once, and reconciliation does not duplicate settlement. Verify refund/cancellation and payout amounts against provider and ledger records when those flows are exercised. No refunds were recorded at audit time; one withdrawal was recorded as paid. Do not reset payment history to make the database look clean.

### 3. Production mode, links, and mail delivery need an authenticated check

Vercel has `APP_MODE`, `APP_URL_LIVE`, and `NEXT_PUBLIC_SITE_URL` configured as Sensitive variables. Vercel's read-only CLI returns `[SENSITIVE]`, so their **values could not be verified**. The checkout's `.env.local` is explicitly test mode and points to localhost / an old Vercel URL; that local file is ignored and is not evidence of the deployed values. [`src/lib/site-url.ts`](../src/lib/site-url.ts) uses production mode to form emailed links, while [`src/lib/mail.ts`](../src/lib/mail.ts) can divert messages in test mode.

**Required check:** On production `/a/tests`, confirm App mode says `LIVE`, the link origin is `https://resto237.online`, and SMTP is configured. Send and receive one authorized sign-up/reset email and verify the link stays on the canonical domain. Check the Supabase Auth redirect allow-list described in [`docs/SUPABASE_AUTH_EMAILS.md`](SUPABASE_AUTH_EMAILS.md). Treat this as unverified rather than a confirmed misconfiguration.

## Important follow-ups

- **Scheduler and cost:** The production Supabase URL in this checkout matches the live CSP host. Recent migration tables (`rate_limit_buckets`, `scheduled_payouts`, `dining_payments`, `withdrawal_pins`) are reachable. The reconciler and daily expiry heartbeats exist. Other sweep heartbeats are older, but all four `cron_due_*` read-only gates returned `false` during the audit, so idle heartbeats alone do not show a failure. The database `cron_base_url` targets `resto237.vercel.app`, which the code deliberately exempts from canonical redirects for cron requests. Direct `cron.job` rows were unavailable to this audit. Verify one active schedule per job, especially the reconciler: a [prior CPU audit](vercel-cpu-audit-2026-09-25.md) observed roughly one request a minute when the configured schedule was ten minutes. The later task-only migration changes the intended reconciler schedule to five minutes, gated on due work. Confirm current Vercel usage and alert thresholds before a traffic campaign.
- **Native release:** `npm run mobile:check` passed Android Firebase configuration but failed because `ios/App/App/GoogleService-Info.plist` is missing. The live Apple association file has an empty `details` list; `APPLE_TEAM_ID` is absent from production Vercel variables. Android association is populated. The published APK returned 200 with the expected content type and length, and the local APK's SHA-256 and size match [`src/lib/app-release.json`](../src/lib/app-release.json). Neither platform was tested on a physical device in this audit. These are iOS release blockers, not web launch blockers.
- **SasPay:** `SASPAY_API_KEY` is configured in Vercel, but `SASPAY_WEBHOOK_SECRET` is absent. CamerPay is selected, and the gateway switching action prevents enabling SasPay collections without the secret. Configure and verify its signed webhook before switching collection providers.
- **Security hardening:** Production CSP still includes `'unsafe-eval'` because [`next.config.ts`](../next.config.ts) includes the development allowance unconditionally. Remove it from production after checking framework compatibility. The unauthenticated `/styleguide` route is publicly reachable; decide whether to remove it or mark it `noindex` for launch.
- **Search and reputation:** Search Console ownership/submission was not verifiable. A [third-party site checker](https://www.scamadviser.com/check-website/resto237.online) relays an IPQS phishing/suspicious flag. This was not independently confirmed by IPQS or Google and may be a false positive for a young domain; investigate and dispute it before broad promotion.

## Live data and scope limits

At audit time the database held six restaurants (five active, one suspended), 48 menu items, three orders, one reservation, four payment attempts, one paid withdrawal, zero refunds, and zero recorded webhook events. These are counts, not proof of a complete customer journey.

This review did not log in as customer, restaurant manager, or admin; initiate live money movement; send an email; inspect the provider dashboard; directly read `cron.job`; run a load test; conduct a penetration test; obtain a legal review; or test push notifications and native builds on physical devices. Each remains a launch acceptance check for the relevant feature.

## Remaining acceptance checks

1. Obtain a legal review of the published privacy policy and terms against current product behavior.
2. Verify production `LIVE` mode, canonical emailed links, SMTP delivery, and Supabase Auth redirects through the protected admin checks.
3. Confirm CamerPay callback registration and use an authorized transaction to verify webhook logging and once-only settlement. Reconcile refund/cancellation and payout records when those flows are exercised.
4. Inspect the live Supabase cron schedules and recent Vercel usage. Set monitoring for degraded `/a/health`, payment failures, webhook silence, and unsettled attempts.
5. The privacy change passed the production build, all 719 tests, and lint with 0 errors (22 existing warnings); its live page check passed. Increase web traffic gradually. Release iOS only after Firebase configuration, associated domains, signing, and device testing are complete.
