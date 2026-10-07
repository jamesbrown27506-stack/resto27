# Security fixes and rollout — 2026-10-06

These changes address the findings in the read-only audit. Production database
migrations 0077 and 0078 are installed, and the patched Vercel build is ready.
Final Auth configuration and domain activation are tracked below. A
service-role API key cannot change hosted Supabase Auth configuration.

## Changes

| Audit finding | Fix |
| --- | --- |
| D1: vulnerable dependencies | Patched Next.js, Sharp, Nodemailer, Firebase and build tooling; compatible transitive overrides. Online npm audit after installation: zero advisories. |
| H1: unverified privilege grants | Server-controlled mailbox proof from an actual email OTP; invitation discovery/acceptance and existing-account administrator grants require it. |
| H2: password reset from ordinary session | Opaque, ten-minute, single-use recovery grant bound to verified Auth user/session; hashed database record and HttpOnly cookie. Normal password changes pass `current_password`. Provider policy below is also required. |
| H3: withdrawal races/retries | Database wallet lock covers pending reservations, refund holds, delegate limits, current permissions, saved payout account, claim and debit. Provider refusal reversal is atomic/idempotent. Generic withdrawal debits cannot bypass it. |
| M1: permissive script CSP | Production scripts use per-request nonces and `strict-dynamic`; inline/eval execution removed. |
| M2: account authentication | At the user's request, 2FA enrollment is optional for every role; verified enrolled factors still require AAL2. Admin Settings → Account security controls email verification before access independently for administrators, restaurant accounts and customers. Defaults: administrators/restaurants required, customers optional. `/security` provides email verification and authenticator setup/challenge/disable. |
| M3: stock/coupon races | One SQL transaction aggregates duplicate basket lines, locks stock/coupons, enforces coupon limits and spends loyalty points. Failed finalization has no partial resource effects; deleting an unfinished checkout restores its claims. |
| M4: upload abuse | Email verification follows the account-type policy; durable throttling, profile/Auth ownership, ten uploads/hour, at most twenty stored reservations from the last 24 hours, and 100 MiB tracked storage/person still apply. Customer images remain capped at 2 MiB. Old owned avatars are removed on replacement. Review photos must belong to the author. |
| L1: GET logout | GET only navigates; logout requires a same-origin POST. |
| Additional observations | Push sync refuses inactive/deleted profiles. Sensitive Auth/wallet/rate-limited operations refuse requests if shared enforcement is unavailable. PIN counting has no racy fallback. |
| Deployment upload exposure | `.vercelignore` excludes browser profiles, native signing credentials, local environment files, build products and local upload experiments. The Vercel upload preview confirms that sensitive files are excluded; the web build and published Android download remain included. |

The scoped `@next/eslint-plugin-next` override replaces its vulnerable
`fast-glob` dependency with `tinyglobby`. The plugin uses only `globSync`
with `onlyDirectories`, which the replacement supports. The existing Next
lint rules remain enabled. Review the override when upstream fixes its chain.

## Required Supabase changes

1. Apply `supabase/migrations/0077_security_invariants.sql`, then
   `supabase/migrations/0078_pending_deposit_refund_holds.sql` in the production
   project's SQL editor, after migrations through 0076. Each script is one
   transaction. They add security records/functions and protect paid booking
   deposits during the confirmation step. They do not reset customer data or
   send payments. Apply once through the normal migration workflow.
2. In Authentication settings, enable **Confirm Email**
   (`mailer_autoconfirm=false`). Keep **Secure email change** enabled.
3. Enable **Require current password when changing password**
   (`password_require_current_password=true`). This protects the directly
   reachable Auth API; application checks alone are insufficient.
4. Keep TOTP enrollment and verification available in MFA settings. Enrollment
   is optional for all roles. Only users who enabled a verified authenticator
   must challenge it before protected access. Account owners can disable it
   themselves after completing a two-step sign-in.
5. Install `supabase/email-templates/verify-email.html` as the **Magic Link**
   email template. It includes the OTP and a cross-browser verification link.
   Keep the existing Confirm Signup and Reset Password templates installed.
6. Confirm Site URL is `https://resto237.online` and permit the intended
   production callback URL `/auth/callback?next=/security` in the redirect
   allowlist, plus the existing signup/recovery callbacks. Do not add a broad
   wildcard production redirect.

