import { describe, expect, it } from "vitest";
import { doualaDay, nextScheduledRun, scheduleDue, scheduledAmount } from "./schedule-rules";

describe("Douala days", () => {
  it("reads the calendar day and hour in Cameroon, not in UTC", () => {
    // 23:30 UTC on Sunday 4 Oct is 00:30 Monday 5 Oct in Douala (UTC+1).
    const day = doualaDay(new Date("2026-10-04T23:30:00Z"));
    expect(day).toEqual({ ymd: "2026-10-05", weekday: 1, dayOfMonth: 5, month: "2026-10", hour: 0 });
  });
});

describe("when a scheduled payout is due", () => {
  // Monday 5 Oct 2026, 10:15 in Douala.
  const mondayMorning = new Date("2026-10-05T09:15:00Z");

  it("waits for its hour, then runs once that day", () => {
    const daily = { frequency: "daily" as const, weekday: null, hour: 21, lastRunAt: null };
    expect(scheduleDue(daily, mondayMorning)).toBe(false);
    expect(scheduleDue(daily, new Date("2026-10-05T20:05:00Z"))).toBe(true); // 21:05 Douala
    expect(scheduleDue({ ...daily, lastRunAt: "2026-10-05T20:05:00Z" }, new Date("2026-10-05T21:00:00Z"))).toBe(false);
  });

  it("runs today when its hour already passed — no week lost", () => {
    expect(scheduleDue({ frequency: "weekly", weekday: 1, hour: 9, lastRunAt: null }, mondayMorning)).toBe(true);
  });

  it("runs weekly on its own day only", () => {
    expect(scheduleDue({ frequency: "weekly", weekday: 5, hour: 9, lastRunAt: null }, mondayMorning)).toBe(false);
  });

  it("runs monthly once, catching up if the 1st was missed", () => {
    expect(scheduleDue({ frequency: "monthly", weekday: null, hour: 3, lastRunAt: "2026-09-01T02:15:00Z" }, mondayMorning)).toBe(true);
    expect(scheduleDue({ frequency: "monthly", weekday: null, hour: 3, lastRunAt: "2026-10-01T02:15:00Z" }, mondayMorning)).toBe(false);
  });

  it("keeps the old nightly hour for schedules saved before hours existed", () => {
    expect(scheduleDue({ frequency: "daily", weekday: null, lastRunAt: null }, new Date("2026-10-05T01:30:00Z"))).toBe(false); // 02:30
    expect(scheduleDue({ frequency: "daily", weekday: null, lastRunAt: null }, new Date("2026-10-05T02:30:00Z"))).toBe(true); // 03:30
  });
});

describe("the next payout, shown before saving", () => {
  const sundayAfternoon = new Date("2026-10-04T13:00:00Z"); // Sunday 14:00 Douala

  it("is today, later, when the hour has not come yet", () => {
    const next = nextScheduledRun({ frequency: "weekly", weekday: 0, hour: 21, lastRunAt: null }, sundayAfternoon);
    expect(next).toEqual({ due: false, at: new Date("2026-10-04T20:00:00Z") }); // 21:00 Douala
  });

  it("is right away when today's hour already passed", () => {
    expect(nextScheduledRun({ frequency: "weekly", weekday: 0, hour: 9, lastRunAt: null }, sundayAfternoon)).toEqual({ due: true });
  });

  it("is next week once this week's has gone", () => {
    const next = nextScheduledRun({ frequency: "weekly", weekday: 0, hour: 9, lastRunAt: "2026-10-04T08:05:00Z" }, sundayAfternoon);
    expect(next).toEqual({ due: false, at: new Date("2026-10-11T08:00:00Z") });
  });

  it("is the 1st of next month for a monthly schedule already run", () => {
    const next = nextScheduledRun({ frequency: "monthly", weekday: null, hour: 8, lastRunAt: "2026-10-01T07:05:00Z" }, sundayAfternoon);
    expect(next).toEqual({ due: false, at: new Date("2026-11-01T07:00:00Z") });
  });
});

describe("how much it sends", () => {
  it("sends what could be withdrawn, less the reserve", () => {
    expect(scheduledAmount({ balance: 100_000, queued: 10_000, held: 5_000, keep: 20_000, minimum: 5_000 })).toBe(65_000);
  });

  it("sends nothing below the owner's minimum", () => {
    expect(scheduledAmount({ balance: 24_000, queued: 0, held: 0, keep: 20_000, minimum: 5_000 })).toBe(0);
    expect(scheduledAmount({ balance: 10_000, queued: 0, held: 12_000, keep: 0, minimum: 500 })).toBe(0);
  });
});
