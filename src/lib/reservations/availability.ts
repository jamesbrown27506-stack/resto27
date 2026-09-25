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
 * ─────────────────────────────────────────────────────────────────────────
 *  A BOOKING IS AN INTERVAL, NOT A POINT (2026-09).
 *
 *  The old rule counted bookings STARTING in [T − 30 min, T + 90 min] — a
 *  lopsided window that ignored how long each sitting actually lasts. A
 *  two-top booked 17:15 for a long lunch-into-dinner was invisible to a 19:00
 *  request, and a 20:45 booking blocked 19:00 although the first party would
 *  be long gone. Both directions of wrong: double bookings on one side, lost
 *  bookings on the other.
 *
 *  Now each booking holds its table for [start, start + its own duration),
 *  and two bookings collide exactly when those intervals overlap:
 *
 *        s < t + d_t   &&   t < s + d_s
 *
 *  The duration is the restaurant's sitting length (`reservation_duration_min`,
 *  default one hour, 0060), snapshotted onto each booking's `duration_min` when
 *  it is made — so a restaurant shortening its sittings tonight does not
 *  retroactively shrink the bookings it already accepted.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const DEFAULT_RESERVATION_DURATION_MIN = 60;
export const MIN_RESERVATION_DURATION_MIN = 15;
/**
 * The longest sitting a restaurant may configure. Also the look-back of every
 * "which bookings could overlap this one" query: nothing that started more
 * than this long ago can still be at the table.
 */
export const MAX_RESERVATION_DURATION_MIN = 480;

/** A stored or submitted duration, clamped to the allowed range. */
export function normaliseDuration(
  value: unknown,
  fallback: number = DEFAULT_RESERVATION_DURATION_MIN,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_RESERVATION_DURATION_MIN, Math.max(MIN_RESERVATION_DURATION_MIN, Math.round(n)));
}

/**
 * Statuses that occupy a table.
 *
 * `awaiting_payment` counts: the restaurant has committed the seat and is
 * waiting to be paid for it, so it must not be sold twice meanwhile.
 * `pending` counts too — a request the restaurant may still accept must not
 * be accepted on top of another one it accepted a minute earlier; the request
 * deadline (timing.ts) stops it from blocking the slot for ever.
 * `completed`, `cancelled` and `no_show` release it.
 */
export const HOLDING_STATUSES = ["pending", "awaiting_payment", "confirmed", "seated"] as const;

export interface FloorTable {
  capacity: number;
  status: string;
}

/** One booking already holding a table: when it starts and for how long. */
export interface HoldingBooking {
  start: Date;
  /** The booking's own `duration_min`. Missing/invalid → the restaurant's. */
  durationMin?: number | null;
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

/** Half-open interval overlap: [aStart, aStart+aMin) ∩ [bStart, bStart+bMin) ≠ ∅. */
export function intervalsOverlap(aStart: number, aMin: number, bStart: number, bMin: number): boolean {
  return aStart < bStart + bMin * 60_000 && bStart < aStart + aMin * 60_000;
}

/**
 * The `reserved_for` range a query must read to see every booking that could
 * overlap [from, to + durationMin). Anything starting before `from − MAX` has
 * left the table; anything starting at or after the new sitting's end cannot
 * touch it. Read with `gt(start)` / `lt(end)`.
 */
export function overlapQueryRange(from: Date, to: Date, durationMin: number): { start: string; end: string } {
  return {
    start: new Date(from.getTime() - MAX_RESERVATION_DURATION_MIN * 60_000).toISOString(),
    end: new Date(to.getTime() + normaliseDuration(durationMin) * 60_000).toISOString(),
  };
}

/** How many holding bookings overlap a sitting of `durationMin` starting at `at`. */
export function overlappingCount(
  at: Date,
  durationMin: number,
  holding: HoldingBooking[],
  fallbackDurationMin: number = durationMin,
): number {
  const t = at.getTime();
  const d = normaliseDuration(durationMin);
  return holding.filter((h) =>
    intervalsOverlap(h.start.getTime(), normaliseDuration(h.durationMin, fallbackDurationMin), t, d),
  ).length;
}

/**
 * Is a sitting of `durationMin` starting at `at` already sold out for a party
 * of this size?
 *
 * `holding` is every holding booking that could overlap — the caller reads the
 * day once and asks this question per slot, rather than making one query per
 * half-hour.
 */
export function slotIsFull(
  at: Date,
  durationMin: number,
  holding: HoldingBooking[],
  tables: FloorTable[],
  partySize: number,
): boolean {
  if (floorIsUnmanaged(tables)) return false;

  const capacity = seatableTables(tables, partySize);
  if (capacity === 0) return true;

  return overlappingCount(at, durationMin, holding) >= capacity;
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
  durationMin: number,
  holding: HoldingBooking[],
  tables: FloorTable[],
  partySize: number,
): string[] {
  if (floorIsUnmanaged(tables)) return [];
  return slots.filter((slot) => slotIsFull(toInstant(slot), durationMin, holding, tables, partySize));
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  THE CHECK-THEN-INSERT RACE, SETTLED WITHOUT A LOCK.
 *
 *  Two customers pressing "Réserver" for the last table at the same instant
 *  both read "one table left", both insert, and the dining room is sold
 *  twice. A table lock would fix it at the price of every booking queueing on
 *  it; instead the server re-reads the overlapping bookings AFTER its insert
 *  and asks this question. Only the bookings that got in first (by
 *  `created_at`, then id as the tie-break) count against ours — so of two
 *  racing requests exactly the later one withdraws, and neither refuses when
 *  there really was room for both.
 * ─────────────────────────────────────────────────────────────────────────
 */
export interface InsertedBooking {
  id: string;
  createdAt: string;
}

export function lostInsertRace(
  mine: InsertedBooking & { start: Date; durationMin: number },
  others: (InsertedBooking & HoldingBooking)[],
  tables: FloorTable[],
  partySize: number,
): boolean {
  if (floorIsUnmanaged(tables)) return false;
  const capacity = seatableTables(tables, partySize);
  if (capacity === 0) return true;

  const mineAt = Date.parse(mine.createdAt);
  const earlier = others.filter((o) => {
    if (o.id === mine.id) return false;
    const at = Date.parse(o.createdAt);
    return at < mineAt || (at === mineAt && o.id < mine.id);
  });
  return overlappingCount(mine.start, mine.durationMin, earlier, mine.durationMin) >= capacity;
}
