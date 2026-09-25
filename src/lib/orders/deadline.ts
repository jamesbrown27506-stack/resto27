/**
 * THE ORDER TIME LIMIT (0059) — when a waiting order stops waiting.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  One number, set by the admin (`order_response_minutes`, default 15),
 *  bounds both waits in the payment-first flow:
 *
 *    pending            the RESTAURANT must accept (confirm the dishes are
 *                       available, quote the delivery fee) — clock starts when
 *                       the order was placed, or for a scheduled order when
 *                       its prep lead opens (SCHEDULED_LEAD_MINUTES before the
 *                       slot), so a pre-order for tomorrow is not cancelled
 *                       tonight.
 *    awaiting_customer  the CUSTOMER must pay the accepted order — clock
 *                       starts at acceptance.
 *
 *  Past the deadline the order-nag sweep cancels the order and tells both
 *  sides. Every other status has no deadline here.
 *
 *  Pure: the sweep, the customer page and the manager queue all call this, so
 *  the countdown a person sees is the rule the server applies.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const DEFAULT_ORDER_RESPONSE_MINUTES = 15;
export const DEFAULT_RESERVATION_RESPONSE_MINUTES = 120;
export const SCHEDULED_LEAD_MINUTES = 60;

/** A setting value as minutes: whole, 1 minute to 24 hours, else the default. */
export function minutesSetting(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 1440) return fallback;
  return n;
}

export interface DeadlineInput {
  status: string;
  createdAt: string;
  scheduledFor?: string | null;
  /** When the restaurant accepted (moved it to awaiting_customer). */
  acceptedAt?: string | null;
}

/** The moment this order's current wait runs out, or null if it has none. */
export function orderDeadline(order: DeadlineInput, minutes: number): Date | null {
  const created = Date.parse(order.createdAt);
  if (!Number.isFinite(created)) return null;

  if (order.status === "pending") {
    let start = created;
    if (order.scheduledFor) {
      const slot = Date.parse(order.scheduledFor);
      if (Number.isFinite(slot)) start = Math.max(created, slot - SCHEDULED_LEAD_MINUTES * 60_000);
    }
    return new Date(start + minutes * 60_000);
  }

  if (order.status === "awaiting_customer") {
    const accepted = order.acceptedAt ? Date.parse(order.acceptedAt) : NaN;
    const start = Number.isFinite(accepted) ? accepted : created;
    return new Date(start + minutes * 60_000);
  }

  return null;
}

/** Whole minutes left before `deadline`, never negative. */
export function minutesLeft(deadline: Date | null, now = Date.now()): number | null {
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline.getTime() - now) / 60_000));
}
