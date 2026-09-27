/**
 * The table bill, as the guest's phone previews it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE DATABASE DECIDES, THIS ONLY PREVIEWS.
 *
 *  start_dining_payment (0068) recomputes the share, the tip and the fee
 *  under a row lock and is the only figure ever charged. This module mirrors
 *  its arithmetic so the screen can show "you will pay X" before the guest
 *  presses the button — the two must agree, which is what the tests pin.
 *
 *    due        = food accepted on the bill − booking deposit (never < 0)
 *    remaining  = due − paid − payments still in flight
 *    share      = all: remaining
 *                 mine: my accepted dishes − what I already paid for them
 *                 equal: ceil(due / parts), capped at remaining
 *                 amount: what the guest typed (100 … remaining)
 *    fee        = round((share + tip) × fee% / 100)   — the gateway's cut,
 *                 on every Mobile Money payment (admin setting)
 *    total      = share + tip + fee
 *
 *  Cash is settled by the waiter for the whole remaining amount; the split
 *  options exist only for paying online (product decision, Sep 2026).
 * ─────────────────────────────────────────────────────────────────────────
 */

export type SplitMode = "all" | "mine" | "equal" | "amount";

/** The smallest part of a bill that can be paid on its own, in FCFA. */
export const MIN_PART_PAYMENT = 100;
export const MAX_SPLIT_PARTS = 50;
/** One-tap tip choices, in percent of the share. */
export const TIP_PERCENTS = [5, 10] as const;

export function billDue(subtotal: number, depositCredit: number): number {
  return Math.max(0, Math.round(subtotal) - Math.max(0, Math.round(depositCredit)));
}

export function billRemaining(input: { due: number; paid: number; inFlight?: number }): number {
  return input.due - input.paid - (input.inFlight ?? 0);
}

export function paymentFee(amount: number, feePercent: number): number {
  if (!(feePercent > 0) || !(amount > 0)) return 0;
  return Math.round((amount * feePercent) / 100);
}

/** A tip from a one-tap percentage, whole francs. */
export function tipFromPercent(share: number, percent: number): number {
  if (!(share > 0) || !(percent > 0)) return 0;
  return Math.round((share * percent) / 100);
}

export type ShareResult =
  | { ok: true; share: number }
  | { ok: false; reason: "nothingToPay" | "nothingMine" | "invalidParts" | "invalidAmount" };

export function shareFor(input: {
  mode: SplitMode;
  due: number;
  remaining: number;
  /** My accepted dishes minus what I already paid for them ("mine" only). */
  mine?: number;
  parts?: number;
  amount?: number;
}): ShareResult {
  const remaining = Math.max(0, input.remaining);
  if (remaining <= 0) return { ok: false, reason: "nothingToPay" };
  switch (input.mode) {
    case "all":
      return { ok: true, share: remaining };
    case "mine": {
      const mine = Math.min(Math.max(0, Math.round(input.mine ?? 0)), remaining);
      return mine > 0 ? { ok: true, share: mine } : { ok: false, reason: "nothingMine" };
    }
    case "equal": {
      const parts = Math.round(input.parts ?? 0);
      if (!Number.isFinite(parts) || parts < 2 || parts > MAX_SPLIT_PARTS) return { ok: false, reason: "invalidParts" };
      return { ok: true, share: Math.min(Math.ceil(input.due / parts), remaining) };
    }
    case "amount": {
      const amount = Math.round(input.amount ?? 0);
      if (!Number.isFinite(amount) || amount < MIN_PART_PAYMENT || amount > remaining) {
        return { ok: false, reason: "invalidAmount" };
      }
      return { ok: true, share: amount };
    }
  }
}

export interface PaymentQuote {
  share: number;
  tip: number;
  fee: number;
  total: number;
}

/** What the guest will be asked for on their phone. */
export function quotePayment(share: number, tip: number, feePercent: number): PaymentQuote {
  const safeTip = Math.max(0, Math.min(Math.round(tip), share));
  const fee = paymentFee(share + safeTip, feePercent);
  return { share, tip: safeTip, fee, total: share + safeTip + fee };
}

/** Who ordered what, for the shared bill. */
export function sumByGuest<T extends { guestId: string | null; amount: number }>(lines: T[]): Map<string | null, number> {
  const totals = new Map<string | null, number>();
  for (const line of lines) totals.set(line.guestId, (totals.get(line.guestId) ?? 0) + line.amount);
  return totals;
}

/** "4K7Q" — what a join code looks like; lets the form reject typos early. */
export function isJoinCode(value: string): boolean {
  return /^[ACDEFGHJKLMNPQRTUVWXY34679]{4}$/.test(value.trim().toUpperCase());
}
