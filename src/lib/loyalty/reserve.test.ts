import { describe, expect, it } from "vitest";
import { loyaltyReserve, type LoyaltySummary } from "./reserve";
const summary: LoyaltySummary = { pointValue: 5, outstandingPoints: 100, outstandingValue: 500,
  customersWithPoints: 1, negativeBalances: 0, pendingRedemptionValue: 200, fundedValue: 700, reversedValue: 100,
  restaurantBalances: 1000, customerBalances: 300, pendingRefunds: 100, pendingWithdrawals: 600, unconfirmedPayouts: 50 };
describe("loyalty cash reserve", () => {
  it("counts wallet liabilities, unspent and reserved points without adding funded loyalty or pending withdrawals twice", () => {
    expect(loyaltyReserve(summary, 2000)).toEqual({ cashObligations: 1400, futureLoyalty: 700, recommended: 2150, shortfall: 150, surplus: 0 });
  });
  it("does not claim funding is sufficient when the gateway balance is unavailable", () => {
    expect(loyaltyReserve(summary, null)).toMatchObject({ shortfall: null, surplus: null });
  });
  it("shows an exact top-up requirement and surplus", () => {
    expect(loyaltyReserve(summary, 0).shortfall).toBe(2150);
    expect(loyaltyReserve(summary, 2500)).toMatchObject({ shortfall: 0, surplus: 350 });
  });
});
