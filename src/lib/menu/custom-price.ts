/**
 * Customizable dishes — "prix confirmé par le restaurant" (0069).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A dish put together to order (BHB, eru with fufu or garri, an extra
 *  piece of meat) has no single price, and a price per option is too much
 *  setup for twenty such dishes. So the dish carries a RANGE: `price` is the
 *  minimum, `priceMax` the ceiling, and the customer describes what they
 *  want in the line's note. The restaurant confirms the real price when it
 *  accepts the order — before anyone pays — and never outside the range,
 *  exactly like the delivery fee ceiling.
 *
 *  Options still add their deltas to both ends of the range.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface PricedDish {
  price: number;
  priceToConfirm?: boolean;
  priceMax?: number | null;
}

/** The range a customer is shown, options included; null for a fixed price. */
export function dishPriceRange(dish: PricedDish, optionsDelta = 0): { min: number; max: number } | null {
  if (!dish.priceToConfirm) return null;
  const min = Math.max(0, Math.round(dish.price + optionsDelta));
  const max = Math.max(min, Math.round((dish.priceMax ?? dish.price) + optionsDelta));
  return { min, max };
}

/** Whether a confirmed unit price is acceptable for a line sold at [min, max]. */
export function isPriceInRange(price: number, min: number, max: number | null | undefined): boolean {
  return Number.isInteger(price) && price >= min && price <= Math.max(min, max ?? min);
}

/** A manager's input for the ceiling: blank or not above the minimum = no range. */
export function normalisePriceMax(price: number, raw: number | null | undefined): number | null {
  const max = Number(raw);
  if (!Number.isFinite(max) || max <= 0) return null;
  return Math.max(Math.round(price), Math.round(max));
}

/**
 * The lines awaiting a price, in the shape the acceptance dialog needs.
 * An order with none can be accepted exactly as before.
 */
export function linesToPrice<T extends { priceToConfirm?: boolean; priceConfirmedAt?: string | null }>(items: T[]): T[] {
  return items.filter((item) => item.priceToConfirm && !item.priceConfirmedAt);
}

/**
 * "500 – 1 000 FCFA" for a dish to confirm, the plain price otherwise. Takes
 * the formatter so this module stays free of locale code.
 */
export function dishPriceLabel(dish: PricedDish, format: (amount: number) => string, optionsDelta = 0): string {
  const range = dishPriceRange(dish, optionsDelta);
  if (!range) return format(Math.round(dish.price + optionsDelta));
  return range.max > range.min ? `${format(range.min)} – ${format(range.max)}` : `${format(range.min)}`;
}
