import { describe, expect, it } from "vitest";
import { dishPriceRange, isPriceInRange, linesToPrice, normalisePriceMax } from "./custom-price";

describe("customizable dish prices", () => {
  it("has no range for a fixed-price dish", () => {
    expect(dishPriceRange({ price: 1500 })).toBeNull();
  });

  it("shows min–max, options shifting both ends", () => {
    expect(dishPriceRange({ price: 500, priceToConfirm: true, priceMax: 1000 })).toEqual({ min: 500, max: 1000 });
    expect(dishPriceRange({ price: 500, priceToConfirm: true, priceMax: 1000 }, 200)).toEqual({ min: 700, max: 1200 });
    // No ceiling given: the range collapses to the minimum.
    expect(dishPriceRange({ price: 500, priceToConfirm: true, priceMax: null })).toEqual({ min: 500, max: 500 });
  });

  it("accepts only whole prices inside the range", () => {
    expect(isPriceInRange(750, 500, 1000)).toBe(true);
    expect(isPriceInRange(500, 500, 1000)).toBe(true);
    expect(isPriceInRange(1001, 500, 1000)).toBe(false);
    expect(isPriceInRange(499, 500, 1000)).toBe(false);
    expect(isPriceInRange(750.5, 500, 1000)).toBe(false);
  });

  it("normalises the ceiling a manager types", () => {
    expect(normalisePriceMax(500, 1000)).toBe(1000);
    expect(normalisePriceMax(500, 300)).toBe(500);
    expect(normalisePriceMax(500, 0)).toBeNull();
    expect(normalisePriceMax(500, null)).toBeNull();
  });

  it("lists only lines still waiting for a price", () => {
    const lines = [
      { id: "a", priceToConfirm: true, priceConfirmedAt: null },
      { id: "b", priceToConfirm: true, priceConfirmedAt: "2026-09-28T10:00:00Z" },
      { id: "c", priceToConfirm: false, priceConfirmedAt: null },
    ];
    expect(linesToPrice(lines).map((l) => l.id)).toEqual(["a"]);
  });
});
