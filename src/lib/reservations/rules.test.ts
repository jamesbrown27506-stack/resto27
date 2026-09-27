import { describe, expect, it } from "vitest";
import {
  addDays,
  closureOn,
  groupSlotsByService,
  horizonDays,
  isGroupRequest,
  isOccasion,
  lastBookableDate,
  withinHorizon,
} from "./rules";

const now = new Date("2026-09-27T10:00:00Z");

describe("booking rules", () => {
  it("adds calendar days across month ends", () => {
    expect(addDays("2026-09-27", 7)).toBe("2026-10-04");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("limits how far ahead a date can be chosen", () => {
    expect(lastBookableDate(7, now)).toBe("2026-10-04");
    expect(withinHorizon("2026-10-04", 7, now)).toBe(true);
    expect(withinHorizon("2026-10-05", 7, now)).toBe(false);
  });

  it("clamps the admin setting", () => {
    expect(horizonDays(undefined, 60)).toBe(60);
    expect(horizonDays(-3, 7)).toBe(7);
    expect(horizonDays(900, 7)).toBe(365);
  });

  it("finds the closure covering a date", () => {
    const closures = [{ startsOn: "2026-12-24", endsOn: "2026-12-26", reason: "Noël" }];
    expect(closureOn("2026-12-25", closures)?.reason).toBe("Noël");
    expect(closureOn("2026-12-27", closures)).toBeNull();
  });

  it("turns a party above the maximum into a group request", () => {
    expect(isGroupRequest(12, 12)).toBe(false);
    expect(isGroupRequest(13, 12)).toBe(true);
    expect(isGroupRequest(13, null)).toBe(true);
  });

  it("knows its occasions and splits the day into services", () => {
    expect(isOccasion("birthday")).toBe(true);
    expect(isOccasion("wedding")).toBe(false);
    expect(groupSlotsByService(["12:00", "15:30", "16:00", "20:30"])).toEqual({
      lunch: ["12:00", "15:30"],
      dinner: ["16:00", "20:30"],
    });
  });
});
