/**
 * THE ONE MONEY FUNCTION (§4).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  service_charge = (subtotal − discount) × service_charge_percent
 *  total          = (subtotal − discount) + service_charge
 *                   + delivery_fee − loyalty_value
 *
 *  The service charge applies to FOOD ONLY, after the discount, and NEVER to
 *  the delivery fee — that money is the restaurant's cost, not their revenue.
 *
 *  Duplicating this arithmetic anywhere else is how totals start disagreeing
 *  between the basket, the receipt and the report. If you need a total, call
 *  this. Do not add numbers in a component.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every figure is whole XAF francs — integers in, integers out. This module
 * moves to the server in P2 with tests; the shape does not change.
 */

export interface TotalsInput {
  /** Sum of line quantities × unit prices, options included. */
  subtotal: number;
  /** Promotion discount, already validated. Always ≥ 0. */
  discount?: number;
  /** Platform service charge, e.g. 5 for 5 %. */
  serviceChargePercent?: number;
  /**
   * QUOTED BY THE RESTAURANT on confirmation (§4), not calculated here.
   * 0 until `deliveryFeeSetAt` is stamped — which is why the UI must show
   * "à confirmer" rather than "0 FCFA".
   */
  deliveryFee?: number;
  /** Value in francs of redeemed loyalty points. Always ≥ 0. */
  loyaltyValue?: number;
}

export interface Totals {
  subtotal: number;
  discount: number;
  /** subtotal − discount. The base the service charge applies to. */
  netFood: number;
  serviceChargePercent: number;
  serviceCharge: number;
  deliveryFee: number;
  loyaltyValue: number;
  total: number;
}

export function computeTotals({
  subtotal,
  discount = 0,
  serviceChargePercent = 5,
  deliveryFee = 0,
  loyaltyValue = 0,
}: TotalsInput): Totals {
  // Clamped so a discount larger than the basket cannot produce a negative
  // base that the service charge then turns into a credit.
  const netFood = Math.max(0, Math.round(subtotal) - Math.round(discount));

  const serviceCharge = Math.round((netFood * serviceChargePercent) / 100);

  const total = Math.max(
    0,
    netFood + serviceCharge + Math.round(deliveryFee) - Math.round(loyaltyValue),
  );

  return {
    subtotal: Math.round(subtotal),
    discount: Math.round(discount),
    netFood,
    serviceChargePercent,
    serviceCharge,
    deliveryFee: Math.round(deliveryFee),
    loyaltyValue: Math.round(loyaltyValue),
    total,
  };
}

/** Unit price of one line: base price plus every chosen option's delta. */
export function lineUnitPrice(basePrice: number, optionDeltas: number[]): number {
  return optionDeltas.reduce((sum, d) => sum + d, basePrice);
}

/** Discount in francs for a percentage promotion. */
export function promotionDiscount(subtotal: number, discountPercent: number): number {
  return Math.round((subtotal * discountPercent) / 100);
}
