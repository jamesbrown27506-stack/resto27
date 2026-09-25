# SasPay — reference and setup (Cameroon)

Researched 25 September 2026 from https://docs.saspay.me (full text + OpenAPI spec) and the public pricing section of https://saspay.me. SasPay's own numbers may change; the live figures for **your** account are shown in the admin panel (Payments → Gateways), read from `GET /pricing/my-rates/`.

## What SasPay is

A payment aggregator: one REST API for mobile money (and cards/crypto in USD) across West, Central and East Africa, instead of one integration per operator. Collections ("payin", called *softpay* or hosted *checkout*), payouts, payment links, per-country wallets, signed webhooks.

- API base: `https://api.saspay.me/api/v1` — dashboard: https://app.saspay.me
- Auth: `Authorization: Bearer sk_live_…` (real money) or `sk_test_…` (SasPay sandbox). Key scope `PAYIN`, `PAYOUT` or `BOTH`. The full secret is shown **once** when created.
- Account: sign up → verify email → create a merchant → KYC (ID, business registration…) → validated by SasPay → create an API key. KYC and key management are dashboard-only.
- Rate limit: 300 requests/minute per account.
- Idempotency: optional `Idempotency-Key` header; **always** sent by Resto237 on money-moving calls (the attempt / refund / withdrawal id).

## Cameroon

| | |
| --- | --- |
| Country / currency | `CM` / `XAF`, dialling code +237 |
| Networks | `mtn_cm` MTN MoMo Cameroon, `orange_cm` Orange Money Cameroon (`eu_mobile_cm` exists but is inactive) |
| Public pricing | **from 1.75 % + 100 FCFA fixed per transaction** ("Dès 1,75 %" for Cameroon) |
| Transaction range (public) | **200 – 9 999 999 FCFA** per transaction |
| Payouts | fee not published — see your rates in the admin panel (`payout.tiers`) |
| Subscription | none — pay per transaction, no monthly fee |

The pricing endpoint returns, per network and per direction (payin / payout), tiers of `min_amount`, `max_amount`, `percent`, `fixed`, `floor_amount` (minimum fee), `cap_amount` (maximum fee) and `fee_charge_mode`:

- `ADD_ON` — the fee is added on top of what the payer pays; you receive the full amount.
- `DEDUCTED` — the payer pays exactly the amount; the fee is taken from what you receive.

Resto237 asks for `DEDUCTED` on collections (the customer pays exactly the price on screen) and `ADD_ON` on payouts (the recipient receives exactly the refund/withdrawal). SasPay only honours a per-request mode when **Paramètres → Frais → "Autoriser le choix du mode de frais par l'API"** is enabled on your account; otherwise your account default applies.

For comparison, CamerPay accepts 500 – 500 000 FCFA per transaction.

## How payments behave

- **Collections** (`POST /payments/softpay/`): either a prompt is pushed to the phone (MTN usually), or SasPay returns a `checkout_url` the customer must open (Orange Money usually). Resto237 shows an "Ouvrir la page de paiement" button in that case; nothing is charged until the customer completes it. Hosted pages return to the order/reservation page.
- Status `PENDING → SUCCESS | FAILED`. The verdict always comes from `GET /payments/{id}/verify/` (re-checks the operator); webhooks only trigger that check.
- Resto237 waits up to 15 minutes for a SasPay payment (5 for CamerPay) before expiring it.
- **Payouts** (`POST /payouts/initialize/`): currency and country must match (XAF + CM). **Requires the calling server's IP to be whitelisted** in the SasPay dashboard for API-key calls (`403 ip_not_whitelisted` otherwise). Vercel functions have no fixed outgoing IP unless Vercel Static IPs / Secure Compute is enabled — until then, keep **Payouts on CamerPay** and use SasPay for collections only.
- Wallet: one balance per country (available / pending / frozen). Withdrawing SasPay's balance to your bank or mobile money is done from the SasPay dashboard.
- Webhooks: signed with HMAC-SHA256 over `timestamp.body` (`X-Webhook-Signature`, `X-Webhook-Timestamp`); 5 delivery attempts (immediate, +30 s, +5 min, +30 min, +2 h), 15 s timeout.

## Setup checklist

1. Create and verify the SasPay account, merchant and KYC; enable "allow fee mode by API" in Paramètres → Frais.
2. Create an API key, scope `BOTH` (or `PAYIN` if you only collect).
3. Create a webhook: `https://resto237.online/api/webhooks/saspay`, events `transaction.success`, `transaction.failed`, `transaction.cancelled`. Copy its signing secret.
4. Set `SASPAY_API_KEY` and `SASPAY_WEBHOOK_SECRET` in Vercel (and `.env.local`), redeploy.
5. Run migration `0063_super_admins_and_payment_gateways.sql`.
6. As a super admin: Payments → Gateways → check the key/webhook badges and your live rates → switch **Collections** to SasPay. Leave **Payouts** on CamerPay unless the server IP is whitelisted.
7. Test with a small real payment on MTN and on Orange, and watch it turn paid.

Both gateways are pinned to Cameroon: country `CM`, currency `XAF`, 9-digit numbers starting with 6 (MTN 67x/68x/650–654, Orange 69x/655–659). Anything else is refused before reaching a gateway.
