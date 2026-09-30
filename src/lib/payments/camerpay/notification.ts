export interface CamerPayNotificationEntry {
  id?: number;
  date?: string;
  numero?: string;
  title?: string;
  message?: string;
}

export interface PaymentNotification {
  id?: number;
  date?: string;
  message: string;
  code?: string;
  /**
   * A hosted payment page the customer must open (SasPay: Orange Money and
   * other operators that settle off-phone). Nothing is charged until they do.
   */
  url?: string;
  /**
   * The name Orange shows the customer when they confirm the dialled code
   * ("PHARMACIE MOTOS"): the merchant account the money goes to. Shown before
   * they dial, so an unfamiliar name on the handset does not read as a scam.
   */
  merchantName?: string;
  /**
   * True when the operator refuses to push a prompt at all: nothing is asked
   * of the phone, and nothing is charged, until the customer dials `code`
   * themselves (Orange, since 2026-09 — see dialInstructionFromRefusal).
   */
  customerInitiated?: boolean;
  /**
   * The dial was seen: CamerPay accepted the request and only the final
   * confirmation is outstanding. The code must NOT be shown any more — a
   * customer who dials it a second time pays a second time.
   */
  received?: boolean;
  status: "instruction" | "success" | "failed";
}

export type PaymentInstruction = Omit<PaymentNotification, "status">;

export interface PaymentNotificationHint {
  phone: string;
  amount: number;
  afterNotificationId?: number;
  /** Which way the money was meant to go. A collection unless said otherwise. */
  direction?: "collect" | "payout";
  /** Receipts other attempts already settled from, as `notificationRowId` values. */
  excludeIds?: string[];
  /**
   * The customer starts this payment themselves, and we ask again until they
   * have: repeated instructions are then the SAME request, not a retry.
   */
  customerInitiated?: boolean;
}

/** How a settled notification is claimed on `payment_attempts.provider_row_id`. */
export function notificationRowId(id: number): string {
  return "notification:" + id;
}

function barePhone(value: string): string {
  return value.replace(/\D/g, "").replace(/^(00)?237/, "");
}

function containsPhone(message: string, phone: string): boolean {
  const digits = barePhone(phone);
  if (!digits) return false;
  const separated = digits.split("").map((digit) => digit + "\\D*").join("");
  return new RegExp("(?:^|\\D)" + separated + "(?:$|\\D)").test(message);
}

function containsAmount(message: string, amount: number): boolean {
  const digits = String(amount).split("").map((digit) => digit + "[\\s.,]*").join("");
  return new RegExp("(?:^|\\D)" + digits + "(?:FCFA|XAF|$|\\D)", "i").test(message);
}

/** "• Client : 691 09 89 99" on a receipt — the customer. */
const CLIENT_FIELD = /client\s*:\s*\+?([\d .]{9,})/i;
/** "Le propriétaire du numéro (691098999)" on an Orange instruction. */
const OWNER_FIELD = /num[ée]ro\s*\(\s*\+?([\d .]{9,})\)/i;
/** "• Montant : 2 000 FCFA" on a receipt. */
const AMOUNT_FIELD = /montant\s*:\s*([\d .,]+?)\s*(?:FCFA|XAF)/i;
/** "• Vous : <our account> (NAME)" — on every receipt, and never the customer. */
const ACCOUNT_LINE = /(?:^|\n|•)\s*vous\s*:[^\n•]*/gi;

/**
 * Is this notice about `phone`?
 *
 * Every receipt names OUR account on its "Vous :" line. Searching the whole
 * text for a number therefore matched any receipt whenever the customer's
 * number was the account's own — which is exactly how MTN tests from the
 * account number were matched to an Orange receipt paid by someone else. The
 * labelled field is read when there is one; otherwise the text is searched
 * with the account line removed.
 */
function isAboutCustomer(message: string, phone: string): boolean {
  const field = message.match(CLIENT_FIELD)?.[1] ?? message.match(OWNER_FIELD)?.[1];
  if (field) return barePhone(field) === barePhone(phone);
  return containsPhone(message.replace(ACCOUNT_LINE, " "), phone);
}

/** Is this notice for `amount`? The labelled "Montant :" field wins over a text search. */
function isForAmount(message: string, amount: number): boolean {
  const field = message.match(AMOUNT_FIELD)?.[1];
  if (field) {
    const whole = field.trim().replace(/\s/g, "").replace(/[.,]00$/, "").replace(/[.,]/g, "");
    return Number(whole) === amount;
  }
  return containsAmount(message, amount);
}

