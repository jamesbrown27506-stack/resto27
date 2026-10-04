/**
 * When a scheduled payout is due, and how much it sends (0074).
 *
 * Plain module — unit tested in schedule-rules.test.ts. Calendar days are
 * DOUALA days: a payout "every Monday" runs on a Monday in Cameroon, not on
 * whatever day UTC happens to be when the nightly job wakes up.
 */

export type PayoutFrequency = "daily" | "weekly" | "monthly";

export interface DoualaDay {
  /** YYYY-MM-DD in Africa/Douala. */
  ymd: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  dayOfMonth: number;
  /** YYYY-MM, for "once a month". */
  month: string;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function doualaDay(date: Date): DoualaDay {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Douala",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
    dayOfMonth: Number(parts.day),
    month: `${parts.year}-${parts.month}`,
  };
}

/**
 * Due today?
 *
 *   daily   — once per Douala day.
 *   weekly  — on its weekday, once.
 *   monthly — the first run of the month on or after the 1st, so a night
 *             the job did not run does not cost the owner a whole month.
 */
export function scheduleDue(
  schedule: { frequency: PayoutFrequency; weekday: number | null; lastRunAt: string | null },
  now: Date,
): boolean {
  const today = doualaDay(now);
  const last = schedule.lastRunAt ? doualaDay(new Date(schedule.lastRunAt)) : null;
  if (last?.ymd === today.ymd) return false;

  switch (schedule.frequency) {
    case "daily":
      return true;
    case "weekly":
      return schedule.weekday !== null && today.weekday === schedule.weekday;
    case "monthly":
      return last?.month !== today.month;
    default:
      return false;
  }
}

/**
 * What the night sends: everything the restaurant could withdraw by hand,
 * less the reserve it chose to keep. Zero below the owner's minimum.
 */
export function scheduledAmount(input: {
  balance: number;
  /** Withdrawals already queued. */
  queued: number;
  /** Paid orders still in progress and upcoming deposits (ordersInProgressHold). */
  held: number;
  keep: number;
  minimum: number;
}): number {
  const amount = Math.floor(input.balance - input.queued - input.held - input.keep);
  return amount >= Math.max(500, input.minimum) ? amount : 0;
}
