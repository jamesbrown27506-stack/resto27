import { describe, expect, it } from "vitest";
import { computeWithdrawalFee } from "./withdrawal-fee";

describe("computeWithdrawalFee", () => {
  it("withholds the exact percentage on a round amount", () => {
    const { fee, net } = computeWithdrawalFee(3000, 1.5);
    expect(fee).toBe(45);
    expect(net).toBe(2955);
  });

  it("rounds half francs up to whole francs", () => {
    // 500 × 1.5 % = 7.5 → 8, net 492.
    const { fee, net } = computeWithdrawalFee(500, 1.5);
    expect(fee).toBe(8);
    expect(net).toBe(492);
  });

  it("rounds down when the fraction is below half", () => {
    // 333 × 1.5 % = 4.995 → 5, net 328.
    const { fee, net } = computeWithdrawalFee(333, 1.5);
    expect(fee).toBe(5);
    expect(net).toBe(328);
  });

  it("a zero percent fee withholds nothing", () => {
    const { fee, net } = computeWithdrawalFee(5000, 0);
    expect(fee).toBe(0);
    expect(net).toBe(5000);
  });

  it("the two halves always reconcile to the gross", () => {
    for (const gross of [500, 777, 1234, 50000, 500000]) {
      for (const percent of [1.5, 2, 0.5, 10]) {
        const { fee, net } = computeWithdrawalFee(gross, percent);
        expect(fee + net).toBe(gross);
      }
    }
  });

  it("a fee can eat the whole payout", () => {
    const { fee, net } = computeWithdrawalFee(200, 100);
    expect(fee).toBe(200);
    expect(net).toBe(0);
  });
});
