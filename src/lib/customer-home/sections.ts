import { orderDeadline, minutesLeft } from "@/lib/orders/deadline";
import { placementDay } from "@/lib/discovery/placement";
import type { OrderStatus } from "@/lib/format/order-status";
import type { CustomerReservationStatus } from "@/lib/format/reservation-status";

/**
 * What the signed-in home puts on top: whatever the customer is part of
 * right now, most urgent first. Pure, so it is tested without a database;
 * lib/data/customer-home feeds it.
 *
 *   to pay       accepted by the restaurant, waiting on the customer's money
 *                — the one state where doing nothing cancels the order
 *   waiting      placed, the restaurant has not answered yet
 *   in progress  paid and cooking / on its way
 *   bookings     a deposit to pay, or a table coming up soon
 *   reorder      past delivered orders, one per restaurant, newest first
 */

interface HomeOrderInput {
  id: string;
  status: OrderStatus;
  isPaid: boolean;
  createdAt: string;
  scheduledFor: string | null;
  restaurantId: string;
  history: { status: string; at: string }[];
  items: { menuItemId: string | null }[];
}

export interface TimedOrder<T> {
  order: T;
  /** ISO — when this wait runs out (0059), null when it has none. */
  deadline: string | null;
  /** Whole minutes left at load time; the countdown takes over in the browser. */
  minutesLeft: number | null;
}

export interface HomeOrders<T> {
  toPay: TimedOrder<T>[];
  waiting: TimedOrder<T>[];
  inProgress: T[];
  reorder: T[];
}

const IN_PROGRESS: OrderStatus[] = ["confirmed", "preparing", "shipped"];

export function splitHomeOrders<T extends HomeOrderInput>(
  orders: T[],
  orderMinutes: number,
  now: number,
  reorderLimit = 4,
): HomeOrders<T> {
  const timed = (order: T): TimedOrder<T> => {
    const acceptedAt =
      order.history
        .filter((h) => h.status === "awaiting_customer")
        .map((h) => h.at)
        .sort()[0] ?? null;
    const deadline = orderDeadline(
      { status: order.status, createdAt: order.createdAt, scheduledFor: order.scheduledFor, acceptedAt },
      orderMinutes,
    );
    return { order, deadline: deadline ? deadline.toISOString() : null, minutesLeft: minutesLeft(deadline, now) };
  };

  const toPay = orders.filter((o) => o.status === "awaiting_customer" && !o.isPaid).map(timed);
  const waiting = orders.filter((o) => o.status === "pending").map(timed);
  // A paid order still marked awaiting_customer is between two writes: it is
  // under way, not owed.
  const inProgress = orders.filter(
    (o) => IN_PROGRESS.includes(o.status) || (o.status === "awaiting_customer" && o.isPaid),
  );

  const seen = new Set<string>();
  const reorder: T[] = [];
  for (const order of orders) {
    if (reorder.length >= reorderLimit) break;
    if (order.status !== "delivered" || seen.has(order.restaurantId)) continue;
    if (!order.items.some((item) => item.menuItemId)) continue;
    seen.add(order.restaurantId);
    reorder.push(order);
  }

  return { toPay, waiting, inProgress, reorder };
}

interface HomeBookingInput {
  status: CustomerReservationStatus;
  reservedFor: string;
  depositPaid: boolean;
  depositAmount: number;
}

export type BookingDay = "today" | "tomorrow" | "later";

/** Bookings worth the top of the home: a deposit owed, or a table within the next day and a half. */
export function homeBookings<T extends HomeBookingInput>(upcoming: T[], now: number, limit = 2): T[] {
  const soon = now + 36 * 60 * 60 * 1000;
  const owed = (b: T) => b.status === "awaiting_payment" && !b.depositPaid && b.depositAmount > 0;
  return upcoming
    .filter((b) => owed(b) || ((b.status === "confirmed" || b.status === "pending") && Date.parse(b.reservedFor) <= soon))
    .sort((a, b) => Number(owed(b)) - Number(owed(a)) || Date.parse(a.reservedFor) - Date.parse(b.reservedFor))
    .slice(0, limit);
}

/** Today / tomorrow / later, on Douala's calendar. */
export function bookingDay(reservedFor: string, now: number): BookingDay {
  const day = placementDay(new Date(reservedFor));
  const today = placementDay(new Date(now));
  if (day === today) return "today";
  if (day === placementDay(new Date(now + 24 * 60 * 60 * 1000))) return "tomorrow";
  return "later";
}
