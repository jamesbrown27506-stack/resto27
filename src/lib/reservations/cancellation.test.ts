import { describe, expect, it } from "vitest";
import { quoteReservationCancellation } from "./cancellation";

describe("quoteReservationCancellation", () => {
  const now = Date.parse("2026-09-14T10:00:00Z");

  it("refunds the full deposit at exactly one hour and earlier", () => {
    expect(quoteReservationCancellation(true, 10_000, now + 60 * 60_000, now)).toEqual({
      late: false,
      deposit: 10_000,
      refund: 10_000,
      restaurantCompensation: 0,
      platformFee: 0,
    });
  });

  it("splits a cancellation inside the final hour 70/25/5", () => {
    expect(quoteReservationCancellation(true, 10_000, now + 59 * 60_000, now)).toEqual({
      late: true,
      deposit: 10_000,
      refund: 7_000,
      restaurantCompensation: 2_500,
      platformFee: 500,
    });
  });

  it("charges nothing when no deposit was paid", () => {
    expect(quoteReservationCancellation(false, 10_000, now + 30 * 60_000, now)).toMatchObject({
      deposit: 0,
      refund: 0,
      restaurantCompensation: 0,
      platformFee: 0,
    });
  });
});
