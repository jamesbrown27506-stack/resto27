import { describe, expect, it } from "vitest";
import { computeTotals, promotionDiscount } from "./totals";

describe("computeTotals", () => {
  it("applies the service charge to food only, after the discount", () => {
    const t = computeTotals({
      subtotal: 10000,
      discount: 1000,
      serviceChargePercent: 5,
    });
    // netFood 9000, service charge 5 % of 9000 = 450, delivery 0.
    expect(t.netFood).toBe(9000);
    expect(t.serviceCharge).toBe(450);
    expect(t.total).toBe(9450);
  });

  it("never applies the service charge to the delivery fee", () => {
    const t = computeTotals({
      subtotal: 5000,
      serviceChargePercent: 5,
      deliveryFee: 1500,
    });
    expect(t.serviceCharge).toBe(250); // 5 % of 5000, not of 6500.
    expect(t.total).toBe(6750);
  });

  it("a discount larger than the basket cannot produce a negative base", () => {
    const t = computeTotals({ subtotal: 3000, discount: 5000, serviceChargePercent: 5 });
    expect(t.netFood).toBe(0);
    expect(t.serviceCharge).toBe(0);
    expect(t.total).toBe(0);
  });

  it("subtracts loyalty value, but never below zero", () => {
    const t = computeTotals({ subtotal: 2000, serviceChargePercent: 5, loyaltyValue: 4000 });
    expect(t.total).toBe(0);
  });

  it("defaults the service charge to 5 % when omitted", () => {
    const t = computeTotals({ subtotal: 1000 });
    expect(t.serviceChargePercent).toBe(5);
    expect(t.serviceCharge).toBe(50);
    expect(t.total).toBe(1050);
  });

  it("rounds every figure to whole francs", () => {
    const t = computeTotals({ subtotal: 3333.33, serviceChargePercent: 5.5, deliveryFee: 999.5 });
    expect(Number.isInteger(t.subtotal)).toBe(true);
    expect(Number.isInteger(t.serviceCharge)).toBe(true);
    expect(Number.isInteger(t.total)).toBe(true);
  });
});

describe("promotionDiscount", () => {
  it("computes a percentage off, rounded to whole francs", () => {
    expect(promotionDiscount(10000, 15)).toBe(1500);
    expect(promotionDiscount(333, 10)).toBe(33);
  });
});
