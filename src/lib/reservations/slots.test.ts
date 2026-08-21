import { describe, expect, it } from "vitest";
import {
  isTodayOrLater,
  minutesNowInDisplayTz,
  slotsForDate,
  todayInDisplayTz,
  weekdayOfDate,
} from "./slots";
import type { RestaurantHours } from "@/lib/data/public";

/**
 * The booking grid is the one place in the app where a wrong answer is
 * invisible: a slot that should not be there looks exactly like one that
 * should, right up until the restaurant has to refuse it by telephone.
 *
 * Every instant here is written as an explicit UTC `Z` value and the expected
 * result is stated in Douala time (UTC+1, no DST) — so a test that starts
 * failing because someone changed the display zone is telling the truth.
 */

/** 10:00–22:00 Monday to Saturday, closed Sunday — the shape in the database. */
const WEEK: RestaurantHours[] = [
  { weekday: 0, opensAt: null, closesAt: null },
  ...[1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    opensAt: "10:00:00",
    closesAt: "22:00:00",
  })),
];

/** Every weekday null — a restaurant that never finished its profile. */
const NO_HOURS: RestaurantHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensAt: null,
  closesAt: null,
}));

// 2026-08-24 is a Monday; 2026-08-23 is the Sunday before it.
const MONDAY = "2026-08-24";
const SUNDAY = "2026-08-23";

/** An instant early on the Sunday, so no "today" filtering ever applies. */
const WELL_BEFORE = new Date("2026-08-23T01:00:00Z");

describe("weekdayOfDate", () => {
  it("reads the weekday from the string, not from a local Date", () => {
    expect(weekdayOfDate(SUNDAY)).toBe(0);
    expect(weekdayOfDate(MONDAY)).toBe(1);
    expect(weekdayOfDate("2026-08-29")).toBe(6);
  });

  it("rejects malformed and impossible dates", () => {
    expect(weekdayOfDate("")).toBeNull();
    expect(weekdayOfDate("24-08-2026")).toBeNull();
    expect(weekdayOfDate("2026-02-31")).toBeNull();
    expect(weekdayOfDate("2026-13-01")).toBeNull();
  });
});

describe("slotsForDate", () => {
  it("runs every 30 minutes from opening to the last seating", () => {
    const { slots } = slotsForDate(WEEK, MONDAY, WELL_BEFORE);

    expect(slots[0]).toBe("10:00");
    expect(slots[1]).toBe("10:30");
    // Closes 22:00, last seating 30 minutes earlier.
    expect(slots.at(-1)).toBe("21:30");
    // 10:00 to 21:30 inclusive, every half hour.
    expect(slots).toHaveLength(24);
    // The middle of the day — the hours the nine hard-coded slots skipped.
    expect(slots).toContain("15:00");
    expect(slots).toContain("15:30");
  });

  it("offers nothing on a day the restaurant is closed, and says why", () => {
    const day = slotsForDate(WEEK, SUNDAY, WELL_BEFORE);
    expect(day.slots).toEqual([]);
    expect(day.reason).toBe("closed");
  });

  it("reports the restaurant's own window for the day", () => {
    const day = slotsForDate(WEEK, MONDAY, WELL_BEFORE);
    expect(day.opensAt).toBe("10:00");
    expect(day.closesAt).toBe("22:00");
  });

  it("drops the hours that have already passed today", () => {
    // 13:10 UTC is 14:10 in Douala. With a 30-minute lead the first bookable
    // half hour is 14:40 rounded up to the grid: 15:00.
    const now = new Date("2026-08-24T13:10:00Z");
    const { slots } = slotsForDate(WEEK, MONDAY, now);

    expect(slots).not.toContain("14:00");
    expect(slots).not.toContain("14:30");
    expect(slots[0]).toBe("15:00");
    expect(slots.at(-1)).toBe("21:30");
  });

  it("keeps the whole day available on a date that is not today", () => {
    // Same late instant, but asking about the following day.
    const now = new Date("2026-08-24T13:10:00Z");
    const { slots } = slotsForDate(WEEK, "2026-08-25", now);
    expect(slots[0]).toBe("10:00");
  });

  it("says the service is over rather than showing an empty grid", () => {
    // 21:30 Douala — past the last seating, but the restaurant is still open.
    const now = new Date("2026-08-24T20:30:00Z");
    const day = slotsForDate(WEEK, MONDAY, now);

    expect(day.slots).toEqual([]);
    expect(day.reason).toBe("tooLate");
    // Distinguishable from "closed": the window is still reported.
    expect(day.opensAt).toBe("10:00");
  });

  it("rounds an off-grid opening time up onto the half hour", () => {
    const odd: RestaurantHours[] = [{ weekday: 1, opensAt: "10:20", closesAt: "22:00" }];
    const { slots } = slotsForDate(odd, MONDAY, WELL_BEFORE);
    expect(slots[0]).toBe("10:30");
  });

  it("stops at the end of the day when the window crosses midnight", () => {
    const late: RestaurantHours[] = [{ weekday: 1, opensAt: "18:00", closesAt: "02:00" }];
    const { slots } = slotsForDate(late, MONDAY, WELL_BEFORE);

    expect(slots[0]).toBe("18:00");
    // 23:30 is the last seating of THIS calendar day; 00:30 belongs to the
    // next date and booking it here would book the wrong night.
    expect(slots.at(-1)).toBe("23:30");
    expect(slots).not.toContain("00:30");
  });

  it("falls back to a plausible day when no hours are configured at all", () => {
    const day = slotsForDate(NO_HOURS, MONDAY, WELL_BEFORE);
    expect(day.reason).toBeNull();
    expect(day.slots[0]).toBe("11:00");
    expect(day.slots.at(-1)).toBe("21:30");
  });

  it("refuses a malformed date outright", () => {
    expect(slotsForDate(WEEK, "not-a-date", WELL_BEFORE).reason).toBe("invalidDate");
  });
});

describe("display-zone clock", () => {
  it("reads the date in Douala, not in the runtime's zone", () => {
    // 23:30 UTC on the 23rd is already 00:30 on the 24th in Douala (UTC+1).
    expect(todayInDisplayTz(new Date("2026-08-23T23:30:00Z"))).toBe("2026-08-24");
  });

  it("reads the time in Douala", () => {
    expect(minutesNowInDisplayTz(new Date("2026-08-24T13:10:00Z"))).toBe(14 * 60 + 10);
  });
});

describe("isTodayOrLater", () => {
  const now = new Date("2026-08-24T09:00:00Z"); // 10:00 Monday in Douala

  it("accepts today and every day after it", () => {
    expect(isTodayOrLater(MONDAY, now)).toBe(true);
    expect(isTodayOrLater("2026-08-25", now)).toBe(true);
    expect(isTodayOrLater("2027-01-01", now)).toBe(true);
  });

  it("refuses yesterday and everything before it", () => {
    expect(isTodayOrLater(SUNDAY, now)).toBe(false);
    expect(isTodayOrLater("2026-01-01", now)).toBe(false);
  });

  it("refuses anything that is not a date", () => {
    expect(isTodayOrLater("", now)).toBe(false);
    expect(isTodayOrLater("2026-02-31", now)).toBe(false);
  });
});
