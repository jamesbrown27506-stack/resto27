import { describe, expect, it } from "vitest";
import { canFulfilAt, canTakeAsapOrder, isServiceOpenAt, nextServiceSlot, quickServiceTimes, serviceDateAndTime } from "./service-hours";

const hours = [
  { weekday: 1, opensAt: "10:00", closesAt: "22:00" },
  { weekday: 2, opensAt: "10:00", closesAt: "22:00" },
  { weekday: 0, opensAt: null, closesAt: null },
];

const douala = (value: string) => new Date(`${value}+01:00`);

describe("restaurant service hours", () => {
  it("rejects ASAP when closed or too near closing", () => {
    expect(canTakeAsapOrder(hours, douala("2026-09-21T09:45:00"))).toBe(false);
    expect(canTakeAsapOrder(hours, douala("2026-09-21T12:00:00"))).toBe(true);
    expect(canTakeAsapOrder(hours, douala("2026-09-21T21:45:00"))).toBe(false);
  });

  it("requires scheduled service and preparation to fit opening hours", () => {
    expect(canFulfilAt(hours, douala("2026-09-21T10:00:00"))).toBe(false);
    expect(canFulfilAt(hours, douala("2026-09-21T10:30:00"))).toBe(true);
    expect(canFulfilAt(hours, douala("2026-09-20T12:00:00"))).toBe(false);
  });

  it("suggests the next available service time in Douala", () => {
    const slot = nextServiceSlot(hours, douala("2026-09-21T22:10:00"));
    expect(slot && serviceDateAndTime(slot)).toEqual({ date: "2026-09-22", time: "10:30" });
  });

  it("supports restaurants open across midnight", () => {
    const late = [{ weekday: 1, opensAt: "18:00", closesAt: "02:00" }];
    expect(isServiceOpenAt(late, douala("2026-09-22T01:00:00"))).toBe(true);
    expect(canFulfilAt(late, douala("2026-09-22T00:30:00"))).toBe(true);
    expect(isServiceOpenAt(late, douala("2026-09-22T02:00:00"))).toBe(false);
  });
});

describe("quickServiceTimes", () => {
  it("offers every half hour the kitchen can serve, a preparation window from now", () => {
    const times = quickServiceTimes(hours, "2026-09-21", douala("2026-09-21T12:10:00"), 30, 50);
    expect(times[0]).toBe("13:00");
    expect(times.at(-1)).toBe("21:30");
    expect(times).not.toContain("22:00");
  });

  it("starts at the first servable slot on a later day, and stops at the limit", () => {
    const times = quickServiceTimes(hours, "2026-09-22", douala("2026-09-21T12:00:00"), 30, 4);
    expect(times).toEqual(["10:30", "11:00", "11:30", "12:00"]);
  });

  it("offers nothing on a closed day", () => {
    expect(quickServiceTimes(hours, "2026-09-20", douala("2026-09-19T12:00:00"))).toEqual([]);
  });
});
