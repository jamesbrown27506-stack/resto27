import { describe, expect, it } from "vitest";
import { discountFor } from "./promotions";

describe("discountFor", () => {
  it("applies a percentage discount", () => {
    expect(discountFor({ discount_type: "percent", discount_value: 15, max_discount: null }, 10000)).toBe(1500);
  });

  it("applies a fixed discount in francs", () => {
    expect(discountFor({ discount_type: "fixed", discount_value: 2000, max_discount: null }, 10000)).toBe(2000);
  });

  it("caps a percentage discount at max_discount", () => {
    expect(
      discountFor({ discount_type: "percent", discount_value: 50, max_discount: 2000 }, 10000),
    ).toBe(2000);
  });

  it("never discounts more than the basket", () => {
    expect(
      discountFor({ discount_type: "fixed", discount_value: 5000, max_discount: null }, 3000),
    ).toBe(3000);
  });

  it("a fixed discount below the basket is untouched by the cap", () => {
    expect(
      discountFor({ discount_type: "fixed", discount_value: 1500, max_discount: 2000 }, 10000),
    ).toBe(1500);
  });
});
