/**
 * What a table costs to hold, and how that number is arrived at.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THREE SHAPES, AND WHY THE THIRD ONE EXISTS.
 *
 *   fixed    — one amount in FCFA, whatever the party size. Charged online at
 *              booking and deducted from the final bill.
 *   per_seat — an amount in FCFA PER GUEST, multiplied by the party size.
 *              Charged and deducted the same way.
 *   percent  — a share of the final bill. NEVER charged online, because the
 *              bill does not exist at booking; the restaurant collects it on
 *              site against the real total.
 *
 *  `per_seat` is here because a flat fee prices the wrong thing. Holding a
 *  table of ten empty on a Saturday costs a restaurant five times what an
 *  empty two-top costs, and one number cannot be both large enough to deter
 *  the first and small enough not to deter the second. The seats are what is
 *  being risked, so the seats are what is charged for.
 *
 *  ONE MODULE, BECAUSE TWO SIDES MUST AGREE. The booking form shows the
 *  customer a total before they type their Mobile Money number, and the
 *  server charges a total after they press the button. If those are computed
 *  by two separate expressions they will disagree the first time either is
 *  edited — and the disagreement is money, taken from a real person, that
 *  does not match what they were shown.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const DEPOSIT_TYPES = ["fixed", "per_seat", "percent"] as const;

export type DepositType = (typeof DEPOSIT_TYPES)[number];

/** Anything unrecognised — including a database that predates the column. */
export function normaliseDepositType(value: unknown): DepositType {
  return DEPOSIT_TYPES.includes(value as DepositType) ? (value as DepositType) : "fixed";
}

export interface DepositConfig {
  /** FCFA for `fixed`, FCFA-per-guest for `per_seat`, a percentage for `percent`. */
  amount: number;
  type: DepositType;
}

/**
 * The amount actually charged online at booking, in FCFA.
 *
 * Zero means nothing is taken now — either the restaurant asks for no fee, or
 * it asks for a percentage of a bill that does not exist yet. Both cases must
 * be zero here and not merely "small", because a non-zero return is what sends
 * the customer to a Mobile Money prompt.
 */
export function depositChargedNow(config: DepositConfig, partySize: number): number {
  const amount = Number(config.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  switch (config.type) {
    case "fixed":
      return Math.round(amount);
    case "per_seat":
      return Math.round(amount) * seats(partySize);
    case "percent":
      return 0;
  }
}

/**
 * The multiplier, floored at one guest.
 *
 * The finite check is not defensive decoration: `Math.max(1, NaN)` is NaN, not
 * 1, so an empty or half-typed guests field — the input is a text field the
 * browser will happily let you clear — would otherwise produce a NaN charge
 * and hand it to the payment provider. A booking is at least one seat; a
 * number that is not a number is one seat too.
 */
function seats(partySize: number): number {
  const n = Math.round(Number(partySize));
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

/** True when the customer will be asked for a Mobile Money number. */
export function requiresOnlinePayment(config: DepositConfig, partySize: number): boolean {
  return depositChargedNow(config, partySize) > 0;
}
