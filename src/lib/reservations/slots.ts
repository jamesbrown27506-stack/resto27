import { DISPLAY_TZ } from "@/lib/format/datetime";
import type { RestaurantHours } from "@/lib/data/public";

/**
 * Bookable time slots, derived from the restaurant's own opening hours.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS.
 *
 *  The booking form offered nine hard-coded times — 12:00–13:30 and
 *  19:00–21:00 — for every restaurant, every day of the week, forever. Three
 *  separate things were wrong with that:
 *
 *    · a restaurant open 10:00–22:00 could not be booked at 10:30, at 15:00,
 *      or at any of the eleven half-hours in the middle of its own day;
 *    · a restaurant CLOSED on Sunday still showed nine Sunday slots, so the
 *      form invited a booking the kitchen would have to refuse by hand;
 *    · every slot stayed pressable on a date that had already gone, and on
 *      today's date long after the hour had passed. The server refused those
 *      afterwards ("Choisissez une date à venir"), which is the right check in
 *      the wrong place: by then the person has filled in the whole form.
 *
 *  Slots now come from `restaurant_hours` for the weekday actually selected,
 *  every 30 minutes, and a time that cannot be honoured is never offered.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Half-hourly, which is how a dining room is actually turned over. */
export const SLOT_STEP_MIN = 30;

/**
 * No booking for the next half hour. A table requested for 19:05 at 19:00 is a
 * walk-in, and nobody at the restaurant will see the request in time.
 */
export const BOOKING_LEAD_MIN = 30;

/**
 * The last seating is half an hour before the doors close — a table booked for
 * closing time is a table nobody can be served at.
 */
export const LAST_SEATING_BEFORE_CLOSE_MIN = 30;

const MINUTES_IN_DAY = 24 * 60;

/** "HH:MM" or "HH:MM:SS" to minutes past midnight. Null on anything else. */
function toMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function toClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Today's date in the display zone, as YYYY-MM-DD.
 *
 * `en-CA` because its short date format IS the ISO one — the alternative is
 * reading Date parts back out of a locale string and reassembling them, which
 * is the step that quietly produces 01/02 for 2 January.
 */
export function todayInDisplayTz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Minutes past midnight, right now, in the display zone. */
export function minutesNowInDisplayTz(now: Date = new Date()): number {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return toMinutes(clock) ?? 0;
}

/**
 * Weekday (0 = Sunday, matching `RestaurantHours.weekday` and `getDay()`) of a
 * YYYY-MM-DD string.
 *
 * Built through `Date.UTC` from the parts rather than `new Date(str)`. A bare
 * date string is parsed as UTC midnight and then read back through the local
 * clock, so anywhere west of Greenwich it reports the day BEFORE — the class of
 * bug that shows Sunday's hours on a Monday booking.
 */
export function weekdayOfDate(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [, y, m, d] = match;
  const check = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  // Rejects 2026-02-31 and friends, which Date.UTC silently rolls forward.
  if (check.getUTCMonth() !== Number(m) - 1 || check.getUTCDate() !== Number(d)) return null;
  return check.getUTCDay();
}

/** True when the string is a real YYYY-MM-DD that is today or later. */
export function isTodayOrLater(date: string, now: Date = new Date()): boolean {
  if (weekdayOfDate(date) === null) return false;
  // Both sides are zero-padded ISO dates, so a string compare IS a date
  // compare — and it never builds a Date, so it cannot drift by a zone.
  return date >= todayInDisplayTz(now);
}

export interface DaySlots {
  /** The bookable times, "HH:MM", ascending. Empty when none can be offered. */
  slots: string[];
  /** Why the list is empty — drives which sentence the form shows. */
  reason: null | "closed" | "tooLate" | "invalidDate";
  /** The restaurant's own window that day, for "Open 10:00 – 22:00". */
  opensAt: string | null;
  closesAt: string | null;
}

/**
 * Every half hour this restaurant can seat a table on this date.
 *
 * A window that closes at or before it opens is read as crossing midnight, and
 * the slots stop at the end of the calendar day: a 00:30 slot belongs to the
 * NEXT date, and offering it under today's date would book the wrong night.
 * Late seatings are the rarer case and the restaurant can take them by phone; a
 * booking silently placed twenty-four hours out is the worse failure.
 */
export function slotsForDate(
  hours: RestaurantHours[],
  date: string,
  now: Date = new Date(),
): DaySlots {
  const weekday = weekdayOfDate(date);
  if (weekday === null) return { slots: [], reason: "invalidDate", opensAt: null, closesAt: null };

  const today = hours.find((h) => h.weekday === weekday);

  const open = toMinutes(today?.opensAt);
  const close = toMinutes(today?.closesAt);

  if (open === null || close === null) {
    return { slots: [], reason: "closed", opensAt: null, closesAt: null };
  }

  const opensAt = toClock(open);
  const closesAt = toClock(close);

  // Crossing midnight — clamp to the end of this calendar day, see above.
  const effectiveClose = close <= open ? MINUTES_IN_DAY : close;
  const lastSeating = effectiveClose - LAST_SEATING_BEFORE_CLOSE_MIN;

  // The floor is "not before opening"; on today it is also "not within the
  // next half hour", so a slot that has already gone is never offered.
  let earliest = open;
  if (date === todayInDisplayTz(now)) {
    earliest = Math.max(earliest, minutesNowInDisplayTz(now) + BOOKING_LEAD_MIN);
  }

  // Round up onto the half-hour grid so the times read 12:00 / 12:30, never
  // 12:07 — whatever the opening minute or the current time happens to be.
  const first = Math.ceil(earliest / SLOT_STEP_MIN) * SLOT_STEP_MIN;

  const slots: string[] = [];
  for (let t = first; t <= lastSeating; t += SLOT_STEP_MIN) slots.push(toClock(t));

  if (slots.length === 0) {
    // Open today, but every seating is behind us — a different sentence from
    // "closed today", and a different fix (come back tomorrow vs. never).
    return { slots: [], reason: "tooLate", opensAt, closesAt };
  }

  return { slots, reason: null, opensAt, closesAt };
}
