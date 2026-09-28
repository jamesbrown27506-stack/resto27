/**
 * How many calendar days of grace are left (Africa/Douala), for the billing
 * card and the banner.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  "Période de grâce · Échéance : 25 septembre" read on the 28th as a
 *  deadline already missed — and said nothing about the one date that
 *  mattered: the plan keeps working until end date + grace days, and it
 *  stops after that. The screen now names both, and counts down.
 *
 *    0  → today is the last day
 *    n  → n more days after today
 *   -1  → already over (the view will say `locked`)
 * ─────────────────────────────────────────────────────────────────────────
 */
import { DISPLAY_TZ } from "@/lib/format/datetime";

function dayOf(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function graceDaysLeft(graceEndsAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!graceEndsAt) return null;
  const end = new Date(graceEndsAt);
  if (Number.isNaN(end.getTime())) return null;
  if (end.getTime() <= now.getTime()) return -1;
  const days = Math.round((Date.parse(`${dayOf(end)}T00:00:00Z`) - Date.parse(`${dayOf(now)}T00:00:00Z`)) / 86_400_000);
  return Math.max(0, days);
}