Official references: [Auth configuration](https://supabase.com/docs/guides/auth/general-configuration),
[password security](https://supabase.com/docs/guides/auth/password-security),
[TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp),
[email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## Rollout and verification

After applying the migration and Auth settings, deploy the tested application
to Vercel. Installing 0077 first temporarily makes older withdrawal executors
refuse payouts; activate the new application promptly. Legacy pending
requests without a valid saved payout account need to be rejected and
recreated through the normal authorized flow.

Run the full tests, TypeScript, ESLint, production build and online npm audit.
The database regressions execute the actual migration on isolated PostgreSQL
via PGlite. PGlite serializes requests on one connection; these tests validate
transaction rules but do not constitute a multi-connection production load
test. No live payouts or production data mutations are used in testing.

Verification completed locally: 822 tests pass across 100 files; production build
and TypeScript pass; ESLint reports no errors
(existing warnings remain); Android configuration check passed; online npm
audit reports zero advisories. Local production HTTP checks confirm generated
nonces on all executable scripts, rejection of attacker-supplied nonces,
anonymous redirects for protected routes, and safe GET logout. The iOS
configuration check cannot pass without the existing missing
`ios/App/App/GoogleService-Info.plist`.

After activation, verify CSP nonces on rendered pages, then use an owned test
account to check email verification, MFA, password change/recovery, uploads
and guest checkout. Use sandbox mode for payout checks. Confirm Auth itself
rejects ordinary password updates that omit the current password.

## SasPay is inactive for new payments

The user confirmed that SasPay will not be used now. Both production settings,
`payment_provider_collect` and `payment_provider_payout`, are `camerpay`.
Existing provider-specific transaction reconciliation is preserved.

Production has a SasPay API key but no `SASPAY_WEBHOOK_SECRET`. Unsigned or
unconfigured webhooks remain refused. A matching provider signing secret and
sandbox verification would be required before enabling SasPay collections;
this is not a prerequisite for the current CamerPay rollout.

Do not describe the live site as fixed until the migration, provider settings,
deployment and live smoke checks have been confirmed.

Production verification on 2026-10-06 confirms all seven required security
RPCs, all three security tables, the new order/withdrawal columns, and
`security_invariants_version() = 78`. Anonymous reads of the security tables
and execution of the version RPC return 401. The live site's Supabase host
matches the project checked.

Vercel deployment `dpl_A4isrrDY2wU7mLbRNnrcXDeHbSHf` is READY after a successful
remote production build and TypeScript check:
https://resto237-2nll6xw9w-emmanuel-legrands-projects.vercel.app

All 29 HTTP smoke checks against that protected deployment passed at
2026-10-06 07:52:23 UTC using Vercel's authenticated CLI protection bypass.
They cover nonce-based CSP, ignored client-supplied nonces, anonymous protected
route/export denial, logout methods/origins, unavailable local secret files,
cron authentication, push privacy/authentication and service-worker delivery.
The deployment's public health endpoint reports `ok` and database access works.
These checks do not replace owned-account email, MFA or payment sandbox tests.

The deployment was created with `--skip-domain` for verification before domain
promotion. Using the project owner's signed-in dashboard, Confirm Email and
Require current password when updating were enabled and saved. The Auth API
minimum password length is now 8, matching the application. Secure email
change remains enabled. TOTP is enabled, with the 15-minute limit for AAL1
sessions already on. A fresh public Auth check at 2026-10-06 07:45:36 UTC
returned `mailer_autoconfirm=false`.

The Magic Link / OTP template and Confirm Signup template now include the
prepared cross-browser verification links. The existing Reset Password
template was verified to include its code and recovery link. Site URL is
`https://resto237.online`. Production redirects
are restricted to `/auth/callback` and `/auth/callback?next=**`; the `next`
query is validated by the application. The old all-path production wildcard
was removed. Localhost development redirects are preserved.

The same build includes clearer branch actions, a shared switching indicator,
address placeholders, and owner/manager assignment during branch creation.
The main owner is retained. Accepted active colleagues from the same restaurant
group can be selected; new email invitees must verify and accept before access.
Managers receive no automatic withdrawal permission. Owner authorization,
foreign-profile denial, seat limits, invitation writes and failure rollback are
covered by 15 additional tests. No additional migration is needed.
Both team/leader query shapes also returned 200 against the live database;
that check used HEAD responses and did not return people's contact details.

The verified deployment was promoted successfully to production. All 29
checks also passed on `https://resto237.online` at 2026-10-06 07:55:10 UTC,
including database health. Vercel confirms both `resto237.online` and
`www.resto237.online` belong to this project. A signed-in restaurant account
visiting `/m/branches` correctly reaches the email verification gate.
Account owners complete their own email verification when their account type
requires it. Authenticator enrollment is optional; no credentials or MFA
factors were entered on anyone's behalf.
Owned-account recovery, uploads, checkout and payment sandbox scenarios remain
manual follow-up verification, as described above; automated tests and HTTP
checks do not claim to cover those complete live transactions.

## User-requested account policy update

Email requirements are now configurable in Admin Settings → Account security.
Only a super administrator may save the policy. The three booleans are stored
atomically in one `email_verification_roles` settings row; no migration is
required. A missing row defaults to administrator/restaurant required and
customer optional. Invalid stored data requires verification for all roles;
database failures refuse access instead of silently relaxing the saved rule.
Changes apply on the next protected request, including existing sessions.

Supabase's global Confirm Email stays enabled. Customer registrations with
verification switched off use the server's validated customer-only creation
path and sign in immediately. Existing accounts whose role has verification
off may be provider-confirmed during password login. Neither path writes the
server-controlled mailbox ownership proof used by invitations or recovery.
Required customer verification uses the normal signup email flow. Photo
uploads honor the same policy while preserving ownership checks and quotas.

The email-code, authenticator-code and logout buttons on `/security` now have
explicit submit types. Email entry remains visible after a refresh, pasted
codes tolerate spaces/hyphens, and submissions show loading, success or a
visible error. Verified users without an enrolled factor can continue without
2FA. Customers, restaurant users and administrators can opt in from their
own profile; disabling an existing factor requires AAL2 and confirmation.

The account policy update is deployed and promoted to `https://resto237.online`
as `dpl_2rB1cSrZDwFJ7wyifVrqSLWdyBVr`:
https://resto237-1hnupwsmq-emmanuel-legrands-projects.vercel.app
The local and remote production builds/TypeScript checks pass, changed-file
ESLint reports zero errors or warnings, and all 822 tests pass across 100 files.
All 29 security HTTP checks passed on the protected deployment at
2026-10-06 08:48:13 UTC and on the live domain at 2026-10-06 08:50:51 UTC.
A read-only production query confirmed the policy row is absent, so the
requested defaults apply until a super administrator saves different choices.

The signed-in live browser shows optional 2FA and the email-code input after
refresh. The verification button has `type=submit`; clicking it with an empty
code displays the explicit invalid-code message. The test input was cleared
and the clean page left open. No real OTP, email send, signup, MFA factor
change or financial transaction was performed during these browser checks.

## Loyalty funding and withdrawal follow-up

The platform-funded loyalty correction and numeric PIN fields are deployed as
`dpl_3BjopmJrp9K1bVT5aqPgKdSPkUdp` on https://resto237.online. Production
schema version 79 is verified, and the confirmed missing 500 FCFA was restored
exactly once by migration 0079, which the owner applied. All 849 tests across
103 files and all 33 staged/live security and access checks passed. The signed-in
live browser confirms matching four-, five- and six-digit fields and non-digit
filtering without submitting a payout or PIN verification. See
[the loyalty rollout record](loyalty-funding-rollout-2026-10-06.md) for settlement,
refund, reserve calculations, the provider funding gap and the separate historical
wallet reconciliation finding.

## Wallet navigation follow-up

The highlighted desktop/mobile wallet shortcuts and selected-branch available
balance are deployed as `dpl_9VmtPiQia2AUHdNTcYpYkVsAy5yw` on
https://resto237.online. All 876 tests across 106 files, production builds,
and 29 staged/live HTTP security checks passed. Wallet summary data is restricted
to independently verified owner/manager memberships and excludes refund-held
funds. Signed-in browser checks confirmed small-screen layout, sticky access,
and correct balances on branch switches. See
[the wallet navigation rollout](wallet-navigation-rollout-2026-10-06.md).

The mobile balance card subsequently moved into the Plus/More menu, with the
top bar cleared, as requested by the owner. This placement is deployed as
`dpl_2T8Vxsd6fJgTNVyyE9G8Qg7BavCu`. The 54 relevant navigation/wallet tests,
production builds, six focused staged checks and 29 live HTTP checks pass.
The live browser confirmed one menu card, phone-width layouts, correct menu
closing and preserved Plus active state. The desktop card and finance permissions
are unchanged. Details are in the same wallet navigation rollout record.
