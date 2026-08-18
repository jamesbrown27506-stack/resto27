/**
 * Opening-hours helpers, shared by every customer-facing surface.
 *
 * Kept free of imports from lib/data so client components can use it without
 * pulling in a server-only module — the shape below is structural, and
 * `RestaurantHours` from lib/data/public matches it exactly.
 */

export interface OpenHours {
  /** 0 = Sunday, matching JS getDay(). */
  weekday: number;
  /** "HH:MM" or null when the restaurant is closed that day. */
  opensAt: string | null;
  closesAt: string | null;
}

/** "HH:MM" on the given clock. */
function hhmm(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Whether a restaurant is open right now, from its weekly hours.
 *
 * Handles overnight spans (e.g. 23:00 – 02:00: open if we are past opening OR
 * still before closing). No hours for today, or a day marked closed, means
 * closed.
 */
export function isOpenNow(hours: OpenHours[], now: Date): boolean {
  const today = hours.find((h) => h.weekday === now.getDay());
  if (!today || !today.opensAt || !today.closesAt) return false;

  const t = hhmm(now);
  const { opensAt, closesAt } = today;
  if (closesAt < opensAt) return t >= opensAt || t < closesAt;
  return t >= opensAt && t < closesAt;
}
