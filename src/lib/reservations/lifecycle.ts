import type { CustomerReservationStatus } from "@/lib/format/reservation-status";

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

export function canManagerCollectReservationDeposit(input: {
  status: CustomerReservationStatus;
  depositPercent: number;
  depositPaid: boolean;
}): boolean {
  if (input.depositPaid) return false;
  // Fixed/per-seat deposits belong to the customer online flow. Cash remains
  // an explicit fallback only after the restaurant has accepted the request.
  if (input.depositPercent <= 0) return input.status === "awaiting_payment";
  // A percentage of the bill only exists once the party is dining.
  return input.status === "seated" || input.status === "completed";
}
