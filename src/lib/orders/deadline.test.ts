import { describe, expect, it } from "vitest";
import { minutesLeft, minutesSetting, orderDeadline } from "./deadline";

describe("order time limit", () => {
  it("gives a pending order N minutes from placement", () => {
    const d = orderDeadline({ status: "pending", createdAt: "2026-09-25T12:00:00Z" }, 15);
    expect(d?.toISOString()).toBe("2026-09-25T12:15:00.000Z");
  });

  it("starts a scheduled order's clock at its prep lead, not at placement", () => {
    const d = orderDeadline(
      { status: "pending", createdAt: "2026-09-25T20:00:00Z", scheduledFor: "2026-09-26T12:00:00Z" },
      15,
    );
    expect(d?.toISOString()).toBe("2026-09-26T11:15:00.000Z");
  });

  it("gives the customer N minutes from acceptance to pay", () => {
    const d = orderDeadline(
      { status: "awaiting_customer", createdAt: "2026-09-25T12:00:00Z", acceptedAt: "2026-09-25T12:10:00Z" },
      15,
    );
    expect(d?.toISOString()).toBe("2026-09-25T12:25:00.000Z");
  });

  it("has no deadline once the order is paid and moving", () => {
    expect(orderDeadline({ status: "confirmed", createdAt: "2026-09-25T12:00:00Z" }, 15)).toBeNull();
  });

  it("reads the admin setting defensively", () => {
    expect(minutesSetting("20", 15)).toBe(20);
    expect(minutesSetting("", 15)).toBe(15);
    expect(minutesSetting("0", 15)).toBe(15);
    expect(minutesSetting("2.5", 15)).toBe(15);
  });

  it("counts minutes left without going negative", () => {
    const deadline = new Date("2026-09-25T12:15:00Z");
    expect(minutesLeft(deadline, Date.parse("2026-09-25T12:10:30Z"))).toBe(5);
    expect(minutesLeft(deadline, Date.parse("2026-09-25T12:20:00Z"))).toBe(0);
  });
});
