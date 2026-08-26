/**
 * Which half-hours a restaurant can actually seat a party of this size.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE FORM USED TO SHOW OPENING HOURS AND CALL THEM AVAILABILITY.
 *
 *  `slotsForDate` reads `restaurant_hours` and nothing else — it is arithmetic
 *  over an opening time and a closing time. The REAL capacity test lived only
 *  inside `createOwnReservation`, and ran only when the customer pressed the
 *  button. So on a full Saturday someone chose 20:00, entered their party
 *  size, typed a note about a birthday, submitted, and got "Plus de table
 *  disponible sur ce créneau." — a dead end at the last step that named no
 *  alternative.
 *
 *  Every serious booking platform inverts that: you see the times that are
 *  genuinely free before you are asked for anything about yourself, and a slot
 *  that is full is greyed rather than removed, because a slot that disappears
 *  reads as a bug while a greyed one reads as an answer.
 *
 *  THIS MODULE IS THE RULE, AND THE SERVER USES THE SAME COPY. A form that
 *  shows a more generous rule than the server enforces is the original bug
 *  wearing a different hat; one that shows a stricter rule silently loses
 *  bookings the restaurant could have taken. So `createOwnReservation` calls
 *  these functions too — there is exactly one definition of "full".
 *
 *  Deliberately free of any database client, so it can be unit-tested and so
 *  the client bundle can import the constants without dragging the admin
 *  Supabase client along with them.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * A booking holds its table from half an hour before the slot to an hour and
 * a half after — roughly a sitting, plus the turnaround either side.
 */
export const SLOT_WINDOW_BEFORE_MIN = 30;
export const SLOT_WINDOW_AFTER_MIN = 90;

/**
 * Statuses that occupy a table.
 *
 * `awaiting_payment` counts: the restaurant has committed the seat and is
 * waiting to be paid for it, so it must not be sold twice meanwhile.
 * `completed`, `cancelled` and `no_show` release it.
 */
export const HOLDING_STATUSES = ["pending", "awaiting_payment", "confirmed", "seated"] as const;

export interface FloorTable {
  capacity: number;
  status: string;
}

/**
 * How many tables could seat this party at all.
 *
 * An out-of-service table is not capacity, and neither is a two-top for a
 * party of six. Returns 0 when the restaurant has configured a floor and none
 * of it fits — which is a different refusal from "that hour is taken", and
 * the caller says so differently.
 */
export function seatableTables(tables: FloorTable[], partySize: number): number {
  return tables.filter(
    (table) => table.status !== "out_of_service" && Number(table.capacity) >= partySize,
  ).length;
}

/**
 * True when the restaurant manages capacity by hand rather than by floor plan.
 *
 * No configured tables means no ceiling to enforce — a walk-in place should
 * not have its bookings refused by a floor plan nobody filled in.
 */
export function floorIsUnmanaged(tables: FloorTable[]): boolean {
  return tables.length === 0;
}

/** The window a booking at this instant occupies, as ISO strings. */
export function slotWindow(at: Date): { start: string; end: string } {
  return {
    start: new Date(at.getTime() - SLOT_WINDOW_BEFORE_MIN * 60_000).toISOString(),
    end: new Date(at.getTime() + SLOT_WINDOW_AFTER_MIN * 60_000).toISOString(),
  };
}

/**
 * Is this instant already sold out for a party of this size?
 *
 * `holdingAt` is every holding booking's `reserved_for`, for the whole day —
 * the caller reads the day once and asks this question per slot, rather than
 * making one query per half-hour.
 */
export function slotIsFull(
  at: Date,
  holdingAt: Date[],
  tables: FloorTable[],
  partySize: number,
): boolean {
  if (floorIsUnmanaged(tables)) return false;

  const capacity = seatableTables(tables, partySize);
  if (capacity === 0) return true;

  const from = at.getTime() - SLOT_WINDOW_BEFORE_MIN * 60_000;
  const to = at.getTime() + SLOT_WINDOW_AFTER_MIN * 60_000;
  const overlapping = holdingAt.filter((h) => {
    const t = h.getTime();
    return t >= from && t <= to;
  }).length;

  return overlapping >= capacity;
}

/**
 * Every slot of the day that cannot take this party, as "HH:MM".
 *
 * `slots` are local wall-clock times and `toInstant` turns one into the
 * absolute instant it means — the caller owns that conversion because it is
 * the one piece that needs the display time zone.
 */
export function fullSlots(
  slots: string[],
  toInstant: (slot: string) => Date,
  holdingAt: Date[],
  tables: FloorTable[],
  partySize: number,
): string[] {
  if (floorIsUnmanaged(tables)) return [];
  return slots.filter((slot) => slotIsFull(toInstant(slot), holdingAt, tables, partySize));
}
