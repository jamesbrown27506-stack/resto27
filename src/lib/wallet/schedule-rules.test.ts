import { describe, expect, it } from "vitest";
import { doualaDay, scheduleDue, scheduledAmount } from "./schedule-rules";

describe("Douala days", () => {
  it("reads the calendar day in Cameroon, not in UTC", () => {
    // 23:30 UTC on Sunday 4 Oct is 00:30 Monday 5 Oct in Douala (UTC+1).
    const day = doualaDay(new Date("2026-10-04T23:30:00Z"));
    expect(day).toEqual({ ymd: "2026-10-05", weekday: 1, dayOfMonth: 5, month: "2026-10" });
  });
});

describe("when a scheduled payout is due", () => {
  const monday = new Date("2026-10-05T02:15:00Z");

  it("runs daily once per day", () => {
    expect(scheduleDue({ frequency: "daily", weekday: null, lastRunAt: null }, monday)).toBe(true);
    expect(scheduleDue({ frequency: "daily", weekday: null, lastRunAt: "2026-10-05T01:00:00Z" }, monday)).toBe(false);
    expect(scheduleDue({ frequency: "daily", weekday: null, lastRunAt: "2026-10-04T02:15:00Z" }, monday)).toBe(true);
  });

  it("runs weekly on its own day only", () => {
    expect(scheduleDue({ frequency: "weekly", weekday: 1, lastRunAt: null }, monday)).toBe(true);
    expect(scheduleDue({ frequency: "weekly", weekday: 5, lastRunAt: null }, monday)).toBe(false);
  });

  it("runs monthly once, catching up if the 1st was missed", () => {
    expect(scheduleDue({ frequency: "monthly", weekday: null, lastRunAt: "2026-09-01T02:15:00Z" }, monday)).toBe(true);
    expect(scheduleDue({ frequency: "monthly", weekday: null, lastRunAt: "2026-10-01T02:15:00Z" }, monday)).toBe(false);
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
