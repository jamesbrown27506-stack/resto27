import "server-only";

import {
  SASPAY_COUNTRY,
  SASPAY_CURRENCY,
  cameroonMsisdn,
  cameroonNetwork,
  parseSaspayAmount,
  saspayAmount,
  saspayVerdict,
  type CameroonNetwork,
} from "./cameroon";

/**
 * SasPay REST client (https://docs.saspay.me) — Cameroon mobile money only.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  AUTH: `Authorization: Bearer sk_live_…` (or sk_test_… for SasPay's own
 *  sandbox). The key lives in SASPAY_API_KEY and never leaves the server.
 *
 *  MONEY-MOVING CALLS ALWAYS CARRY AN Idempotency-Key. SasPay treats a call
 *  without one as a brand-new intent, so a network retry would push a
 *  second charge or send a second payout. Ours is the attempt / refund /
 *  withdrawal id: one intent, one key, however many times it is retried.
 *
 *  THE VERDICT COMES FROM /verify/ ONLY. It re-asks the operator whenever
 *  the stored status is still PENDING — the same "never trust a remembered
 *  status" rule the CamerPay integration follows. Webhooks are a hint that
 *  triggers a verify, exactly like CamerPay callbacks.
 *
 *  Every response is wrapped as { success, data, code } or
 *  { success:false, error:{ message, code } } (validation errors: a map of
 *  field → messages). Some examples in the docs show the bare `data`; both
 *  are accepted.
 * ─────────────────────────────────────────────────────────────────────────
 */

const DEFAULT_BASE_URL = "https://api.saspay.me/api/v1";
const TIMEOUT_MS = 20_000;

export function saspayConfigured(): boolean {
  return Boolean(process.env.SASPAY_API_KEY?.trim());
}

/** "live" for sk_live_ keys, "test" for sk_test_, null when unset. */
export function saspayKeyEnvironment(): "live" | "test" | null {
  const key = process.env.SASPAY_API_KEY?.trim() ?? "";
  if (!key) return null;
  return key.startsWith("sk_test_") ? "test" : "live";
}

export interface SaspayError {
  code: string;
  message: string;
  status: number;
}

type SaspayResult<T> = { ok: true; data: T; status: number } | { ok: false; error: SaspayError };

