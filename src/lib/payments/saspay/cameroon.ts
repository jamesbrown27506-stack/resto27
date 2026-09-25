import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * SasPay, restricted to Cameroon — the pure rules (no network, testable).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  SasPay covers ~18 countries (docs.saspay.me/api-reference/reference/
 *  formats). Resto237 operates in Cameroon only for now, so every request
 *  is pinned to country CM, currency XAF, and one of the two active
 *  Cameroon networks. A number that is not a Cameroon mobile number never
 *  reaches the gateway — the same 9-digit rule the CamerPay integration
 *  applies (normalisePhone), so switching gateways cannot widen who can pay.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const SASPAY_COUNTRY = "CM";
export const SASPAY_CURRENCY = "XAF";

export type CameroonNetwork = "mtn_cm" | "orange_cm";

/**
 * Operator of a Cameroon mobile number, from its original allocation:
 *   MTN     67x, 68x, 650–654
 *   Orange  69x, 655–659
 * Number portability exists in Cameroon, so this is the ALLOCATION, not a
 * guarantee — a ported number is refused by the gateway and the customer is
 * told to use their operator's number. Anything else (Camtel, Nexttel…) has
 * no SasPay network in Cameroon: null.
 */
export function cameroonNetwork(nineDigits: string): CameroonNetwork | null {
  if (!/^6\d{8}$/.test(nineDigits)) return null;
  const two = nineDigits.slice(0, 2);
  const three = Number(nineDigits.slice(0, 3));
  if (two === "67" || two === "68") return "mtn_cm";
  if (two === "69") return "orange_cm";
  if (three >= 650 && three <= 654) return "mtn_cm";
  if (three >= 655 && three <= 659) return "orange_cm";
  return null;
}

/** The international form SasPay stores and echoes: +2376XXXXXXXX. */
export function cameroonMsisdn(nineDigits: string): string {
  return `+237${nineDigits}`;
}

/**
 * SasPay's advertised transaction range for Cameroon (saspay.me/#tarifs:
 * "entre 200 et 9 999 999 FCFA"). The live per-network tiers from
 * GET /pricing/my-rates/ are shown in the admin Gateways panel and are the
 * authority when they are narrower.
 */
export const SASPAY_MIN_XAF = 200;
export const SASPAY_MAX_XAF = 9_999_999;

/** SasPay amounts are decimal strings ("2500.00"); XAF is whole francs. */
export function saspayAmount(xaf: number): string {
  return `${Math.round(xaf)}.00`;
}

/** Parse "2500.00" (or a number) back into whole francs; NaN when absent. */
export function parseSaspayAmount(value: unknown): number {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return NaN;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

/** SasPay's transaction status, collapsed to the three verdicts we act on. */
export function saspayVerdict(status: unknown): "success" | "failed" | "pending" {
  const s = String(status ?? "").toUpperCase();
  if (s === "SUCCESS") return "success";
  if (s === "FAILED" || s === "CANCELLED") return "failed";
  return "pending";
}

/**
 * Webhook authenticity (docs: Webhooks → Sécurité). The signature is
 * HMAC-SHA256(secret, `${timestamp}.${rawBody}`) as lowercase hex, and a
 * delivery older than five minutes is refused so a captured request cannot
 * be replayed. Always the RAW body — a re-serialised JSON can differ by a
 * byte and fail the comparison.
 */
export function verifySaspaySignature(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  const { rawBody, signature, timestamp, secret } = input;
  if (!signature || !timestamp || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (input.toleranceSeconds ?? 300)) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(signature.trim().toLowerCase());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
