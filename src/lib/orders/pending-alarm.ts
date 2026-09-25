import { orderDeadline } from "./deadline";

/**
 * The rules behind the back office's "ring until accepted" alarm — pure, so
 * the alarm component and its test agree on exactly when the phone rings.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  AN ORDER RINGS WHILE ITS ACCEPT CLOCK IS RUNNING. NOT BEFORE, NOT AFTER.
 *
 *  · Before: a pre-order for tomorrow lunch is `pending` tonight, but its
 *    clock only starts SCHEDULED_LEAD_MINUTES before the slot (deadline.ts).
 *    Ringing all night for it would teach a restaurant to mute the tablet —
 *    and then the next real order is missed. It rings when its window opens.
 *  · After: past the deadline the order-nag sweep cancels it and tells the
 *    customer. Ringing on for an order the server is about to cancel would
 *    ask the restaurant to accept something it no longer can.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface AlarmOrder {
  id: string;
  createdAt: string;
  scheduledFor: string | null;
}

interface Window {
  start: number;
  deadline: number;
}

function windowOf(order: AlarmOrder, minutes: number): Window | null {
  const deadline = orderDeadline(
    { status: "pending", createdAt: order.createdAt, scheduledFor: order.scheduledFor },
    minutes,
  );
  if (!deadline) return null;
  const end = deadline.getTime();
  return { start: end - minutes * 60_000, deadline: end };
}

/** The pending orders that should be ringing right now, most urgent first. */
export function ringingOrders<T extends AlarmOrder>(orders: T[], minutes: number, now: number): T[] {
  return orders
    .map((order) => ({ order, window: windowOf(order, minutes) }))
    .filter(({ window }) => window !== null && window.start <= now && now < window.deadline)
    .sort((a, b) => a.window!.deadline - b.window!.deadline)
    .map(({ order }) => order);
}

/**
 * When the next not-yet-ringing order starts ringing, or null. Lets the alarm
 * wake itself with one timer instead of polling the server for a pre-order.
 */
export function nextRingStart(orders: AlarmOrder[], minutes: number, now: number): number | null {
  let next: number | null = null;
  for (const order of orders) {
    const window = windowOf(order, minutes);
    if (!window || window.start <= now) continue;
    if (next === null || window.start < next) next = window.start;
  }
  return next;
}

/** The earliest auto-cancel among the ringing orders, or null. */
export function soonestDeadline(orders: AlarmOrder[], minutes: number, now: number): Date | null {
  let soonest: number | null = null;
  for (const order of orders) {
    const window = windowOf(order, minutes);
    if (!window || window.start > now || window.deadline <= now) continue;
    if (soonest === null || window.deadline < soonest) soonest = window.deadline;
  }
  return soonest === null ? null : new Date(soonest);
}

/**
 * Fired in THIS tab after staff accept or cancel an order, so the alarm
 * re-checks at once instead of ringing on for up to 30 s after the tap that
 * answered it.
 */
export const ORDERS_CHANGED_EVENT = "resto237:orders-changed";

export function announceOrdersChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ORDERS_CHANGED_EVENT));
}

/**
 * Does this notification link point at a restaurant order? `new_order` links
 * to `/m/orders/<id>` (and the table-order variant to the same place), which
 * is the only signal the realtime row and the push payload share.
 */
export function isManagerOrderHref(href: string | null | undefined): boolean {
  if (!href) return false;
  return /^\/m\/orders(?:[/?#]|$)/.test(href);
}
