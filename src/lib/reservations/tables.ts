/**
 * Seating a party on the floor — one table when one fits, several when not.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS NEXT TO availability.ts (0068).
 *
 *  availability.ts answers "is there a table big enough?" by COUNTING: a
 *  party of 14 at a restaurant whose largest table seats 8 was refused even
 *  with three empty 6-tops side by side. Large groups are real bookings here
 *  (weddings, office lunches), so a booking may now hold several tables.
 *
 *  THE RULE, in the order a maître d' would apply it:
 *    1. one free table that fits, the smallest one (least waste);
 *    2. otherwise the fewest tables whose seats cover the party, least waste
 *       among those — searched exhaustively up to four tables (a floor has a
 *       few dozen tables at most, so this is cheap), then greedily beyond;
 *    3. a seating preference (zone) is tried first and dropped if it cannot
 *       seat the party — a preference, not a condition.
 *
 *  AVAILABILITY IS A SIMULATION, not a count: every booking overlapping the
 *  slot takes its assigned tables, or — when it has none yet — the tables
 *  this same rule would give it (largest parties first). The new party is
 *  then seated on whatever is left. It is the same answer the board gets when
 *  it proposes tables to the restaurant, so the form cannot promise a table
 *  the board will not find.
 *
 *  Pure: no database, no clock except what the caller passes.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { intervalsOverlap, normaliseDuration } from "./availability";

export interface PlanTable {
  id: string;
  capacity: number;
  status: string;
  zone?: string | null;
}

export interface PlanBooking {
  start: Date;
  durationMin?: number | null;
  partySize: number;
  /** Tables the restaurant already assigned (reservation_tables / table_id). */
  tableIds?: string[];
}

const EXHAUSTIVE_MAX_TABLES = 4;

function usable(tables: PlanTable[]): PlanTable[] {
  return tables.filter((t) => t.status !== "out_of_service" && Number(t.capacity) > 0);
}

function combos(tables: PlanTable[], size: number, start = 0, picked: PlanTable[] = [], out: PlanTable[][] = []): PlanTable[][] {
  if (picked.length === size) {
    out.push([...picked]);
    return out;
  }
  for (let i = start; i < tables.length; i++) {
    picked.push(tables[i]);
    combos(tables, size, i + 1, picked, out);
    picked.pop();
  }
  return out;
}

function chooseFrom(free: PlanTable[], partySize: number): PlanTable[] | null {
  if (partySize <= 0) return [];
  const sorted = [...free].sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id));

  const single = sorted.find((t) => t.capacity >= partySize);
  if (single) return [single];

  const totalSeats = sorted.reduce((sum, t) => sum + t.capacity, 0);
  if (totalSeats < partySize) return null;

  // Exhaustive for small combinations: fewest tables, then least waste.
  const limit = Math.min(EXHAUSTIVE_MAX_TABLES, sorted.length);
  // Beyond ~20 tables C(n,4) grows past a few thousand; the greedy pass below
  // handles those floors instead.
  if (sorted.length <= 20) {
    for (let size = 2; size <= limit; size++) {
      let best: PlanTable[] | null = null;
      let bestWaste = Infinity;
      for (const set of combos(sorted, size)) {
        const seats = set.reduce((sum, t) => sum + t.capacity, 0);
        if (seats < partySize) continue;
        const waste = seats - partySize;
        if (waste < bestWaste) {
          best = set;
          bestWaste = waste;
        }
      }
      if (best) return best;
    }
  }

  // Greedy: largest tables first until the party fits, then swap the last
  // pick for the smallest table that still covers the rest.
  const desc = [...sorted].reverse();
  const picked: PlanTable[] = [];
  let seats = 0;
  for (const table of desc) {
    if (seats >= partySize) break;
    picked.push(table);
    seats += table.capacity;
  }
  if (seats < partySize) return null;
  const last = picked.pop()!;
  const rest = partySize - (seats - last.capacity);
  const smaller = sorted.find((t) => t.capacity >= rest && !picked.includes(t));
  picked.push(smaller ?? last);
  return picked;
}

/**
 * The tables to give a party, or null when the free floor cannot seat it.
 * A zone preference is honoured when it can be.
 */
export function chooseTables(free: PlanTable[], partySize: number, zone?: string | null): PlanTable[] | null {
  const floor = usable(free);
  if (zone) {
    const inZone = chooseFrom(floor.filter((t) => (t.zone ?? "") === zone), partySize);
    if (inZone) return inZone;
  }
  return chooseFrom(floor, partySize);
}

/** The biggest party the whole floor could ever seat at once. */
export function floorSeats(tables: PlanTable[]): number {
  return usable(tables).reduce((sum, t) => sum + t.capacity, 0);
}

/**
 * The tables a new party would get at `at`, or null when the slot is full.
 * Bookings overlapping the sitting take their tables first.
 */
export function seatPartyAt(input: {
  tables: PlanTable[];
  bookings: PlanBooking[];
  at: Date;
  durationMin: number;
  partySize: number;
  zone?: string | null;
}): PlanTable[] | null {
  const duration = normaliseDuration(input.durationMin);
  const t = input.at.getTime();
  const overlapping = input.bookings.filter((b) =>
    intervalsOverlap(b.start.getTime(), normaliseDuration(b.durationMin, duration), t, duration),
  );

  let free = usable(input.tables);
  const taken = new Set<string>();
  for (const booking of overlapping) for (const id of booking.tableIds ?? []) taken.add(id);
  free = free.filter((table) => !taken.has(table.id));

  // Unassigned bookings, largest first — the order that wastes the fewest seats.
  const unassigned = overlapping
    .filter((b) => !b.tableIds || b.tableIds.length === 0)
    .sort((a, b) => b.partySize - a.partySize);
  for (const booking of unassigned) {
    const given = chooseFrom(free, booking.partySize);
    // Already overbooked by hand: it takes nothing we can model, move on.
    if (!given) continue;
    const ids = new Set(given.map((g) => g.id));
    free = free.filter((table) => !ids.has(table.id));
  }

  return chooseTables(free, input.partySize, input.zone);
}

/** How many bookings START in the same half-hour slot (arrivals cap). */
export function arrivalsAt(at: Date, bookings: { start: Date }[]): number {
  const t = at.getTime();
  return bookings.filter((b) => b.start.getTime() === t).length;
}

/**
 * The whole answer for one slot: full because of tables, because of the
 * arrivals cap, or bookable. An unmanaged floor (no tables configured) is
 * never full on tables — the restaurant handles capacity by hand.
 */
export function slotVerdict(input: {
  tables: PlanTable[];
  bookings: PlanBooking[];
  at: Date;
  durationMin: number;
  partySize: number;
  maxArrivals?: number | null;
}): "ok" | "full" | "arrivals" {
  if (input.maxArrivals && input.maxArrivals > 0 && arrivalsAt(input.at, input.bookings) >= input.maxArrivals) {
    return "arrivals";
  }
  if (input.tables.length === 0) return "ok";
  return seatPartyAt(input) ? "ok" : "full";
}
