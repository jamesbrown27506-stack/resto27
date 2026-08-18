import "server-only";

import { createAdminClient } from "@/lib/supabase/server";

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

/**
 * Exactly what went over the wire, for showing to CamerPay support.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  SECRETS ARE REDACTED, AND THE REDACTION IS VISIBLE.
 *
 *  This is built to be pasted into a support conversation, so a live token or
 *  a real password must not travel with it — but a field silently missing
 *  would have support debugging a request that was never sent. So anything
 *  removed is replaced by an obvious marker rather than dropped: they can see
 *  the field was present and that we withheld its value.
 * ─────────────────────────────────────────────────────────────────────────
 */
export interface CamerPayRequestTrace {
  method: "GET";
  url: string;
  headers: Record<string, string>;
  /** The DATA header, parsed back out for readability. */
  data?: unknown;
}

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
  /** The request that produced this. Added by us; never sent by CamerPay. */
  request?: CamerPayRequestTrace;
}

/** Keys whose values must never reach a support thread. */
const SECRET_DATA_KEYS = new Set(["pass", "motDePasse", "password", "pin", "code_secret"]);

function redactTrace(
  headers: Record<string, string>,
  data: unknown,
): CamerPayRequestTrace {
  const safeHeaders: Record<string, string> = { ...headers };
  if (safeHeaders.token) safeHeaders.token = `«redacted: ${maskToken(safeHeaders.token)}»`;
  // The DATA header is echoed in `data` below, parsed — no need to carry the
  // unredacted string twice.
  delete safeHeaders.DATA;

  let safeData: unknown = data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    safeData = Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([key, value]) =>
        SECRET_DATA_KEYS.has(key) ? [key, "«redacted»"] : [key, value],
      ),
    );
  }

  return { method: "GET", url: BASE_URL, headers: safeHeaders, data: safeData };
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

/**
 * A token issued by CamerPay directly, instead of one earned by logging in.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THERE ARE TWO WAYS TO AUTHENTICATE, AND ONLY ONE NEEDED A PASSWORD.
 *
 *  This client assumed the login route: account number + password, exchanged
 *  for a session token. But CamerPay also hands out a standing API token —
 *  the reference integration reads it straight from `CAMERPAY_TOKEN` and
 *  never calls `login` at all.
 *
 *  That matters when `inscription` is unavailable to you: support can issue a
 *  token for an account opened on their side, and everything downstream works
 *  with no password anywhere in the environment.
 *
 *  When set, this wins. `authentification/token` can still refresh it, and a
 *  401 still triggers one retry.
 * ─────────────────────────────────────────────────────────────────────────
 */
function presetToken(): string | null {
  const token = process.env.CAMERPAY_TOKEN?.trim();
  if (!token || token.includes("REPLACE_ME")) return null;
  return token;
}