const SUCCESS = /(?:valid[ée]|effectu[ée]|r[ée]ussi|succ[eè]s|successful)/i;
const FAILURE = /(?:[ée]chec|failed|failure|refus[ée]?|rejet[ée]?|insuffisant|expir[ée]?)/i;
const TRANSACTION_REFERENCE = /(?:r[ée]f(?:[ée]rence)?\.?\s*transaction|transaction\s*(?:id|n[o°]))/i;
const USSD_CODE = /[#*][0-9*#]{3,}#/;
const OPEN_PHONE = /(?:composer|dial|ouvrir|open).{0,40}(?:t[ée]l[ée]phone|phone|ussd)/i;

/**
 * Which way a receipt says the money went.
 *
 * Receipts name the operation — "RETRAIT_ORANGE validé", "DEPOT_ORANGE validé".
 * A payout to the same number for the same amount reads exactly like a
 * collection otherwise, and must never settle one.
 */
function operationOf(message: string): "collect" | "payout" | undefined {
  if (/(?:^|[^a-z])(?:retrait|withdraw)/i.test(message)) return "collect";
  if (/(?:^|[^a-z])(?:d[ée]p[ôo]t|depot|deposit)/i.test(message)) return "payout";
  return undefined;
}

/**
 * Classifies the provider notifications for ONE post-initiation payment.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  OLDEST FIRST, AND A SECOND INSTRUCTION ENDS THIS REQUEST'S WINDOW.
 *
 *  Orange publishes its receipt ("RETRAIT_ORANGE validé avec succès … Réf.
 *  Transaction …") in this report. The notices above the counter captured
 *  before a request, for its number and amount, run in order: the "dial
 *  #150*…#" instruction CamerPay issued for it, then — if the customer paid —
 *  the receipt. A retry starts a new run with a new instruction.
 *
 *  This used to read newest first and stop at the first match, so on
 *  2026-09-13 a paid 14:17 collection found the 14:31 retry's instruction
 *  before its own receipt and read "pending" for ever. Now the notices are
 *  read oldest first, a final receipt settles, and meeting a SECOND
 *  instruction means the rest belongs to a later request.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function findPaymentNotification(
  rows: CamerPayNotificationEntry[],
  hint: PaymentNotificationHint,
): PaymentNotification | null {
  const direction = hint.direction ?? "collect";
  const excluded = new Set(hint.excludeIds ?? []);

  const ours = [...rows]
    .filter((row) => {
      if (!row.message) return false;
      if (
        hint.afterNotificationId !== undefined &&
        (row.id === undefined || row.id <= hint.afterNotificationId)
      ) return false;
      if (row.id !== undefined && excluded.has(notificationRowId(row.id))) return false;
      return isAboutCustomer(row.message, hint.phone) && isForAmount(row.message, hint.amount);
    })
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  let instruction: PaymentNotification | null = null;

  for (const row of ours) {
    const message = row.message!;
    const code = message.match(USSD_CODE)?.[0];

    if (code || OPEN_PHONE.test(message)) {
      // A second instruction for the same number and amount is a new request —
      // except when we are the ones asking again, waiting for the customer to
      // dial: there every ask repeats the instruction and the receipt follows.
      if (instruction && !hint.customerInitiated) break;
      if (instruction) continue;
      instruction = { id: row.id, date: row.date, message, code, status: "instruction" };
      continue;
    }

    // A final verdict must name OUR operation: an unlabelled or opposite-way
    // notice is left alone, and the transaction row or the abandonment horizon
    // decides instead.
    if (operationOf(message) !== direction) continue;

    if (FAILURE.test(message)) {
      return { id: row.id, date: row.date, message, status: "failed" };
    }
    if (SUCCESS.test(message) && TRANSACTION_REFERENCE.test(message)) {
      return { id: row.id, date: row.date, message, status: "success" };
    }
  }

  return instruction;
}

/** Returns only a real handset action; final success notices are excluded. */
export function findPaymentInstruction(
  rows: CamerPayNotificationEntry[],
  hint: PaymentNotificationHint,
): PaymentInstruction | null {
  const match = findPaymentNotification(rows, hint);
  if (!match || match.status !== "instruction") return null;
  return { id: match.id, date: match.date, message: match.message, code: match.code };
}

/** "… en composant le #150*14*307053*656703911*500# (PHARMACIE MOTOS)." */
const DIAL_MERCHANT = /#\s*\(\s*([^()]{2,80}?)\s*\)/;
/** The amount is the code's last field: "…*500#". */
const DIAL_AMOUNT = /\*(\d+)#$/;

/**
 * Orange's "the customer must start it" refusal, read as an instruction.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  SINCE 2026-09 ORANGE NO LONGER LETS A MERCHANT PULL MONEY AT A DISTANCE.
 *
 *  Too many people were scammed by withdrawal requests they did not ask for,
 *  so an Orange `retrait` is no longer a prompt pushed to the phone. CamerPay
 *  answers the request with etat:false / HTTP 404 and this message:
 *
 *    "Aucun retrait Orange de 500 n'a été détecté pour le numéro 691098999.
 *     Veuillez inviter le client à effectuer le retrait en composant le
 *     #150*14*307053*656703911*500# (PHARMACIE MOTOS)."
 *
 *  That is not a failed payment. It is the first half of one: the customer
 *  dials the code, confirms with their PIN, and the SAME request sent again is
 *  then accepted. The name in brackets is what Orange displays on the handset
 *  at confirmation.
 *
 *  The code's last field is the amount. A code for a different amount than the
 *  one we asked for is refused here rather than shown: the customer would pay
 *  a sum that no retry of ours could ever match.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function dialInstructionFromRefusal(
  message: string | null | undefined,
  amount?: number,
): PaymentInstruction | null {
  if (!message) return null;
  const code = message.match(USSD_CODE)?.[0];
  if (!code) return null;

  const codeAmount = code.match(DIAL_AMOUNT)?.[1];
  if (amount !== undefined && codeAmount !== undefined && Number(codeAmount) !== amount) return null;

  const merchantName = message.match(DIAL_MERCHANT)?.[1]?.replace(/\s+/g, " ").trim();
  return {
    message: message.replace(/\s*\n\s*/g, " ").trim(),
    code,
    customerInitiated: true,
    ...(merchantName ? { merchantName } : {}),
  };
}
