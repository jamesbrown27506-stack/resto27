import "server-only";

/**
 * CamerPay API client — https://doc.camerpay.net
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  HOW THIS PROVIDER DIFFERS FROM THE ONE THE SPEC ASSUMES
 *
 *  explanation.md §6 is written against SebPay, which signs its webhooks with
 *  an HMAC over the raw request bytes. CamerPay does not sign callbacks at
 *  all — no signature header, no shared secret, nothing to verify.
 *
 *  So §6 rule 2 ("verify before trusting") cannot be implemented as written,
 *  and the trust model inverts:
 *
 *    A CALLBACK IS A HINT THAT SOMETHING CHANGED. IT IS NOT PROOF.
 *
 *  Every callback must be confirmed by asking CamerPay directly before any
 *  money moves. That is `confirmTransaction()` below, and it is the only
 *  function permitted to report a payment as settled.
 *
 *  Everything else in §6 still applies unchanged: replay safety comes from a
 *  database constraint, an unrecognised status maps to pending and never to
 *  success, and the amount is re-checked against the invoice.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  Protocol quirks worth knowing before reading the code:
 *
 *   · Every call is an HTTP GET. Even deposits. The payload travels as a
 *     `DATA` header holding serialised JSON, not as a body.
 *   · The token expires after ~15 minutes of inactivity. A 401 means refresh
 *     and retry once, not "credentials are wrong" (that is 404).
 *   · HTTP 202 means ACCEPTED, not PAID. It returns a `replyTo` tracking id.
 *   · There is no sandbox. Testing moves real money, minimum 500 FCFA.
 */

const BASE_URL = process.env.CAMERPAY_BASE_URL ?? "https://api.camerpay.net";

export type CamerPayService = "authentification" | "account" | "transaction" | "rapport";

export interface CamerPayResponse<T = unknown> {
  /** Logical success. Independent of the HTTP status. */
  etat: boolean;
  id?: string;
  token?: string;
  service?: string;
  action?: string;
  message?: string;
  data?: T;
  /** HTTP status, added by us — callers need it to tell 202 from 200. */
  httpStatus: number;
}

/** Phone numbers must be exactly 9 digits starting with 6, no +237 prefix. */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  // Accept the forms people actually type: 237XXXXXXXXX, 00237…, or bare.
  const bare = digits.replace(/^(00)?237/, "");
  return /^6\d{8}$/.test(bare) ? bare : null;
}

/** CamerPay rejects anything outside this band. Checked before sending. */
export const MIN_AMOUNT_XAF = 500;
export const MAX_AMOUNT_XAF = 500_000;

export function isPayableAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount >= MIN_AMOUNT_XAF && amount <= MAX_AMOUNT_XAF;
}

/**
 * Token cache.
 *
 * Module scope, so it survives across requests in a warm server process and is
 * re-fetched after a cold start. Deliberately NOT in the database: a token
 * that lives 15 minutes is not worth a table, and persisting credentials
 * widens the blast radius of a database leak for no gain.
 */
let cachedToken: { value: string; at: number } | null = null;
const TOKEN_TTL_MS = 12 * 60_000; // Under the ~15 min server-side expiry.

function credentials(): { account: string; password: string } {
  const account = process.env.CAMERPAY_ACCOUNT_NUMBER;
  const password = process.env.CAMERPAY_PASSWORD;

  if (!account || !password || account.includes("REPLACE_ME")) {
    throw new Error(
      "CAMERPAY_ACCOUNT_NUMBER / CAMERPAY_PASSWORD are not set in .env.local. " +
        "Get them from your CamerPay account, then restart the dev server.",
    );
  }
  return { account, password };
}

/** A request id CamerPay can correlate on. Also our idempotency handle. */
function requestId(): string {
  return crypto.randomUUID();
}

async function call<T>(
  service: CamerPayService,
  action: string,
  options: { data?: unknown; token?: string; langue?: "FR" | "EN" } = {},
): Promise<CamerPayResponse<T>> {
  const headers: Record<string, string> = {
    id: requestId(),
    langue: options.langue ?? "FR",
    application: "API_PAY",
    service,
    action,
  };

  if (options.token) headers.token = options.token;
  if (options.data !== undefined) headers.DATA = JSON.stringify(options.data);

  const response = await fetch(BASE_URL, {
    method: "GET",
    headers,
    // Never cache a payment call. A cached 202 would silently swallow a real
    // deposit request and leave the customer un-debited but marked pending.
    cache: "no-store",
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // 5xx pages are sometimes HTML. Keep the status, drop the body.
  }

  return { ...(body as object), httpStatus: response.status } as CamerPayResponse<T>;
}

/** Log-safe rendering of a token. Never print the whole thing. */
export function maskToken(token: string | undefined): string {
  if (!token) return "—";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/* ── Authentication ────────────────────────────────────────────────────── */

export async function login(): Promise<string> {
  const { account, password } = credentials();

  const response = await call<unknown>("authentification", "login", {
    data: { numeroCompte: account, motDePasse: password },
  });

  if (!response.etat || !response.token) {
    // 404 here means wrong credentials, which is worth saying plainly rather
    // than letting it surface as a generic auth failure later.
    const reason =
      response.httpStatus === 404
        ? "wrong account number or password"
        : (response.message ?? `HTTP ${response.httpStatus}`);
    throw new Error(`CamerPay login failed: ${reason}`);
  }

  cachedToken = { value: response.token, at: Date.now() };
  return response.token;
}

/** A valid token, logging in only when the cached one is missing or stale. */
export async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && Date.now() - cachedToken.at < TOKEN_TTL_MS) {
    return cachedToken.value;
  }
  return login();
}

