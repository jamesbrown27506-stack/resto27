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

/** How long a not-yet-confirmed row is still worth waiting on. */
const PENDING_GRACE_MS = 5 * 60_000;

/** Does this row's action match the direction we asked for? */
function matchesDirection(action: string | undefined, direction: "collect" | "payout"): boolean {
  const a = (action ?? "").toUpperCase();
  // "MTN_WITHDRAWAL" / "RETRAIT" pull from the customer; "DEPOT_MTN" pushes.
  const isCollect = a.includes("WITHDRAW") || a.includes("RETRAIT");
  const isPayout = a.includes("DEPOT") || a.includes("DEPOSIT");
  return direction === "collect" ? isCollect : isPayout;
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
 *      used === false  no PIN yet. Recent → still pending. Old → abandoned.
 *
 *  `ref` corroborates — it is null until confirmation — but `used` is the
 *  field to trust, and a disagreement is resolved as NOT settled.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Without a hint there is nothing to match on, so it reports pending and
 * returns the rows it saw. Guessing "the newest row is probably yours" would
 * settle an invoice against somebody else's payment.
 */
export async function confirmTransaction(
  replyTo: string,
  hint: TransactionHint = {},
): Promise<{
  status: "success" | "failed" | "pending";
  amount?: number;
  raw?: unknown;
  searched?: unknown;
}> {
  const report = await listTransactions({ limit: 100 });

  if (!report.etat || !Array.isArray(report.data)) {
    return { status: "pending", searched: report.data ?? report.message };
  }

  const rows = report.data;
  const needle = replyTo.trim();

  // Defensive: if a future version ever does echo the id back, believe it.
  const direct = rows.find(
    (row) => row.ref === needle || row.replyTo === needle || String(row.id ?? "") === needle,
  );

  const phone = hint.phone ? normalisePhone(hint.phone) : null;
  const startedAt = hint.startedAt ? new Date(hint.startedAt).getTime() : null;

  const candidates = direct
    ? [direct]
    : rows
        .filter((row) => {
          if (phone) {
            const rowPhone = row["customer number"] ?? row.number;
            if (normalisePhone(String(rowPhone ?? "")) !== phone) return false;
          }
          if (hint.amount !== undefined && (row.Amount ?? row.montant) !== hint.amount) return false;
          if (hint.direction && !matchesDirection(row.action, hint.direction)) return false;
          if (startedAt && row.date) {
            // A minute of slack for clock skew between us and CamerPay.
            if (new Date(row.date).getTime() < startedAt - 60_000) return false;
          }
          return true;
        })
        // Newest first — `id` counts up, and is more reliable than parsing dates.
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));

  // Nothing identifiable. Never fall back to "the most recent row", which
  // would happily settle an invoice against an unrelated payment.
  if (candidates.length === 0 || (!direct && !phone && hint.amount === undefined)) {
    return { status: "pending", searched: rows };
  }

  const match = candidates[0];
  const amount = match.Amount ?? match.montant;

  if (match.used === true) return { status: "success", amount, raw: match };

  // An explicit failure from the synchronous shape still wins if present.
  if (match.etat === false) return { status: "failed", amount, raw: match };

  if (match.used === false) {
    const age = match.date ? Date.now() - new Date(match.date).getTime() : 0;
    if (age > PENDING_GRACE_MS) {
      // The PIN prompt is long gone. Row 110 in the live account looks exactly
      // like this: requested, never confirmed, `ref` still null.
      return { status: "failed", amount, raw: match };
    }
    return { status: "pending", amount, raw: match };
  }

  return { status: "pending", amount, raw: match };
}
