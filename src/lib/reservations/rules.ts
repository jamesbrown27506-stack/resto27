/**
 * Booking rules that are not about tables (0068).
 *
 *   · how far ahead — an admin setting for bookings AND one for scheduled
 *     deliveries/pickups (a customer must not be able to pick any day at all);
 *   · closures — dates a restaurant is shut outside its weekly hours;
 *   · group requests — above the restaurant's maximum party the request is
 *     still sent, but the restaurant arranges the tables by hand;
 *   · lunch / dinner — the day's slots grouped the way a dining room thinks.
 *
 * Pure, so the booking form and the server read the same rules.
 */

import { todayInDisplayTz } from "./slots";

export const DEFAULT_BOOKING_MAX_DAYS = 60;
export const DEFAULT_ORDER_SCHEDULE_MAX_DAYS = 7;
export const DEFAULT_MAX_PARTY = 12;
/** A group request cannot be larger than this, whatever the restaurant. */
export const ABSOLUTE_MAX_PARTY = 200;

export const OCCASIONS = ["birthday", "anniversary", "business", "date", "family", "celebration", "other"] as const;
export type Occasion = (typeof OCCASIONS)[number];

export function isOccasion(value: unknown): value is Occasion {
  return typeof value === "string" && (OCCASIONS as readonly string[]).includes(value);
}

/** YYYY-MM-DD plus whole days, calendar-safe (no time zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return moved.toISOString().slice(0, 10);
}

/** The last date that may be chosen, in the display zone. */
export function lastBookableDate(maxDays: number, now: Date = new Date()): string {
  return addDays(todayInDisplayTz(now), Math.max(0, Math.round(maxDays)));
}

export function withinHorizon(date: string, maxDays: number, now: Date = new Date()): boolean {
  return date <= lastBookableDate(maxDays, now);
}

/** A setting value clamped to a sane range, with a fallback. */
export function horizonDays(raw: number | null | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(365, Math.round(n));
}

export interface Closure {
  startsOn: string;
  endsOn: string;
  reason: string | null;
}

/** The closure covering a date, if any. */
export function closureOn(date: string, closures: Closure[]): Closure | null {
  return closures.find((c) => c.startsOn <= date && date <= c.endsOn) ?? null;
}

/** Above the restaurant's maximum, a booking becomes a group request. */
export function isGroupRequest(partySize: number, maxParty: number | null | undefined): boolean {
  const max = Number(maxParty) > 0 ? Number(maxParty) : DEFAULT_MAX_PARTY;
  return partySize > max;
}

/** Lunch before 16:00, dinner from 16:00 — how the grid is split on screen. */
export function serviceOf(slot: string): "lunch" | "dinner" {
  return slot < "16:00" ? "lunch" : "dinner";
}

export function groupSlotsByService(slots: string[]): { lunch: string[]; dinner: string[] } {
  return {
    lunch: slots.filter((s) => serviceOf(s) === "lunch"),
    dinner: slots.filter((s) => serviceOf(s) === "dinner"),
  };
}
