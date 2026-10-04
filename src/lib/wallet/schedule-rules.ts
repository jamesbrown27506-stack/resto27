/**
 * When a scheduled payout is due, and how much it sends (0074, hour: 0075).
 *
 * Plain module — unit tested in schedule-rules.test.ts. Calendar days and
 * hours are DOUALA time: a payout "every Monday at 21:00" runs on a Monday
 * evening in Cameroon, whatever UTC says. Cameroon keeps UTC+1 all year (no
 * daylight saving), which the next-run arithmetic relies on.
 *
 * scheduleDue() has an SQL twin, scheduled_payout_due_now() (0075), which
 * gates the five-minute payment job — keep the two in step.
 */

export type PayoutFrequency = "daily" | "weekly" | "monthly";

/** Hour used before 0075 gave schedules a time of their own. */
export const DEFAULT_PAYOUT_HOUR = 3;

const DOUALA_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export interface DoualaDay {
  /** YYYY-MM-DD in Africa/Douala. */
  ymd: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  dayOfMonth: number;
  /** YYYY-MM, for "once a month". */
  month: string;
  /** 0–23. */
  hour: number;
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
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
    dayOfMonth: Number(parts.day),
    month: `${parts.year}-${parts.month}`,
    hour: Number(parts.hour) % 24,
  };
}

export interface PayoutSchedule {
  frequency: PayoutFrequency;
  weekday: number | null;
  /** 0–23, Douala time. */
  hour?: number | null;
  lastRunAt: string | null;
}

/** Is this one of the schedule's days (ignoring the hour and past runs)? */
function onScheduleDay(schedule: PayoutSchedule, day: DoualaDay, last: DoualaDay | null): boolean {
  switch (schedule.frequency) {
    case "daily":
      return true;
    case "weekly":
      return schedule.weekday !== null && day.weekday === schedule.weekday;
    case "monthly":
      return last?.month !== day.month;
    default:
      return false;
  }
}

/**
 * Due now?
 *
 *   daily   — once per Douala day, from its hour on.
 *   weekly  — on its weekday, from its hour on, once.
 *   monthly — the first run of the month from the 1st at its hour, so a day
 *             the job could not run does not cost the owner a whole month.
 *
 * A schedule whose hour already passed today (on one of its days) is due at
 * once — set up on a Sunday afternoon for "Sundays 09:00", it sends today.
 */
export function scheduleDue(schedule: PayoutSchedule, now: Date): boolean {
  const today = doualaDay(now);
  const last = schedule.lastRunAt ? doualaDay(new Date(schedule.lastRunAt)) : null;
  if (last?.ymd === today.ymd) return false;
  if (today.hour < (schedule.hour ?? DEFAULT_PAYOUT_HOUR)) return false;
  return onScheduleDay(schedule, today, last);
}

/**
 * When the next payout will go — for the screen, before the owner saves.
 * "now" when it is already due (it leaves within minutes); otherwise the
 * next Douala date-and-hour that will be due.
 */
export function nextScheduledRun(schedule: PayoutSchedule, now: Date): { due: true } | { due: false; at: Date } {
  if (scheduleDue(schedule, now)) return { due: true };

  const hour = schedule.hour ?? DEFAULT_PAYOUT_HOUR;
  const last = schedule.lastRunAt ? doualaDay(new Date(schedule.lastRunAt)) : null;
  const today = doualaDay(now);

  // Douala midnight of today, as an instant (UTC+1 all year).
  const [y, m, d] = today.ymd.split("-").map(Number) as [number, number, number];
  const todayMidnight = Date.UTC(y, m - 1, d) - DOUALA_OFFSET_MS;

  for (let offset = 0; offset <= 62; offset++) {
    const at = new Date(todayMidnight + offset * DAY_MS + hour * 3_600_000);
    if (at.getTime() <= now.getTime()) continue;
    const day = doualaDay(at);
    if (last?.ymd === day.ymd) continue;
    if (onScheduleDay(schedule, day, last)) return { due: false, at };
  }
  return { due: false, at: new Date(todayMidnight + DAY_MS + hour * 3_600_000) };
}

/**
 * What a payout sends: everything the restaurant could withdraw by hand,
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
