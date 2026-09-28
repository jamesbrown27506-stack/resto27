import { describe, expect, it } from "vitest";
import { graceDaysLeft } from "./grace";

describe("grace countdown", () => {
  // Ended 25 Sep 10:00 Douala, 3 days of grace → until 28 Sep 10:00.
  const graceEndsAt = "2026-09-28T09:00:00Z";

  it("counts the calendar days left in Douala", () => {
    expect(graceDaysLeft(graceEndsAt, new Date("2026-09-26T08:00:00Z"))).toBe(2);
    expect(graceDaysLeft(graceEndsAt, new Date("2026-09-28T06:00:00Z"))).toBe(0);
  });

  it("is over once the moment has passed", () => {
    expect(graceDaysLeft(graceEndsAt, new Date("2026-09-28T09:00:01Z"))).toBe(-1);
  });

  it("has nothing to say without a date", () => {
    expect(graceDaysLeft(null)).toBeNull();
  });
});
