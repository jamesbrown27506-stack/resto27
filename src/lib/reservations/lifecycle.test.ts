import { describe, expect, it } from "vitest";
import {
  canCustomerCancelReservation,
  canCustomerPayReservation,
  canDecideReservation,
  canManagerCollectReservationDeposit,
  canSetReservationStatus,
  isUpcomingReservation,
  partitionCustomerReservations,
} from "./lifecycle";

const NOW = new Date("2026-08-25T12:00:00.000Z");

describe("customer reservation lists", () => {
  it("keeps a future awaiting-payment booking in Upcoming", () => {
    expect(
      isUpcomingReservation(
        {
          status: "awaiting_payment",
          reservedFor: "2026-08-26T18:00:00.000Z",
          durationMin: 90,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("keeps a booking active for its service window", () => {
    expect(
      isUpcomingReservation(
        { status: "confirmed", reservedFor: "2026-08-25T11:30:00.000Z", durationMin: 90 },
        NOW,
      ),
    ).toBe(true);
  });

  it("moves terminal and stale bookings to History", () => {
    expect(
      isUpcomingReservation(
        { status: "completed", reservedFor: "2026-08-26T18:00:00.000Z", durationMin: 90 },
        NOW,
      ),
    ).toBe(false);
    expect(
      isUpcomingReservation(
        { status: "confirmed", reservedFor: "2026-08-25T08:00:00.000Z", durationMin: 90 },
        NOW,
      ),
    ).toBe(false);
  });

  it("sorts Upcoming soonest first and History newest first", () => {
    const rows = [
      { id: "later", status: "confirmed" as const, reservedFor: "2026-08-27T18:00:00.000Z", durationMin: 90 },
      { id: "old", status: "completed" as const, reservedFor: "2026-08-20T18:00:00.000Z", durationMin: 90 },
      { id: "soon", status: "awaiting_payment" as const, reservedFor: "2026-08-26T18:00:00.000Z", durationMin: 90 },
      { id: "new", status: "cancelled" as const, reservedFor: "2026-08-24T18:00:00.000Z", durationMin: 90 },
    ];

    const result = partitionCustomerReservations(rows, NOW);
    expect(result.upcoming.map((row) => row.id)).toEqual(["soon", "later"]);
    expect(result.history.map((row) => row.id)).toEqual(["new", "old"]);
  });
});

describe("reservation controls", () => {
  it("gives the customer the payment action only while a deposit is due", () => {
    expect(
      canCustomerPayReservation({ status: "awaiting_payment", depositPaid: false, depositAmount: 2_000 }),
    ).toBe(true);
    expect(
      canCustomerPayReservation({ status: "pending", depositPaid: false, depositAmount: 2_000 }),
    ).toBe(false);
    expect(
      canCustomerPayReservation({ status: "awaiting_payment", depositPaid: true, depositAmount: 2_000 }),
    ).toBe(false);
  });

  it("lets the customer cancel every pre-service state", () => {
    expect(canCustomerCancelReservation("pending")).toBe(true);
    expect(canCustomerCancelReservation("awaiting_payment")).toBe(true);
    expect(canCustomerCancelReservation("confirmed")).toBe(true);
    expect(canCustomerCancelReservation("seated")).toBe(false);
  });

  it("does not let restaurant actions skip or reverse states", () => {
    expect(canDecideReservation("pending", "confirmed")).toBe(true);
    expect(canDecideReservation("awaiting_payment", "confirmed")).toBe(false);
    expect(canDecideReservation("awaiting_payment", "cancelled")).toBe(true);
    expect(canSetReservationStatus("confirmed", "seated")).toBe(true);
    expect(canSetReservationStatus("confirmed", "completed")).toBe(false);
    expect(canSetReservationStatus("seated", "completed")).toBe(true);
  });

  it("keeps online deposits customer-owned and percentage collection in service", () => {
    expect(
      canManagerCollectReservationDeposit({ status: "pending", depositPercent: 0, depositPaid: false }),
    ).toBe(false);
    expect(
      canManagerCollectReservationDeposit({ status: "awaiting_payment", depositPercent: 0, depositPaid: false }),
    ).toBe(true);
    expect(
      canManagerCollectReservationDeposit({ status: "confirmed", depositPercent: 10, depositPaid: false }),
    ).toBe(false);
    expect(
      canManagerCollectReservationDeposit({ status: "seated", depositPercent: 10, depositPaid: false }),
    ).toBe(true);
  });
});
