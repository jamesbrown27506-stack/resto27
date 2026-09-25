import { describe, expect, it } from "vitest";
import { prepMinutes, prepNudgeDue } from "./stage-watch";

const MIN = 60_000;

describe("forgotten-step reminders", () => {
  it("bounds the restaurant's usual time", () => {
    expect(prepMinutes(30)).toBe(30);
    expect(prepMinutes(5)).toBe(15);
    expect(prepMinutes(500)).toBe(120);
    expect(prepMinutes(null)).toBe(30);
  });

  it("reminds once at 1× and again at 2×, then stops", () => {
    const base = { enteredAt: 0, estimateMinutes: 30 };
    expect(prepNudgeDue({ ...base, now: 29 * MIN, alreadySent: 0 })).toBeNull();
    expect(prepNudgeDue({ ...base, now: 30 * MIN, alreadySent: 0 })).toBe(1);
    expect(prepNudgeDue({ ...base, now: 45 * MIN, alreadySent: 1 })).toBeNull();
    expect(prepNudgeDue({ ...base, now: 60 * MIN, alreadySent: 1 })).toBe(2);
    expect(prepNudgeDue({ ...base, now: 600 * MIN, alreadySent: 2 })).toBeNull();
  });
});
