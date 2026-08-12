/**
 * The promotion discount rule (§15).
 *
 * A PURE module on purpose. `validatePromoCode` shows the customer a figure
 * before they commit and `placeOrder` writes the figure that is charged; if
 * those two ever computed "15 % off, capped at 2 000" differently, the basket
 * and the receipt would disagree by a hundred francs and the customer would be
 * right to distrust both.
 *
 * It cannot live in the "use server" module beside them — every export of one
 * of those has to be an async function.
 */

/**
 * Why a code was refused — a CODE, not a sentence, so the basket can say it in
 * whichever language the customer is reading.
 */
export type PromoErrorReason =
  | "unknown"
  | "inactive"
  | "expired"
  | "notStarted"
  | "usedUp"
  | "minimum"
  | "failed";

export interface PromotionRule {
  /** 'percent' | 'fixed' — the values the `promotions` check constraint allows. */
  discount_type: string;
  /** Percent: 1–100. Fixed: whole XAF. */
  discount_value: number;
  /** Caps a percentage discount in francs. Null = uncapped. */
  max_discount: number | null;
}

export function discountFor(promo: PromotionRule, subtotal: number): number {
  const raw =
    promo.discount_type === "percent"
      ? Math.round((subtotal * promo.discount_value) / 100)
      : Math.round(promo.discount_value);

  const capped = promo.max_discount !== null ? Math.min(raw, promo.max_discount) : raw;

  // Never more than the basket. A fixed 5 000 off a 3 000 order is a refund,
  // and a negative net would turn the service charge into a credit.
  return Math.max(0, Math.min(capped, subtotal));
}