function credentials(): { account: string; password: string } {
  const account = process.env.CAMERPAY_ACCOUNT_NUMBER;
  const password = process.env.CAMERPAY_PASSWORD;

  if (!account || !password || account.includes("REPLACE_ME")) {
    throw new Error(
      "No CamerPay credentials. Set either CAMERPAY_TOKEN (a token issued by " +
        "CamerPay), or CAMERPAY_ACCOUNT_NUMBER + CAMERPAY_PASSWORD to log in. " +
        "Restart after changing them — environment variables are read at startup.",
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

  return {
    ...(body as object),
    httpStatus: response.status,
    // Attached to EVERY call, success or failure. A 502 is exactly when
    // somebody needs to see the request, and building the trace only on
    // failure means the one you want is the one you did not capture.
    request: redactTrace(headers, options.data),
  } as CamerPayResponse<T>;
}

/** Log-safe rendering of a token. Never print the whole thing. */
export function maskToken(token: string | undefined): string {
  if (!token) return "—";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/* ── Authentication ────────────────────────────────────────────────────── */

export async function login(): Promise<string> {
  const { account, password } = credentials();

  /**
   * `numero` and `pass` — NOT `numeroCompte` / `motDePasse`.
   *
   * Those were the field names this sent originally, and they are not the ones
   * the API accepts: doc.camerpay.net specifies
   * `{"numero":"6XXXXXXXX","pass":"VOTRE_MOT_DE_PASSE"}`. With the wrong keys
   * the request is well-formed and simply never authenticates, which reads as
   * "wrong credentials" and sends you looking in the wrong place.
   */
  const response = await call<unknown>("authentification", "login", {
    data: { numero: account, pass: password },
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
  // A token issued by CamerPay needs no login and does not go stale on our
  // clock — if it lapses, the 401 retry in `authed()` refreshes it.
  const preset = presetToken();
  if (preset && !forceRefresh) return cachedToken?.value ?? preset;

  if (!forceRefresh && cachedToken && Date.now() - cachedToken.at < TOKEN_TTL_MS) {
    return cachedToken.value;
  }

  if (preset) {
    // Refresh the standing token rather than logging in with a password that
    // may not exist in this deployment at all.
    cachedToken = { value: preset, at: Date.now() };
    return refreshSession();
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

/* ── Opening an account ────────────────────────────────────────────────── */

export interface RegistrationAccepted {
  /** The provisional token. `validateAccount` must be called with THIS. */
  token: string;
  /** The confirmation code CamerPay returns, echoed back by validation. */
  code: string;
}

/**
 * Step 1 of 2 — create the account.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE ORDER IS NOT OPTIONAL. `inscription` then `validation`, and the
 *  validation call must carry the PROVISIONAL token this returns — not the
 *  session token from `login`, which does not exist yet.
 *
 *  Neither call may use `authed()` for that reason: it would attach a cached
 *  session token, or try to log in with credentials that are not yet valid.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `parrain` is the sponsoring account — the existing CamerPay number that
 * refers the new one. Sent as given; the API decides whether it is acceptable.
 */
export async function registerAccount(input: {
  numero: string;
  /** OPTIONAL — see below. */
  parrain?: string;
  pass: string;
}): Promise<CamerPayResponse<{ code: string }>> {
  const numero = normalisePhone(input.numero);
  if (!numero) {
    throw new Error(`Invalid account number "${input.numero}". Expected 9 digits starting with 6.`);
  }

  if (!input.pass || input.pass.length < 6) {
    throw new Error("The password is too short for a payment account.");
  }

  /**
   * `parrain` IS OPTIONAL, and this used to refuse to send without one.
   *
   * That was a guess made from the docs' example, which happens to include a
   * sponsor — and it meant anyone without a referring CamerPay account could
   * not register at all, with the rejection coming from us before a request
   * was ever made. An empty sponsor is now OMITTED FROM THE PAYLOAD rather
   * than sent blank, because `"parrain": ""` is a different claim from "no
   * sponsor" and only one of them is true.
   */
  const parrain = input.parrain?.trim() ? normalisePhone(input.parrain) : null;
  if (input.parrain?.trim() && !parrain) {
    throw new Error(`Invalid sponsor number "${input.parrain}". Expected 9 digits starting with 6.`);
  }

  // No token: there is no account to authenticate against yet.
  return call<{ code: string }>("authentification", "inscription", {
    data: { numero, pass: input.pass, ...(parrain ? { parrain } : {}) },
  });
}

/**
 * Step 2 of 2 — confirm the code, using the provisional token.
 *
 * The DATA shape here is INFERRED, not published: the docs say only "valide le
 * code reçu avec le token provisoire", and `inscription` hands back exactly a
 * token and a `data.code`. Sending that code back under that token is the only
 * reading that fits — but if CamerPay names the field something other than
 * `code`, the raw console on /a/camerpay sends any payload you like without a
 * code change. That is what it is there for.
 */
export async function validateAccount(input: {
  code: string;
  provisionalToken: string;
}): Promise<CamerPayResponse> {
  if (!input.code.trim()) throw new Error("The confirmation code is required.");
  if (!input.provisionalToken.trim()) {
    throw new Error("The provisional token from the inscription step is required.");
  }

  return call("authentification", "validation", {
    data: { code: input.code.trim() },
    token: input.provisionalToken.trim(),
  });
}

/**
 * Refresh the session against an existing token.
 *
 * `authentification/token` is the documented way back from a 401 — it costs
 * less than a full login and is what the docs recommend at service start-up.
 * Falls back to a full login when there is no token to refresh.
 */
export async function refreshSession(): Promise<string> {
  const current = cachedToken?.value ?? presetToken();
  if (!current) return login();

  const response = await call<unknown>("authentification", "token", { token: current });

  if (!response.etat || !response.token) {
    // A standing token that will not refresh is a support problem, not a
    // reason to try a password that may not be configured.
    if (presetToken() && !process.env.CAMERPAY_PASSWORD) {
      throw new Error(
        `CAMERPAY_TOKEN was refused (${response.message ?? `HTTP ${response.httpStatus}`}). ` +
          "Ask CamerPay to reissue it, or set CAMERPAY_ACCOUNT_NUMBER and CAMERPAY_PASSWORD instead.",
      );
    }
    return login();
  }

  cachedToken = { value: response.token, at: Date.now() };
  return response.token;
}

/**
 * Rotate the API token.
 *
 * The new value arrives in `data.token` and REPLACES the old one immediately —
 * the previous token stops working, so the cache is updated in the same breath
 * to avoid a window where every call 401s.
 */
export async function rotateToken(): Promise<CamerPayResponse<{ token: string }>> {
  const response = await authed<{ token: string }>("account", "change_token");
  const next = response.data?.token;
  if (response.etat && next) cachedToken = { value: next, at: Date.now() };
  return response;
}

/**
 * An escape hatch for actions whose payload the public docs do not specify.
 *
 * `inscription` and `validation` are named at doc.camerpay.net but their DATA
 * fields are not published, and guessing them here would produce calls that
 * fail for reasons no log could explain. This lets the CamerPay console send a
 * hand-written payload the moment support supplies the real shape, without
 * waiting on a code change.
 *
 * Deliberately NOT used by any automatic code path — it is a console tool.
 */
export async function rawCall<T = unknown>(
  service: CamerPayService,
  action: string,
  data: unknown,
  options: { authenticated?: boolean; token?: string } = {},
): Promise<CamerPayResponse<T>> {
  /**
   * An explicit token wins over the session.
   *
   * `validation` must carry the PROVISIONAL token from `inscription`, and
   * `authed()` would attach the logged-in session token instead — or try to
   * log in with credentials that do not exist yet. Without this the raw
   * console could send every call except the one it was built for.
   */
  if (options.token?.trim()) {
    return call<T>(service, action, { data, token: options.token.trim() });
  }
  if (options.authenticated === false) {
    return call<T>(service, action, { data });
  }
  return authed<T>(service, action, data);
}

/**
 * Registers the HTTPS URL CamerPay will POST callbacks to.
 *
 * The DATA key is `callbackURL`, not `url`. CamerPay's own rejection spells it
 * out — "format DATA {"callbackURL": "https://name.domaine"}" — and with the
 * wrong key the request is well-formed, carries no URL it recognises, and comes
 * back as "the callbackURL provided is invalid", which reads as a problem with
 * the address rather than with the field holding it.
 */
export async function setCallbackUrl(url: string): Promise<CamerPayResponse> {
  const trimmed = url.trim();

  if (!trimmed.startsWith("https://")) {
    throw new Error("CamerPay requires an HTTPS callback URL. localhost will not work — deploy first.");
  }

  // Rejected for being "complète et accessible" otherwise: a fragment or a
  // private host fails on their side, so catch it here where the message can
  // say which rule was broken.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`"${trimmed}" is not a valid URL.`);
  }
  if (parsed.hash) {
    throw new Error("CamerPay rejects a callback URL containing a #fragment.");
  }
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname)) {
    throw new Error(
      `"${parsed.hostname}" is not reachable from the internet. CamerPay must be able to POST to it — use your deployed domain.`,
    );
  }

  return authed("account", "change_callback", { callbackURL: trimmed });
}

/* ── Transactions ──────────────────────────────────────────────────────── */

export interface TransactionAccepted {
  /** CamerPay's tracking id. Store it — the callback is matched on it. */
  replyTo: string;
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  `retrait` COLLECTS. `depot` PAYS OUT. GETTING THIS BACKWARDS COSTS MONEY.
 *
 *  This function used to call `depot` while its own comment claimed it was
 *  "a collection from the customer's mobile money wallet". It is not.
 *  doc.camerpay.net is explicit about the direction:
 *
 *    depot   — "Envoie de la valeur vers le compte Mobile Money du client"
 *              money leaves our balance and lands in theirs.
 *    retrait — "Initie un retrait depuis le compte Mobile Money du client"
 *              money leaves their wallet and lands in ours.
 *
 *  So charging a restaurant for its subscription with `depot` would have PAID
 *  THE RESTAURANT the amount of its own invoice, and then marked the invoice
 *  paid. CamerPay has NO SANDBOX — the first test would have moved real money
 *  in the wrong direction, minimum 500 FCFA a go.
 *
 *  The two directions now have names that cannot be confused, and the payout
 *  side is deliberately not exported until something actually needs to refund.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * CHARGE a customer — pulls from their Mobile Money wallet into our account.
 * This is what an invoice payment uses.
 *
 * Returns HTTP 202 and a `replyTo` on success. THAT IS NOT A PAYMENT. The
 * customer still has to approve on their handset, and the outcome arrives
 * later — via callback, or via the reconciler asking.
 */
export async function requestCollection(
  phone: string,
  amount: number,
): Promise<CamerPayResponse<TransactionAccepted>> {
  const numeroClient = normalisePhone(phone);
  if (!numeroClient) {
    throw new Error(`Invalid phone number "${phone}". Expected 9 digits starting with 6.`);
  }
  if (!isPayableAmount(amount)) {
    throw new Error(
      `Amount ${amount} is outside CamerPay's ${MIN_AMOUNT_XAF}–${MAX_AMOUNT_XAF} FCFA range.`,
    );
  }

  return authed<TransactionAccepted>("transaction", "retrait", { numeroClient, montant: amount });
}

/**
 * PAY OUT to a customer — sends money from our balance to their wallet.
 *
 * Nothing calls this yet. It exists so that the day a refund is built, the
 * correct action is already named and documented rather than being reached for
 * in a hurry beside a function called "deposit".
 */
export async function sendPayout(
  phone: string,
  amount: number,
): Promise<CamerPayResponse<TransactionAccepted>> {
  const numeroClient = normalisePhone(phone);
  if (!numeroClient) {
    throw new Error(`Invalid phone number "${phone}". Expected 9 digits starting with 6.`);
  }
  if (!isPayableAmount(amount)) {
    throw new Error(
      `Amount ${amount} is outside CamerPay's ${MIN_AMOUNT_XAF}–${MAX_AMOUNT_XAF} FCFA range.`,
    );
  }

  return authed<TransactionAccepted>("transaction", "depot", { numeroClient, montant: amount });
}

/** Look up which operator a number belongs to, before charging it. */
export async function identifyNumber(phone: string): Promise<CamerPayResponse> {
  const numero = normalisePhone(phone);
  if (!numero) throw new Error(`Invalid phone number "${phone}".`);
  return authed("transaction", "identifier", { numero });
}

/* ── Reporting — the trust anchor ──────────────────────────────────────── */

/**
 * A row of `rapport/transaction`, as CamerPay ACTUALLY returns it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE FIELDS ARE NOT THE ONES THE REST OF THE DOCS IMPLY.
 *
 *  This was typed as {replyTo, etat, montant, message} — the shape the
 *  synchronous responses use. The report uses none of those. A real row:
 *
 *    { id: 111, ref: "18320599606", date: "2026-08-12T15:12:45.000",
 *      number: "679534849", username: "…", "customer number": "679534849",
 *      Amount: 500, action: "MTN_WITHDRAWAL", used: true, Response: "…" }
 *
 *  Capital `Amount`, capital `Response`, a key with a SPACE in it, and — the
 *  part that broke everything — NO `replyTo` and NO `etat`. The tracking id
 *  returned by the 202 is never echoed back here, so matching on it could
 *  only ever fail, and every settled transaction read as pending for ever.
 *
 *  `used` is the outcome. `ref` is the operator's reference and is null until
 *  the customer confirms — the two agree, and `used` is the one to trust.
 * ─────────────────────────────────────────────────────────────────────────
 */
export interface TransactionReportEntry {
  id?: number;
  /** Operator reference. NULL until the customer approves. */
  ref?: string | null;
  date?: string;
  /** The account's number. */
  number?: string;
  username?: string;
  /** Yes, with a space. */
  "customer number"?: string;
  /** Capital A. */
  Amount?: number;
  /** "MTN_WITHDRAWAL" (a collection) or "DEPOT_MTN" (a payout). */
  action?: string;
  /** TRUE once the customer has entered their PIN. This is the outcome. */
  used?: boolean;
  /** Capital R — the ACKNOWLEDGEMENT text, not the result. */
  Response?: string;

  // Variants observed on a live account (2026-08-12): the report answered with
  // LOWERCASE keys (numero/numeroClient/montant/reponse) where the earlier
  // example showed mixed case. confirmTransaction reads BOTH spellings — a key
  // miss is exactly how a settled row silently fails to match and reads as
  // pending forever. (`montant` is declared below in the sync-endpoint block.)
  numero?: string;
  numeroClient?: string;
  amount?: number;
  reponse?: string;
  phone?: string;

  // Kept because the synchronous endpoints do use them.
  replyTo?: string;
  etat?: boolean;
  montant?: number;
  message?: string;
}

/** What we know about a transaction we started, used to find its row. */
export interface TransactionHint {
  /** The number charged or paid. */
  phone?: string;
  /** Whole francs, as requested. */
  amount?: number;
  /** Which way the money was meant to go. */
  direction?: "collect" | "payout";
  /** ISO instant the request was accepted. */
  startedAt?: string;
  /**
   * Report rows another attempt has already consumed.
   *
   * Two attempts from one number for one amount (a retry after the customer
   * let the prompt lapse) look IDENTICAL to the matcher, so both would settle
   * against the single row the customer actually approved. Rows listed here
   * are skipped, and the caller records the row it consumed so the database
   * refuses the second claim outright — this list only steers the match
   * towards the right row, it is not the guard.
   */
  excludeRowIds?: string[];
  /**
   * The highest report `id` that existed BEFORE the request was sent.
   *
   * This is the reliable half of the match. CamerPay's `date` carries no
   * timezone — "2026-08-12T16:02:11.000" is parsed as local time, so on a UTC
   * server a Cameroon (UTC+1) timestamp lands an hour out and a time window
   * either rejects the right row or admits a stale one. `id` counts up and
   * needs no clock: our row is the first one above this number.
   */
  afterId?: number;
}

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
 * Africa/Douala is UTC+1 all year — no DST, ever (0011 §2) — so a fixed offset
 * is exact, which is why this needs no library.
 */
const DOUALA_OFFSET_MS = 60 * 60_000;

/**
 * A report timestamp as an instant.
 *
 * CamerPay sends "2026-08-12T15:12:45.000": no zone, and the clock behind it is
 * Douala's. `new Date(...)` reads a naive string in the SERVER's zone, so on a
 * UTC host every row parses an hour older than it really is — old enough, on a
 * five-minute rule, to condemn a payment on its very first poll. Anything that
 * does carry a zone is believed as sent.
 */
function parseProviderDate(value: string | null | undefined): number | null {
  const text = value == null ? "" : String(value).trim();
  if (!text) return null;

  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const ms = Date.parse(zoned ? text : `${text.replace(" ", "T")}Z`);
  if (Number.isNaN(ms)) return null;
  return zoned ? ms : ms - DOUALA_OFFSET_MS;
}

/**
 * Response text that means the collection is DEAD, not merely unfinished.
 *
 * Age is not evidence: mobile-money PIN entry regularly runs past any grace
 * period worth setting, and a row that is simply "not confirmed yet" must stay
 * pending so the reconciler keeps sweeping it. Only an operator saying so
 * counts. Deliberately excludes "annul"/"cancel" — the acknowledgement text
 * itself says "ne pas annuler", and matching that would fail live payments.
 */
const CONCLUSIVE_FAILURE = /(echec|échec|failed|failure|refus|rejet|insuffis|expir)/i;

/** Which way a report row's action moves money, when it can be told. */
function directionFor(action: string | undefined): "collect" | "payout" | undefined {
  const a = (action ?? "").toUpperCase();
  // "MTN_WITHDRAWAL" / "RETRAIT" pull from the customer; "DEPOT_MTN" pushes.
  if (a.includes("WITHDRAW") || a.includes("RETRAIT")) return "collect";
  if (a.includes("DEPOT") || a.includes("DEPOSIT")) return "payout";
  return undefined;
}

/** Does this row's action match the direction we asked for? */
function matchesDirection(action: string | undefined, direction: "collect" | "payout"): boolean {
  return directionFor(action) === direction;
}

/** Every spelling of the customer-number key seen from CamerPay's report. */
function rowPhone(row: TransactionReportEntry): string | undefined {
  const raw = row["customer number"] ?? row.number ?? row.numero ?? row.numeroClient ?? row.phone;
  return raw != null ? String(raw) : undefined;
}

/** Every spelling of the amount key seen from CamerPay's report. */
function rowAmount(row: TransactionReportEntry): number | undefined {
  return row.Amount ?? row.montant ?? row.amount;
}

/**
 * The identity of a report row, as something storable.
 *
 * `id` is CamerPay's own counter and is what a row is claimed under; `ref` (the
 * operator's reference) is the fallback for a report shape that omits it. A row
 * with neither cannot be claimed, and a claim is what stops two attempts
 * settling from one payment — so the caller must treat `undefined` as "not
 * safely identifiable", not as "no constraint needed".
 */
export function reportRowId(row: TransactionReportEntry): string | undefined {
  if (row.id !== undefined && row.id !== null) return String(row.id);
  if (row.ref) return String(row.ref);
  return undefined;
}

/**
 * Confirm a single transaction against CamerPay's own record.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE REPORT DOES NOT CONTAIN OUR TRACKING ID, SO WE MATCH ON FACTS.
 *
 *  `requestCollection` gets back a `replyTo` like
 *  "20260812-1419-8828-b833-29157b0f1eec" — and that string appears in NO
 *  field of `rapport/transaction`. Not `ref` (that is the operator's own
 *  reference, assigned later), not `id` (CamerPay's row counter). Matching on
 *  it was matching on something that is never there, which is why a
 *  transaction the customer had visibly paid still read as pending.
 *
 *  So a row is identified by what we know to be true about the request we
 *  made: the number, the amount, the direction, and the fact that it must
 *  have happened AFTER we asked. The newest row satisfying all four is ours.
 *
 *  Then `used` decides:
 *      used === true   the customer entered their PIN. Settled.
 *      used === false  no PIN yet — PENDING however old the row looks; only
 *                      the provider saying so makes it failed.
 *
 *  `ref` corroborates — it is null until confirmation — but `used` is the
 *  field to trust, and a disagreement is resolved as NOT settled.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Without a hint there is nothing to match on, so it reports pending and
 * returns the rows it saw. Guessing "the newest row is probably yours" would
 * settle an invoice against somebody else's payment.
 */
/**
 * The newest report id right now.
 *
 * Taken immediately BEFORE a charge so the row it creates can be identified
 * without trusting a timestamp. Returns null on failure — matching then falls
 * back to number/amount/direction, which is weaker but not wrong.
 */
export async function latestTransactionId(): Promise<number | null> {
  try {
    const report = await listTransactions({ limit: 1 });
    if (!report.etat || !Array.isArray(report.data) || report.data.length === 0) return null;
    return report.data[0].id ?? null;
  } catch {
    return null;
  }
}
/* ── The request ledger ─────────────────────────────────────────────────── */

export interface CamerPayRequestRecord {
  replyTo: string;
  direction: "collect" | "payout";
  phone: string;
  amount: number;
  afterId?: number | null;
  startedAt?: string;
  status: "pending" | "success" | "failed";
}

/**
 * Remember an accepted request (the HTTP 202) under its `replyTo`.
 *
 * Called by the Server Actions the moment CamerPay returns a tracking id.
 * This is the row the webhook will find when the callback arrives: the report
 * never echoes `replyTo`, so a callback carrying only that id would otherwise
 * have nothing to locate the report row by, and every confirmation would
 * read as pending.
 *
 * Bookkeeping, never an authority on money: a write failure is logged and the
 * request proceeds — the report remains the source of truth.
 */
export async function recordAcceptedRequest(input: {
  replyTo: string;
  direction: "collect" | "payout";
  phone: string;
  amount: number;
  afterId?: number | null;
  startedAt?: string;
}): Promise<void> {
  const replyTo = input.replyTo.trim();
  if (!replyTo) return;

  try {
    const supabase = createAdminClient();
    await supabase
      .from("camerpay_requests")
      .upsert(
        {
          reply_to: replyTo,
          direction: input.direction,
          phone: input.phone,
          amount: input.amount,
          after_id: input.afterId ?? null,
          started_at: input.startedAt ?? new Date().toISOString(),
          status: "pending",
        },
        { onConflict: "reply_to", ignoreDuplicates: true },
      );
  } catch (error) {
    console.error("[camerpay] could not record accepted request", replyTo, error);
  }
}

/**
 * Record a withheld withdrawal fee (migration 0022) — the platform's revenue.
 *
 * Called by the payout action at ACCEPTANCE time, once per payout that carried
 * a fee. Bookkeeping, never an authority on money: a write failure is logged
 * and the payout proceeds — the fee is still withheld either way, it is just
 * missing from the dashboard sum.
 */
export async function recordWithdrawalFee(input: {
  replyTo: string;
  phone: string;
  gross: number;
  fee: number;
  net: number;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from("withdrawal_fees").insert({
      reply_to: input.replyTo,
      phone: input.phone,
      gross: input.gross,
      fee: input.fee,
      net: input.net,
    });
  } catch (error) {
    console.error("[camerpay] could not record withdrawal fee", input.replyTo, error);
  }
}

/** The ledger row for a `replyTo`, when the console wrote one. */
export async function findRequestByReplyTo(replyTo: string): Promise<CamerPayRequestRecord | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("camerpay_requests")
      .select("reply_to, direction, phone, amount, after_id, started_at, status")
      .eq("reply_to", replyTo)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      replyTo: data.reply_to,
      direction: data.direction,
      phone: data.phone,
      amount: data.amount,
      afterId: data.after_id,
      startedAt: data.started_at,
      status: data.status,
    };
  } catch (error) {
    console.error("[camerpay] could not read request ledger", replyTo, error);
    return null;
  }
}

/**
 * Write (or refresh) the ledger row for a confirmed `replyTo`.
 *
 * Every terminal outcome lands here, whether it was reached from the admin
 * console or from a callback, so the record never claims a stale "pending".
 * The row is created only when the facts needed to find the report row are
 * actually known — a bare status without a number and an amount has nothing
 * to be regenerated from, and must not displace the console's full record.
 */
async function persistResolution(
  replyTo: string,
  input: {
    direction?: "collect" | "payout";
    phone?: string;
    amount?: number;
    afterId?: number;
    startedAt?: string;
    status: "pending" | "success" | "failed";
  },
): Promise<void> {
  if (!replyTo) return;

  try {
    const supabase = createAdminClient();
    const { data: existing } = await supabase
      .from("camerpay_requests")
      .select("id")
      .eq("reply_to", replyTo)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("camerpay_requests")
        .update({ status: input.status, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      return;
    }

    if (!input.phone || input.amount === undefined) return;

    await supabase.from("camerpay_requests").insert({
      reply_to: replyTo,
      direction: input.direction ?? "collect",
      phone: input.phone,
      amount: input.amount,
      after_id: input.afterId ?? null,
      started_at: input.startedAt ?? new Date().toISOString(),
      status: input.status,
    });
  } catch (error) {
    console.error("[camerpay] could not persist resolution", replyTo, error);
  }
}

export async function confirmTransaction(
  replyTo: string,
  hint: TransactionHint = {},
): Promise<{
  status: "success" | "failed" | "pending";
  amount?: number;
  /** The report row this verdict came from, for the caller to claim. */
  rowId?: string;
  raw?: unknown;
  searched?: unknown;
}> {
  const report = await listTransactions({ limit: 100 });

  if (!report.etat || !Array.isArray(report.data)) {
    return { status: "pending", searched: report.data ?? report.message };
  }

  const rows = report.data;
  const needle = replyTo.trim();
  const consumed = new Set(hint.excludeRowIds ?? []);
  const available = (row: TransactionReportEntry) => {
    const id = reportRowId(row);
    return !id || !consumed.has(id);
  };

  // Defensive: if a future version ever does echo the id back, believe it.
  const direct = rows.find(
    (row) =>
      available(row) &&
      (row.ref === needle || row.replyTo === needle || String(row.id ?? "") === needle),
  );

  /**
   * THE LEDGER, WHEN THE CALLER HAS NO FACTS.
   *
   * The browser session knows the number/amount/direction while a test is
   * running. The webhook receives a callback carrying ONLY the `replyTo` —
   * and the report never echoes it. So when a hint is missing any identifying
   * fact, the request ledger (written when the 202 was accepted) supplies it,
   * making the report row findable. Without this, every callback confirms as
   * "pending" no matter what actually happened.
   */
  let effective = hint;
  const needsFacts = !hint.phone || hint.amount === undefined || hint.direction === undefined;
  if (needsFacts) {
    const ledger = await findRequestByReplyTo(needle);
    if (ledger) {
      // Fill only what the caller omitted, so a partial hint (say, a phone
      // typed into the Confirm panel) still gets the amount and direction the
      // console recorded at initiation.
      effective = {
        phone: hint.phone ?? ledger.phone,
        amount: hint.amount ?? ledger.amount,
        direction: hint.direction ?? ledger.direction,
        startedAt: hint.startedAt ?? ledger.startedAt ?? undefined,
        afterId: hint.afterId ?? ledger.afterId ?? undefined,
      };
    }
  }

  const phone = effective.phone ? normalisePhone(effective.phone) : null;
  const startedAt = effective.startedAt ? new Date(effective.startedAt).getTime() : null;

  const candidates = direct
    ? [direct]
    : rows
        .filter((row) => {
          if (!available(row)) return false;
          if (phone) {
            // The report's customer-number key has appeared as "customer
            // number", number, numero AND numeroClient across accounts and
            // versions. Reading one spelling is how a correct row silently
            // fails to match and a paid transaction reads as pending.
            if (normalisePhone(rowPhone(row) ?? "") !== phone) return false;
          }
          if (effective.amount !== undefined && rowAmount(row) !== effective.amount) return false;
          if (effective.direction && !matchesDirection(row.action, effective.direction)) return false;

          // The precise test, when we have it: our row is above the counter as
          // it stood before we asked.
          if (effective.afterId !== undefined && (row.id ?? 0) <= effective.afterId) return false;

          /**
           * The date is only a COARSE guard, and only when there is no
           * afterId. CamerPay sends no timezone, so this is generous by hours
           * on purpose — its job is to exclude last week, not last minute.
           * Tightening it is how a correct row gets rejected on a server whose
           * clock sits in a different zone from Douala.
           */
          if (effective.afterId === undefined && startedAt && row.date) {
            const TOLERANCE_MS = 6 * 60 * 60_000;
            const rowAt = parseProviderDate(row.date);
            if (rowAt !== null && rowAt < startedAt - TOLERANCE_MS) return false;
          }
          return true;
        })
        // Newest first — `id` counts up, and is more reliable than parsing dates.
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));

  // Nothing identifiable. Never fall back to "the most recent row", which
  // would happily settle an invoice against an unrelated payment.
  if (candidates.length === 0 || (!direct && !phone && effective.amount === undefined)) {
    return { status: "pending", searched: rows };
  }

  const match = candidates[0];
  const amount = rowAmount(match);
  const rowId = reportRowId(match);

  /**
   * A VERDICT OF `failed` NEEDS EVIDENCE, NOT A STOPWATCH.
   *
   * `used: false` means only "the customer has not confirmed YET". This used to
   * turn into `failed` five minutes on, which is inside the time real people
   * take to find their phone and enter a PIN — and, because the row's naive
   * timestamp was read in the server's zone, a UTC host could reach that age on
   * the first poll of a payment made seconds earlier. Both halves of that are
   * fixed here: unresolved is PENDING, and the reconciler's abandonment horizon
   * (hours, not minutes) is the only thing that gives up on it.
   */
  const responseText = String(match.Response ?? match.reponse ?? match.message ?? "");

  let status: "success" | "failed" | "pending";
  if (match.used === true) {
    // The customer entered their PIN. Settled.
    status = "success";
  } else if (match.etat === false) {
    // An explicit failure from the synchronous shape still wins if present.
    status = "failed";
  } else if (CONCLUSIVE_FAILURE.test(responseText)) {
    status = "failed";
  } else {
    status = "pending";
  }

  // Persist the outcome — and, if this check started from a ledger row, the
  // verdict — so the webhook and any later check carrying only the replyTo
  // reach the same conclusion without the initiating browser session.
  if (status !== "pending") {
    await persistResolution(needle, {
      direction: effective.direction ?? directionFor(match.action),
      phone: effective.phone ?? rowPhone(match),
      amount: amount ?? effective.amount,
      afterId: effective.afterId,
      startedAt: effective.startedAt,
      status,
    });
  }

  return { status, amount, rowId, raw: match };
}
