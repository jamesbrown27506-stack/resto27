/**
 * Every clock a table booking runs on, in one pure module.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THESE LIVE TOGETHER, AND WHY THEY ARE PURE.
 *
 *  The same four instants are read in three places — the reservation-clock
 *  cron that enforces them, the manager board that shows them ("Répondre avant
 *  14:30", "Absent possible à 20:15"), and the Server Actions that refuse a
 *  click made too early. A countdown on screen that disagrees with the sweep
 *  behind it is how a restaurant loses a booking it believed it still had
 *  time to accept. So there is one definition of each, and no database client
 *  anywhere near it.
 *
 *    1. REQUEST DEADLINE — a pending request must be answered within the
 *       admin's limit (`reservation_response_minutes`, default 120, 0059) and
 *       never later than one hour before the slot, whichever comes first. A
 *       customer told "no" at 19:55 for 20:00 has nowhere else to go.
 *    2. PAYMENT HOLD — an accepted booking whose deposit is unpaid holds its
 *       table for at most an hour after acceptance, and never past one hour
 *       before the slot. Before 2026-09 it held until the slot itself had
 *       passed, which is the table nobody else could book all evening.
 *    3. NO-SHOW GRACE — a restaurant may call a party absent only fifteen
 *       minutes after the booked time. Marking 20:00 absent at 20:01 keeps a
 *       deposit from someone parking the car.
 *    4. FLOOR HOLD — a table assigned to a live booking reads "Réservée" from
 *       thirty minutes before the slot until the sitting ends.
 * ─────────────────────────────────────────────────────────────────────────
 */

const MIN = 60_000;

/** Latest a pending request may be answered, relative to the slot. */
export const REQUEST_CUTOFF_BEFORE_SLOT_MIN = 60;
/** How long an accepted-but-unpaid booking keeps its table. */
export const PAYMENT_HOLD_MIN = 60;
/** Latest the deposit may land, relative to the slot. */
export const PAYMENT_CUTOFF_BEFORE_SLOT_MIN = 60;
/**
 * The shortest wait any deadline may impose. A request made 40 minutes before
 * its slot would otherwise be "late" the instant it was sent; it gets this
 * long instead (still never past the slot itself).
 */
export const MIN_ANSWER_WINDOW_MIN = 15;
/** How long after the booked time a restaurant may mark a party absent. */
export const NO_SHOW_GRACE_MIN = 15;
/** How long before the slot the floor shows the table as reserved. */
export const TABLE_HOLD_BEFORE_MIN = 30;

function ms(value: string | number | Date | null | undefined): number {
  if (value === null || value === undefined) return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(value);
}

/**
 * min(start + windowMin, slot − cutoffMin), but never sooner than
 * min(start + MIN_ANSWER_WINDOW_MIN, slot). Null when an input is unreadable.
 */
function boundedDeadline(startMs: number, slotMs: number, windowMin: number, cutoffMin: number): Date | null {
  if (!Number.isFinite(startMs) || !Number.isFinite(slotMs)) return null;
  const primary = Math.min(startMs + windowMin * MIN, slotMs - cutoffMin * MIN);
  const floor = Math.min(startMs + MIN_ANSWER_WINDOW_MIN * MIN, slotMs);
  return new Date(Math.max(primary, floor));
}

/** When a pending request stops waiting for the restaurant. */
export function requestAnswerDeadline(
  booking: { createdAt: string | number | Date; reservedFor: string | number | Date },
  responseMinutes: number,
): Date | null {
  return boundedDeadline(ms(booking.createdAt), ms(booking.reservedFor), responseMinutes, REQUEST_CUTOFF_BEFORE_SLOT_MIN);
}

/**
 * When an accepted, unpaid booking releases its table. The clock starts at
 * the restaurant's decision (`decided_at`); a row without one (older data)
 * falls back to its creation time, which can only make the hold shorter.
 */
export function paymentHoldDeadline(booking: {
  decidedAt?: string | number | Date | null;
  createdAt: string | number | Date;
  reservedFor: string | number | Date;
}): Date | null {
  const decided = ms(booking.decidedAt);
  const start = Number.isFinite(decided) ? decided : ms(booking.createdAt);
  return boundedDeadline(start, ms(booking.reservedFor), PAYMENT_HOLD_MIN, PAYMENT_CUTOFF_BEFORE_SLOT_MIN);
}

/** True once `now` has reached the deadline. */
export function deadlinePassed(deadline: Date | null, now: string | number | Date = Date.now()): boolean {
  return deadline !== null && ms(now) >= deadline.getTime();
}

/**
 * True once half of the wait between `start` and `deadline` has elapsed — the
 * moment the one reminder goes out.
 */
export function halfwayReached(
  start: string | number | Date,
  deadline: Date | null,
  now: string | number | Date = Date.now(),
): boolean {
  const s = ms(start);
  if (deadline === null || !Number.isFinite(s)) return false;
  return ms(now) >= s + (deadline.getTime() - s) / 2;
}

/** The first instant a restaurant may mark this booking a no-show. */
export function noShowAllowedFrom(reservedFor: string | number | Date): Date | null {
  const slot = ms(reservedFor);
  return Number.isFinite(slot) ? new Date(slot + NO_SHOW_GRACE_MIN * MIN) : null;
}

export function canMarkNoShowYet(
  reservedFor: string | number | Date,
  now: string | number | Date = Date.now(),
): boolean {
  const from = noShowAllowedFrom(reservedFor);
  return from !== null && ms(now) >= from.getTime();
}

/** When the sitting ends: start + the booking's own duration. */
export function sittingEnd(reservedFor: string | number | Date, durationMin: number): Date | null {
  const slot = ms(reservedFor);
  const d = Number(durationMin);
  if (!Number.isFinite(slot) || !Number.isFinite(d) || d <= 0) return null;
  return new Date(slot + d * MIN);
}

/** Statuses for which an assigned table is shown as reserved on the floor. */
export const FLOOR_HOLD_STATUSES = ["awaiting_payment", "confirmed", "seated"] as const;

/**
 * Does this booking hold its assigned table right now?
 * Window: [start − TABLE_HOLD_BEFORE_MIN, start + duration).
 */
export function holdsTableNow(
  booking: { status: string; reservedFor: string | number | Date; durationMin: number },
  now: string | number | Date = Date.now(),
): boolean {
  if (!(FLOOR_HOLD_STATUSES as readonly string[]).includes(booking.status)) return false;
  const slot = ms(booking.reservedFor);
  const end = sittingEnd(booking.reservedFor, booking.durationMin);
  if (!Number.isFinite(slot) || !end) return false;
  const n = ms(now);
  return n >= slot - TABLE_HOLD_BEFORE_MIN * MIN && n < end.getTime();
}
