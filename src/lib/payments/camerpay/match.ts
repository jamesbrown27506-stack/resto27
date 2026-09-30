/**
 * Pure matching rules for CamerPay's transaction report — no network, no
 * database, so they are tested against real rows (match.test.ts).
 *
 * The report never echoes the tracking id a collection returns, so a row is
 * identified by facts: the customer's number, the amount, the direction, and
 * the report counter as it stood just before the request was sent.
 */

/** The fields of a report row this module reads. `TransactionReportEntry` (client.ts) is a superset. */
export interface ReportRow {
  id?: number;
  /** Operator reference. NULL until the customer approves. */
  ref?: string | null;
  replyTo?: string;
  date?: string;
  /** "RETRAIT_ORANGE", "MTN_WITHDRAWAL" (collections) or "DEPOT_MTN" (payouts). */
  action?: string;
  "customer number"?: string;
  number?: string;
  numero?: string;
  numeroClient?: string;
  phone?: string;
  Amount?: number;
  montant?: number;
  amount?: number;
  /**
   * TRUE once the request is FINISHED — paid, refused or failed alike. It is
   * not proof of payment; see rowOutcome.
   */
  used?: boolean;
  /** The operator's answer, under each spelling the report has used. */
  reponse?: string | null;
  Response?: string | null;
  message?: string | null;
  /** Only on the synchronous shape. */
  etat?: boolean;
}

/** The operator's own reference on a row, or "" when there is none. */
export function rowRef(row: ReportRow): string {
  return row.ref == null ? "" : String(row.ref).trim();
}

/** The operator's answer text on a row. */
export function rowResponse(row: ReportRow): string {
  return String(row.reponse ?? row.Response ?? row.message ?? "");
}

/** "… en composant le #150*14*307053*656703911*800# …" — a code to dial. */
const DIAL_CODE = /[#*][0-9*#]{3,}#/;

/**
 * Words that mean the operator ended the request without moving money.
 * Deliberately excludes "annul"/"cancel": MTN's acknowledgement text says "ne
 * pas annuler", and matching that would fail live payments.
 */
const FAILURE_TEXT =
  /(echec|échec|failed|failure|refus|rejet|insuffis|expir|erreur|error|invalide|incorrect|indisponible|impossible|introuvable)/i;

/** What one report row proves about the request that created it. */
export type RowOutcome =
  /** Money moved: the operator issued a reference for it. */
  | "paid"
  /** The operator ended it without money. */
  | "failed"
  /** Orange refused to push a prompt: the customer must dial the code first. */
  | "dial"
  /** Nothing conclusive yet. */
  | "pending";

/**
 * Read one report row.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  `used: true` IS NOT A PAYMENT. THE OPERATOR'S REFERENCE IS.
 *
 *  This code used to settle on `used === true`. The live report of 2026-09-30
 *  (87 rows) shows what `used` really is — "this request is finished":
 *
 *    RETRAIT_ORANGE  used  ref "CO260930.0949.B50907"  ""            PAID
 *    RETRAIT_MTN     used  ref "18775677304"           "Demande de…" PAID
 *    DEPOT_MTN       used  ref "19013835970"           "Dépôt effectué avec succès…"
 *    RETRAIT_MTN     used  ref null   "Le solde du compte est insuffisant…"
 *    RETRAIT_MTN     used  ref null   "Une erreur technique inconnue…"
 *    RETRAIT_ORANGE  used  ref null   "Aucun retrait Orange de 800 n'a été
 *                                      détecté… en composant le #150*…#"
 *    RETRAIT_MTN     unused           "Demande de retrait effectue. Le client
 *                                      doit confirmer…"            WAITING
 *
 *  Every row that moved money carries the operator's reference, and no row
 *  that failed does. Settling on `used` marked two orders paid on 2026-09-17
 *  from rows reading "Une erreur technique inconnue", and on 2026-09-30 showed
 *  an Orange payment as settled one second after Orange said no withdrawal
 *  had been detected.
 *
 *  So: PAID needs `used` AND a reference AND an answer that is not a failure.
 *  A finished row with no reference is a failure when the operator says so in
 *  words, the Orange "dial this code" refusal when it carries a code, and
 *  otherwise simply not proof of anything — pending, for the window to close.
 *  Nothing here ever turns doubt into a payment.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function rowOutcome(row: ReportRow): RowOutcome {
  const text = rowResponse(row);
  const failureText = FAILURE_TEXT.test(text);

  if (row.used === true && rowRef(row) && !failureText && row.etat !== false) return "paid";
  // An explicit failure from the synchronous shape still wins if present.
  if (row.etat === false) return "failed";
  if (row.used === true && DIAL_CODE.test(text)) return "dial";
  if (failureText) return "failed";
  return "pending";
}

/**
 * What a settled payment is claimed under (payment_attempts.provider_row_id).
 *
 * The operator's reference, because it is the one identity a payment has in
 * BOTH reports: the transaction row carries it as `ref` and the receipt as
 * "Réf. Transaction". Claiming the row by its id and the receipt by its own id
 * let two attempts settle from one real payment — one through each report —
 * and the second was then "refunded" as a late payment: money paid out that
 * had been received once.
 */
export function referenceClaimId(reference: string): string {
  return "ref:" + reference.trim();
}

/** Every id a row could have been claimed under, newest convention first. */
export function rowClaimIds(row: ReportRow): string[] {
  const ids: string[] = [];
  const ref = rowRef(row);
  if (ref) ids.push(referenceClaimId(ref));
  const legacy = reportRowId(row);
  if (legacy) ids.push(legacy);
  return ids;
}

/** Phone numbers must be exactly 9 digits starting with 6, no +237 prefix. */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  // Accept the forms people actually type: 237XXXXXXXXX, 00237…, or bare.
  const bare = digits.replace(/^(00)?237/, "");
  return /^6\d{8}$/.test(bare) ? bare : null;
}