async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<SaspayResult<T>> {
  const key = process.env.SASPAY_API_KEY?.trim();
  if (!key) return { ok: false, error: { code: "not_configured", message: "SASPAY_API_KEY is not set.", status: 0 } };
  const base = (process.env.SASPAY_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Transport failure: the request may or may not have reached SasPay.
    // Callers treat this as UNKNOWN, never as a refusal.
    throw new Error(`SasPay ${method} ${path} unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }

  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }

  if (!response.ok || json.success === false) {
    const err = (json.error ?? {}) as Record<string, unknown>;
    const code = typeof err.code === "string" ? err.code : `http_${response.status}`;
    const message =
      typeof err.message === "string"
        ? err.message
        : Object.entries(err)
            .map(([field, v]) => `${field}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
            .join("; ") || `HTTP ${response.status}`;
    return { ok: false, error: { code, message, status: response.status } };
  }

  const data = ("data" in json ? json.data : json) as T;
  return { ok: true, data, status: response.status };
}

/* ── Collections (payin, "softpay") ─────────────────────────────────────── */

export interface SaspayPaymentStart {
  /** SasPay's transaction id — what /verify/ and webhooks refer to. */
  id: string;
  status: "success" | "failed" | "pending";
  /**
   * Non-empty for operators that settle on a hosted page (Orange Money in
   * Cameroon often does): the customer MUST be sent there, or nothing is
   * charged. Empty for a direct push (USSD prompt on the phone).
   */
  checkoutUrl: string | null;
  instructions: string | null;
}

export async function startSaspayPayment(input: {
  phone: string;
  amount: number;
  idempotencyKey: string;
  description: string;
  returnUrl?: string;
  customer?: { firstName?: string; lastName?: string; email?: string };
  metadata?: Record<string, unknown>;
}): Promise<SaspayResult<SaspayPaymentStart>> {
  const network = cameroonNetwork(input.phone);
  if (!network) {
    return { ok: false, error: { code: "invalid_method", message: "Not an MTN or Orange Cameroon number.", status: 0 } };
  }

  const result = await call<Record<string, unknown>>(
    "POST",
    "/payments/softpay/",
    {
      amount: saspayAmount(input.amount),
      currency: SASPAY_CURRENCY,
      country: SASPAY_COUNTRY,
      network,
      description: input.description.slice(0, 200),
      customer: {
        email: input.customer?.email || `paiement@resto237.online`,
        first_name: input.customer?.firstName || "Client",
        last_name: input.customer?.lastName || "Resto237",
        phone: cameroonMsisdn(input.phone),
      },
      // The customer pays exactly the amount on screen; SasPay's fee comes
      // out of what the platform receives. Honoured only when the account
      // allows per-request fee modes (Paramètres → Frais).
      fee_charge_mode: "DEDUCTED",
      ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
    input.idempotencyKey,
  );
  if (!result.ok) return result;

  const d = result.data;
  const checkout = typeof d.checkout_url === "string" && d.checkout_url.trim() ? d.checkout_url.trim() : null;
  return {
    ok: true,
    status: result.status,
    data: {
      id: String(d.id ?? ""),
      status: saspayVerdict(d.status),
      checkoutUrl: checkout,
      instructions: typeof d.instructions === "string" && d.instructions.trim() ? d.instructions.trim() : null,
    },
  };
}

export interface SaspayVerification {
  id: string;
  verdict: "success" | "failed" | "pending";
  /** The amount WE asked for, in francs (NaN when SasPay did not echo it). */
  requested: number;
  msisdn: string | null;
  raw: Record<string, unknown>;
}

function verification(d: Record<string, unknown>): SaspayVerification {
  const amounts = (d.amounts ?? {}) as Record<string, unknown>;
  return {
    id: String(d.id ?? ""),
    verdict: saspayVerdict(d.status),
    requested: parseSaspayAmount(amounts.requested ?? d.requested_amount ?? d.amount),
    msisdn: typeof d.operation_msisdn === "string" && d.operation_msisdn ? d.operation_msisdn : null,
    raw: d,
  };
}

/** GET /payments/{id}/verify/ — re-asks the operator while PENDING. */
export async function verifySaspayPayment(id: string): Promise<SaspayResult<SaspayVerification>> {
  const result = await call<Record<string, unknown>>("GET", `/payments/${encodeURIComponent(id)}/verify/`);
  return result.ok ? { ok: true, status: result.status, data: verification(result.data) } : result;
}

/* ── Payouts ────────────────────────────────────────────────────────────── */

/**
 * POST /payouts/initialize/. NOTE: SasPay requires the calling server's IP
 * to be whitelisted for payouts made with an API key (403
 * ip_not_whitelisted otherwise). Vercel functions have no fixed outbound IP
 * unless Static IPs / Secure Compute is enabled — which is why the payout
 * gateway is a separate switch from the collection gateway.
 */
export async function startSaspayPayout(input: {
  phone: string;
  amount: number;
  idempotencyKey: string;
  description: string;
}): Promise<SaspayResult<{ id: string; status: "success" | "failed" | "pending" }>> {
  const network: CameroonNetwork | null = cameroonNetwork(input.phone);
  if (!network) {
    return { ok: false, error: { code: "invalid_method", message: "Not an MTN or Orange Cameroon number.", status: 0 } };
  }
  const result = await call<Record<string, unknown>>(
    "POST",
    "/payouts/initialize/",
    {
      amount: saspayAmount(input.amount),
      currency: SASPAY_CURRENCY,
      country: SASPAY_COUNTRY,
      method: network,
      description: input.description.slice(0, 200),
      customer: { phone: cameroonMsisdn(input.phone) },
      recipient: { msisdn: cameroonMsisdn(input.phone) },
      // The recipient receives exactly `amount`; SasPay's payout fee is
      // charged on top to our balance (when the account allows the choice).
      fee_charge_mode: "ADD_ON",
    },
    input.idempotencyKey,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    status: result.status,
    data: { id: String(result.data.id ?? ""), status: saspayVerdict(result.data.status) },
  };
}

export async function verifySaspayPayout(id: string): Promise<SaspayResult<SaspayVerification>> {
  const result = await call<Record<string, unknown>>("GET", `/payouts/${encodeURIComponent(id)}/verify/`);
  return result.ok ? { ok: true, status: result.status, data: verification(result.data) } : result;
}

/* ── Reference data for the admin Gateways panel ────────────────────────── */

export interface SaspayTier {
  minAmount: number;
  maxAmount: number | null;
  percent: number;
  fixed: number;
  floor: number | null;
  cap: number | null;
  feeChargeMode: string;
}

export interface SaspayNetworkRate {
  networkCode: string;
  networkName: string;
  payin: { available: boolean; otpRequired: boolean; tiers: SaspayTier[] } | null;
  payout: { available: boolean; otpRequired: boolean; tiers: SaspayTier[] } | null;
}

function tier(t: Record<string, unknown>): SaspayTier {
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  return {
    minAmount: num(t.min_amount) ?? 0,
    maxAmount: num(t.max_amount),
    percent: num(t.percent) ?? 0,
    fixed: num(t.fixed) ?? 0,
    floor: num(t.floor_amount),
    cap: num(t.cap_amount),
    feeChargeMode: String(t.fee_charge_mode ?? ""),
  };
}

function side(s: unknown) {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  return {
    available: o.available === true,
    otpRequired: o.otp_required === true,
    tiers: Array.isArray(o.tiers) ? (o.tiers as Record<string, unknown>[]).map(tier) : [],
  };
}

/** GET /pricing/my-rates/, Cameroon rows only — the rates THIS account pays. */
export async function saspayCameroonRates(): Promise<SaspayResult<SaspayNetworkRate[]>> {
  const result = await call<unknown>("GET", "/pricing/my-rates/");
  if (!result.ok) return result;
  const rows = (Array.isArray(result.data) ? result.data : []) as Record<string, unknown>[];
  return {
    ok: true,
    status: result.status,
    data: rows
      .filter((r) => String(r.country_code ?? "").toUpperCase() === SASPAY_COUNTRY)
      .map((r) => ({
        networkCode: String(r.network_code ?? ""),
        networkName: String(r.network_name ?? r.network_code ?? ""),
        payin: side(r.payin),
        payout: side(r.payout),
      })),
  };
}

/** GET /merchant-balances/, the Cameroon wallet (available / pending). */
export async function saspayCameroonBalance(): Promise<
  SaspayResult<{ available: number; pending: number; frozen: boolean } | null>
> {
  const result = await call<unknown>("GET", "/merchant-balances/");
  if (!result.ok) return result;
  const list = (Array.isArray(result.data)
    ? result.data
    : ((result.data as { results?: unknown[] })?.results ?? [])) as Record<string, unknown>[];
  const row = list.find((b) => {
    const c = String(b.country_code ?? b.country_iso ?? b.currency ?? "").toUpperCase();
    return c === SASPAY_COUNTRY || c === SASPAY_CURRENCY;
  });
  return {
    ok: true,
    status: result.status,
    data: row
      ? {
          available: parseSaspayAmount(row.available_amount),
          pending: parseSaspayAmount(row.pending_amount),
          frozen: row.is_frozen === true,
        }
      : null,
  };
}

/* ── Admin console reads (/a/saspay) ────────────────────────────────────── */

export interface SaspayTransactionRow {
  id: string;
  reference: string;
  type: string;
  direction: string;
  status: string;
  requested: number;
  charged: number;
  net: number;
  network: string;
  msisdn: string | null;
  createdAt: string;
}

/** GET /transactions/?country=CM — the latest Cameroon transactions. */
export async function saspayRecentTransactions(limit = 20): Promise<SaspayResult<SaspayTransactionRow[]>> {
  const result = await call<unknown>("GET", `/transactions/?country=${SASPAY_COUNTRY}&page_size=${Math.min(limit, 200)}`);
  if (!result.ok) return result;
  const list = (Array.isArray(result.data)
    ? result.data
    : ((result.data as { results?: unknown[] })?.results ?? [])) as Record<string, unknown>[];
  return {
    ok: true,
    status: result.status,
    data: list.slice(0, limit).map((t) => {
      const amounts = (t.amounts ?? {}) as Record<string, unknown>;
      return {
        id: String(t.id ?? ""),
        reference: String(t.reference ?? ""),
        type: String(t.transaction_type ?? t.type ?? ""),
        direction: String(t.flow_direction ?? ""),
        status: String(t.status ?? ""),
        requested: parseSaspayAmount(amounts.requested ?? t.requested_amount),
        charged: parseSaspayAmount(amounts.charged ?? t.debited_amount),
        net: parseSaspayAmount(amounts.net ?? t.net_amount),
        network: String(t.network_code ?? t.network ?? ""),
        msisdn: typeof t.operation_msisdn === "string" && t.operation_msisdn ? t.operation_msisdn : null,
        createdAt: String(t.created_at ?? ""),
      };
    }),
  };
}

export interface SaspayWebhookDelivery {
  id: string;
  event: string;
  status: string;
  responseCode: number | null;
  attempts: number | null;
  createdAt: string;
}

/** GET /webhook-logs/ — did SasPay reach /api/webhooks/saspay, and what did we answer? */
export async function saspayWebhookLogs(limit = 15): Promise<SaspayResult<SaspayWebhookDelivery[]>> {
  const result = await call<unknown>("GET", "/webhook-logs/");
  if (!result.ok) return result;
  const list = (Array.isArray(result.data)
    ? result.data
    : ((result.data as { results?: unknown[] })?.results ?? [])) as Record<string, unknown>[];
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  return {
    ok: true,
    status: result.status,
    data: list.slice(0, limit).map((l) => ({
      id: String(l.id ?? ""),
      event: String(l.event_type ?? l.event ?? ""),
      status: String(l.status ?? ""),
      responseCode: num(l.response_status_code ?? l.response_code ?? l.status_code),
      attempts: num(l.attempt_count ?? l.attempts),
      createdAt: String(l.created_at ?? ""),
    })),
  };
}

/** Is the key accepted? One cheap authenticated call, for the console's status line. */
export async function saspayPing(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await call<unknown>("GET", "/pricing/my-rates/");
    return result.ok
      ? { ok: true, detail: `Authenticated (HTTP ${result.status}).` }
      : { ok: false, detail: `${result.error.code}: ${result.error.message}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
