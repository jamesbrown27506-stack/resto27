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

/* ── Ring rhythm and "seen" pause (owner's rules, Sep 2026) ───────────── */

/** A seen order stays quiet this long, then rings again at its real age. */
export const SEEN_PAUSE_MS = 3 * 60_000;

/**
 * THE RING ESCALATES WITH THE WAIT — a steady drone from the first second
 * was too much for a dining room; silence was too little.
 *
 *    0–3 min waiting     every 10 s
 *    3–10 min            every 5 s
 *    10 min → answered   every 3 s   (the time limit cancels at 15 min)
 */
export function ringIntervalMs(waitedMs: number): number {
  if (waitedMs < 3 * 60_000) return 10_000;
  if (waitedMs < 10 * 60_000) return 5_000;
  return 3_000;
}

/** How long this order has been waiting on the restaurant (from its window start). */
export function waitedMs(order: AlarmOrder, minutes: number, now: number): number {
  const window = windowOf(order, minutes);
  return window ? Math.max(0, now - window.start) : 0;
}

/**
 * Orders that should actually make noise: ringing, and not paused because
 * someone opened the orders screen within the last SEEN_PAUSE_MS. A new order
 * is never in `seenAt`, so it always rings at once.
 */
export function audibleOrders<T extends AlarmOrder>(
  ringing: T[],
  seenAt: ReadonlyMap<string, number>,
  now: number,
): T[] {
  return ringing.filter((order) => {
    const seen = seenAt.get(order.id);
    return seen === undefined || now - seen >= SEEN_PAUSE_MS;
  });
}

/** The interval for the most urgent audible order (the one waiting longest). */
export function nextRingInterval(audible: AlarmOrder[], minutes: number, now: number): number | null {
  if (audible.length === 0) return null;
  const longest = Math.max(...audible.map((o) => waitedMs(o, minutes, now)));
  return ringIntervalMs(longest);
}
