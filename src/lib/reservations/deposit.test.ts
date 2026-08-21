import { describe, expect, it } from "vitest";
import { depositChargedNow, normaliseDepositType, requiresOnlinePayment } from "./deposit";

/**
 * This is money taken from a real person's Mobile Money account. The booking
 * form shows a total and the server charges one, and both go through
 * `depositChargedNow` — so these are the tests that keep the two honest.
 */

describe("normaliseDepositType", () => {
  it("keeps the three real types", () => {
    expect(normaliseDepositType("fixed")).toBe("fixed");
    expect(normaliseDepositType("per_seat")).toBe("per_seat");
    expect(normaliseDepositType("percent")).toBe("percent");
  });

  it("falls back to fixed for anything else", () => {
    // undefined is the important one: it is what a database that never ran the
    // migration returns for a column it does not have.
    expect(normaliseDepositType(undefined)).toBe("fixed");
    expect(normaliseDepositType(null)).toBe("fixed");
    expect(normaliseDepositType("perSeat")).toBe("fixed");
    expect(normaliseDepositType(7)).toBe("fixed");
  });
});

describe("depositChargedNow", () => {
  it("charges a fixed fee once, whatever the party size", () => {
    const fee = { amount: 2000, type: "fixed" as const };
    expect(depositChargedNow(fee, 1)).toBe(2000);
    expect(depositChargedNow(fee, 10)).toBe(2000);
  });

  it("multiplies a per-seat fee by the party size", () => {
    const fee = { amount: 1500, type: "per_seat" as const };
    expect(depositChargedNow(fee, 1)).toBe(1500);
    expect(depositChargedNow(fee, 2)).toBe(3000);
    expect(depositChargedNow(fee, 5)).toBe(7500);
  });

  it("never charges a percentage fee online", () => {
    // The bill does not exist at booking, so there is nothing to take a
    // percentage OF. A non-zero answer here would send the customer to a
    // Mobile Money prompt for a number nobody can compute yet.
    expect(depositChargedNow({ amount: 10, type: "percent" }, 4)).toBe(0);
  });

  it("charges nothing when the restaurant asks for nothing", () => {
    expect(depositChargedNow({ amount: 0, type: "fixed" }, 4)).toBe(0);
    expect(depositChargedNow({ amount: 0, type: "per_seat" }, 4)).toBe(0);
  });

  it("floors the party size at one rather than making the fee free", () => {
    const fee = { amount: 1500, type: "per_seat" as const };
    expect(depositChargedNow(fee, 0)).toBe(1500);
    expect(depositChargedNow(fee, -3)).toBe(1500);
    expect(depositChargedNow(fee, Number.NaN)).toBe(1500);
  });

  it("returns whole francs", () => {
    // There is no sub-unit in XAF, and a fractional amount would be rejected
    // by the payment provider rather than rounded by it.
    expect(depositChargedNow({ amount: 1500.6, type: "per_seat" }, 3)).toBe(4503);
    expect(Number.isInteger(depositChargedNow({ amount: 999.4, type: "fixed" }, 2))).toBe(true);
  });
});

describe("requiresOnlinePayment", () => {
  it("is true exactly when something is charged now", () => {
    expect(requiresOnlinePayment({ amount: 2000, type: "fixed" }, 2)).toBe(true);
    expect(requiresOnlinePayment({ amount: 1500, type: "per_seat" }, 2)).toBe(true);
    expect(requiresOnlinePayment({ amount: 10, type: "percent" }, 2)).toBe(false);
    expect(requiresOnlinePayment({ amount: 0, type: "fixed" }, 2)).toBe(false);
  });
});
