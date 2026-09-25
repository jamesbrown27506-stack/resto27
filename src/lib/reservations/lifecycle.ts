import type { CustomerReservationStatus } from "@/lib/format/reservation-status";
import { canMarkNoShowYet } from "./timing";

/** States that still represent a live table booking. */
export const ACTIVE_RESERVATION_STATUSES: readonly CustomerReservationStatus[] = [
  "pending",
  "awaiting_payment",
  "confirmed",
  "seated",
];

export const TERMINAL_RESERVATION_STATUSES: readonly CustomerReservationStatus[] = [
  "completed",
  "cancelled",
  "no_show",
];

export interface ReservationLifecycleRow {
  status: CustomerReservationStatus;
  reservedFor: string;
  durationMin: number;
}

/**
 * A customer booking stays in Upcoming for its whole service window. A seated
 * party remains active until staff completes it, even if the planned duration
 * has elapsed. Terminal rows and stale, unfinished rows belong in History.
 */
export function isUpcomingReservation(
  reservation: ReservationLifecycleRow,
  now: Date | number = Date.now(),
): boolean {
  if (!ACTIVE_RESERVATION_STATUSES.includes(reservation.status)) return false;
  if (reservation.status === "seated") return true;

  const start = Date.parse(reservation.reservedFor);
  if (!Number.isFinite(start)) return false;
  const duration = Math.max(1, Number(reservation.durationMin) || 0);
  const nowMs = now instanceof Date ? now.getTime() : now;
  return start + duration * 60_000 > nowMs;
}

/** Upcoming is soonest first; history is newest first. */
export function partitionCustomerReservations<T extends ReservationLifecycleRow>(
  reservations: readonly T[],
  now: Date | number = Date.now(),
): { upcoming: T[]; history: T[] } {
  const upcoming: T[] = [];
  const history: T[] = [];

  for (const reservation of reservations) {
    (isUpcomingReservation(reservation, now) ? upcoming : history).push(reservation);
  }

  upcoming.sort((a, b) => Date.parse(a.reservedFor) - Date.parse(b.reservedFor));
  history.sort((a, b) => Date.parse(b.reservedFor) - Date.parse(a.reservedFor));
  return { upcoming, history };
}

export function canCustomerPayReservation(input: {
  status: CustomerReservationStatus;
  depositPaid: boolean;
  depositAmount: number;
}): boolean {
  return input.status === "awaiting_payment" && !input.depositPaid && input.depositAmount > 0;
}

export function canCustomerCancelReservation(status: CustomerReservationStatus): boolean {
  return status === "pending" || status === "awaiting_payment" || status === "confirmed";
}

/** Restaurant decisions are deliberately narrow; later operational steps use their own action. */
export function canDecideReservation(
  current: CustomerReservationStatus,
  decision: "confirmed" | "cancelled",
): boolean {
  return decision === "confirmed"
    ? current === "pending"
    : current === "pending" || current === "awaiting_payment";
}

/** The only valid restaurant-operated service transitions. */
export function canSetReservationStatus(
  current: CustomerReservationStatus,
  next: "seated" | "completed" | "no_show",
): boolean {
  if (next === "seated" || next === "no_show") return current === "confirmed";
  return current === "seated";
}

/**
 * A no-show is a verdict with money attached (the deposit stays with the
 * restaurant), so it needs both the right state AND the grace period: a
 * party booked for 20:00 is not absent at 20:01. See timing.ts.
 */
export function canMarkReservationNoShow(
  booking: { status: CustomerReservationStatus; reservedFor: string | number | Date },
  now: string | number | Date = Date.now(),
): boolean {
  return canSetReservationStatus(booking.status, "no_show") && canMarkNoShowYet(booking.reservedFor, now);
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  THE RESTAURANT CAN WITHDRAW A CONFIRMED BOOKING — AND PAYS FOR IT.
 *
 *  `canDecideReservation` stops at `awaiting_payment` on purpose: once a
 *  deposit has landed, "cancel" is no longer a decision, it is a refund. That
 *  left a restaurant with a flooded kitchen or a private event no way out of
 *  a paid booking except asking the guest to cancel (and eat the late fee).
 *  Now it can, from `confirmed` only — a seated party is being served, not
 *  cancelled — and restaurant_cancel_reservation (0060) returns the WHOLE
 *  deposit to the customer, debited from the restaurant, in one transaction.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function canRestaurantCancelReservation(current: CustomerReservationStatus): boolean {
  return current === "confirmed";
}

export function canManagerCollectReservationDeposit(input: {
  status: CustomerReservationStatus;
  depositPercent: number;
  depositPaid: boolean;
}): boolean {
  if (input.depositPaid) return false;
  // Fixed/per-seat deposits are paid ONLINE, by the customer, from their own
  // phone — never recorded as cash by the restaurant (payment first, 2026-09).
  if (input.depositPercent <= 0) return false;
  // A percentage of the bill only exists once the party is dining.
  return input.status === "seated" || input.status === "completed";
}