/** Which way a report row's action moves money, when it can be told. */
export function directionFor(action: string | undefined): "collect" | "payout" | undefined {
  const a = (action ?? "").toUpperCase();
  // "MTN_WITHDRAWAL" / "RETRAIT_ORANGE" pull from the customer; "DEPOT_MTN" pushes.
  if (a.includes("WITHDRAW") || a.includes("RETRAIT")) return "collect";
  if (a.includes("DEPOT") || a.includes("DEPOSIT")) return "payout";
  return undefined;
}

/**
 * The CUSTOMER's number on a report row — never the account's.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  `numero` AND `number` ARE OUR OWN ACCOUNT. THEY ARE NOT THE CUSTOMER.
 *
 *  The live report (2026-09-13) reads:
 *    { numero: "<our CamerPay account>", numeroClient: "<customer>", … }
 *  and the older shape put the account in `number` beside "customer number".
 *  This used to fall back through `number` and `numero` BEFORE `numeroClient`,
 *  so every row was read as belonging to our own account. MTN tests happened
 *  to pay from the account's own number and matched; every Orange payment
 *  from a customer's number matched nothing and stayed pending for ever.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function rowPhone(row: ReportRow): string | undefined {
  const raw = row["customer number"] ?? row.numeroClient ?? row.phone;
  return raw != null ? String(raw) : undefined;
}

/** Every spelling of the amount key seen from CamerPay's report. */
export function rowAmount(row: ReportRow): number | undefined {
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
export function reportRowId(row: ReportRow): string | undefined {
  if (row.id !== undefined && row.id !== null) return String(row.id);
  if (row.ref) return String(row.ref);
  return undefined;
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
 * UTC host every row parses an hour older than it really is. Anything that does
 * carry a zone is believed as sent.
 */
export function parseProviderDate(value: string | null | undefined): number | null {
  const text = value == null ? "" : String(value).trim();
  if (!text) return null;

  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const ms = Date.parse(zoned ? text : `${text.replace(" ", "T")}Z`);
  if (Number.isNaN(ms)) return null;
  return zoned ? ms : ms - DOUALA_OFFSET_MS;
}

export interface ReportMatchFacts {
  /** The tracking id we hold, believed if a future report ever echoes it. */
  needle: string;
  /** Normalised customer number, or null when unknown. */
  phone: string | null;
  amount?: number;
  direction?: "collect" | "payout";
  /** The highest report id that existed BEFORE the request was sent. */
  afterId?: number;
  /** When the request was sent (ms), a coarse guard used only without afterId. */
  startedAt?: number | null;
  /** Row ids other attempts have already settled from. */
  exclude: ReadonlySet<string>;
  /**
   * The customer starts this payment themselves (Orange: they dial a code,
   * then we ask again). See selectReportRow.
   */
  customerInitiated?: boolean;
}

/**
 * The report row a request created, or undefined when none can be told apart.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE FIRST ROW ABOVE THE COUNTER, NOT THE NEWEST.
 *
 *  This used to take the NEWEST row matching the number, amount and direction.
 *  On 2026-09-13 a customer paid 500 FCFA by Orange at 14:17 (row #149, used),
 *  then tried again at 14:23 and 14:31 (rows #150 and #151, never approved).
 *  Every check on the 14:17 payment then picked #151 and answered "pending" —
 *  for a payment the customer's phone had already confirmed.
 *
 *  A request's own row is the first one created after the counter it captured;
 *  a retry from the same number for the same amount comes later and captures a
 *  higher counter. So with `afterId` the oldest qualifying row wins. Without
 *  it (legacy callers) the newest still does.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function selectReportRow<T extends ReportRow>(rows: T[], facts: ReportMatchFacts): T | undefined {
  // A row is taken when another attempt claimed it under ANY of its ids — its
  // operator reference (today) or its report id (claims made before that).
  const available = (row: T) => rowClaimIds(row).every((id) => !facts.exclude.has(id));

  // Defensive: if a future version ever does echo the id back, believe it.
  const needle = facts.needle.trim();
  if (needle) {
    const direct = rows.find(
      (row) => available(row) && (row.ref === needle || row.replyTo === needle || String(row.id ?? "") === needle),
    );
    if (direct) return direct;
  }

  // Nothing identifying: never guess "the most recent row", which would
  // happily settle an invoice against an unrelated payment.
  if (!facts.phone && facts.amount === undefined) return undefined;

  const candidates = rows.filter((row) => {
    if (!available(row)) return false;
    // The report's customer-number key has appeared under several spellings;
    // reading one is how a correct row silently fails to match.
    if (facts.phone && normalisePhone(rowPhone(row) ?? "") !== facts.phone) return false;
    if (facts.amount !== undefined && rowAmount(row) !== facts.amount) return false;
    if (facts.direction && directionFor(row.action) !== facts.direction) return false;

    // The precise test, when we have it: our row is above the counter as it
    // stood before we asked.
    if (facts.afterId !== undefined && (row.id ?? 0) <= facts.afterId) return false;

    // Without the counter, the date is the only thing that says a row belongs
    // to THIS request and not to an earlier payment of the same amount from
    // the same number. This was generous by six hours when the report's
    // timezone-less dates were being misread; parseProviderDate reads them
    // exactly now (Douala, UTC+1), and six hours was wide enough to settle a
    // new order from a payment made for an old one. Minutes, for clock skew.
    if (facts.afterId === undefined && facts.startedAt && row.date) {
      const TOLERANCE_MS = 5 * 60_000;
      const rowAt = parseProviderDate(row.date);
      if (rowAt !== null && rowAt < facts.startedAt - TOLERANCE_MS) return false;
    }
    return true;
  });

  const byId = facts.afterId !== undefined
    ? (a: T, b: T) => (a.id ?? 0) - (b.id ?? 0)
    : (a: T, b: T) => (b.id ?? 0) - (a.id ?? 0);
  const ordered = candidates.sort(byId);

  /*
    A CUSTOMER-INITIATED PAYMENT ASKS SEVERAL TIMES, AND ONLY ONE ASK IS PAID.

    Orange no longer accepts a collection pushed by the merchant: the first
    `retrait` is refused with a code to dial, and the same request is sent
    again until the customer has dialled it. Each ask may leave its own row,
    so "the first row above the counter" is an unpaid one and the payment
    would read pending for ever. Here the paid row IS the payment: the oldest
    PAID row above the counter wins (rowOutcome — a reference, not merely
    `used`: every refused ask is `used` too), and only without one does the
    first row stand in as evidence that the request exists.
  */
  // Only with something that bounds the search to this request: a paid row
  // picked from an unbounded list could be anybody's earlier payment.
  if (facts.customerInitiated && (facts.afterId !== undefined || facts.startedAt)) {
    const paid = ordered.find((row) => rowOutcome(row) === "paid");
    if (paid) return paid;
  }
  return ordered[0];
}