/**
 * Call with automatic re-auth.
 *
 * A 401 means the session lapsed, not that anything is wrong — retry once with
 * a fresh token. Retrying more than once would turn a credentials problem into
 * an infinite login loop against a third party.
 */
async function authed<T>(
  service: CamerPayService,
  action: string,
  data?: unknown,
): Promise<CamerPayResponse<T>> {
  let token = await getToken();
  let response = await call<T>(service, action, { data, token });

  if (response.httpStatus === 401) {
    token = await getToken(true);
    response = await call<T>(service, action, { data, token });
  }

  return response;
}

/* ── Account ───────────────────────────────────────────────────────────── */

export async function getBalance(): Promise<CamerPayResponse<{ credit: number }>> {
  return authed<{ credit: number }>("account", "balance");
}

/** Registers the HTTPS URL CamerPay will POST callbacks to. */
export async function setCallbackUrl(url: string): Promise<CamerPayResponse> {
  if (!url.startsWith("https://")) {
    throw new Error("CamerPay requires an HTTPS callback URL. localhost will not work — use a tunnel.");
  }
  return authed("account", "change_callback", { url });
}

/* ── Transactions ──────────────────────────────────────────────────────── */

export interface DepositAccepted {
  /** CamerPay's tracking id. Store it — the callback is matched on it. */
  replyTo: string;
}

/**
 * Request a deposit (a collection from the customer's mobile money wallet).
 *
 * Returns HTTP 202 and a `replyTo` on success. THAT IS NOT A PAYMENT. The
 * customer still has to approve on their handset, and the outcome arrives
 * later — via callback, or via the reconciler asking.
 */
export async function requestDeposit(
  phone: string,
  amount: number,
): Promise<CamerPayResponse<DepositAccepted>> {
  const numeroClient = normalisePhone(phone);
  if (!numeroClient) {
    throw new Error(`Invalid phone number "${phone}". Expected 9 digits starting with 6.`);
  }
  if (!isPayableAmount(amount)) {
    throw new Error(
      `Amount ${amount} is outside CamerPay's ${MIN_AMOUNT_XAF}–${MAX_AMOUNT_XAF} FCFA range.`,
    );
  }

  return authed<DepositAccepted>("transaction", "depot", { numeroClient, montant: amount });
}

/** Look up which operator a number belongs to, before charging it. */
export async function identifyNumber(phone: string): Promise<CamerPayResponse> {
  const numero = normalisePhone(phone);
  if (!numero) throw new Error(`Invalid phone number "${phone}".`);
  return authed("transaction", "identifier", { numero });
}

/* ── Reporting — the trust anchor ──────────────────────────────────────── */

export interface TransactionReportEntry {
  id?: number;
  replyTo?: string;
  date?: string;
  numero?: string;
  montant?: number;
  etat?: boolean;
  message?: string;
}

/**
 * Ask CamerPay what actually happened.
 *
 * THIS IS THE ONLY SOURCE OF TRUTH ABOUT MONEY. Because callbacks are
 * unsigned, nothing may be credited on the strength of one — the callback
 * tells us to look, and this tells us what is true.
 *
 * Also what the reconciler uses to sweep attempts stuck pending, exactly as
 * §6 describes: webhooks get lost, and when one does, a customer has been
 * debited while the invoice still reads unpaid and nothing else will notice.
 */
export async function listTransactions(
  options: { limit?: number; id?: number } = {},
): Promise<CamerPayResponse<TransactionReportEntry[]>> {
  return authed<TransactionReportEntry[]>("rapport", "transaction", {
    limit: Math.min(options.limit ?? 25, 100),
    ...(options.id !== undefined ? { id: options.id } : {}),
  });
}

export async function listNotifications(
  options: { limit?: number; id?: number } = {},
): Promise<CamerPayResponse<unknown[]>> {
  return authed<unknown[]>("rapport", "notification", {
    limit: Math.min(options.limit ?? 25, 100),
    ...(options.id !== undefined ? { id: options.id } : {}),
  });
}

/**
 * Confirm a single transaction against CamerPay's own record.
 *
 * Returns "success" only when CamerPay itself reports `etat: true` for that
 * replyTo. Anything unknown returns "pending", never "success" — §6: providers
 * add statuses, and defaulting to success gives away product for free.
 */
export async function confirmTransaction(
  replyTo: string,
): Promise<{ status: "success" | "failed" | "pending"; amount?: number; raw?: unknown }> {
  const report = await listTransactions({ limit: 100 });

  if (!report.etat || !Array.isArray(report.data)) return { status: "pending" };

  const match = report.data.find((entry) => entry.replyTo === replyTo);
  if (!match) return { status: "pending" };

  if (match.etat === true) return { status: "success", amount: match.montant, raw: match };
  if (match.etat === false) return { status: "failed", amount: match.montant, raw: match };

  return { status: "pending", raw: match };
}
