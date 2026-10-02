import { describe, expect, it } from "vitest";
import { bookingDay, homeBookings, splitHomeOrders } from "./sections";
import type { OrderStatus } from "@/lib/format/order-status";

const NOW = Date.parse("2026-10-02T12:00:00Z");

function order(id: string, status: OrderStatus, extra: Partial<Parameters<typeof splitHomeOrders>[0][number]> = {}) {
  return {
    id,
    status,
    isPaid: false,
    createdAt: "2026-10-02T11:50:00Z",
    scheduledFor: null,
    restaurantId: `r-${id}`,
    history: [] as { status: string; at: string }[],
    items: [{ menuItemId: "dish" }],
    ...extra,
  };
}

describe("splitHomeOrders", () => {
  it("puts an accepted unpaid order in 'to pay' with its deadline from acceptance", () => {
    const o = order("a", "awaiting_customer", {
      history: [
        { status: "pending", at: "2026-10-02T11:50:00Z" },
        { status: "awaiting_customer", at: "2026-10-02T11:55:00Z" },
      ],
    });
    const { toPay, inProgress } = splitHomeOrders([o], 15, NOW);
    expect(toPay).toHaveLength(1);
    expect(toPay[0].deadline).toBe("2026-10-02T12:10:00.000Z");
    expect(toPay[0].minutesLeft).toBe(10);
    expect(inProgress).toHaveLength(0);
  });

  it("treats a paid order still marked awaiting_customer as under way", () => {
    const { toPay, inProgress } = splitHomeOrders([order("a", "awaiting_customer", { isPaid: true })], 15, NOW);
    expect(toPay).toHaveLength(0);
    expect(inProgress).toHaveLength(1);
  });

  it("separates waiting and in-progress orders", () => {
    const { waiting, inProgress } = splitHomeOrders(
      [order("p", "pending"), order("c", "confirmed"), order("s", "shipped"), order("x", "cancelled")],
      15,
      NOW,
    );
    expect(waiting.map((w) => w.order.id)).toEqual(["p"]);
    expect(waiting[0].minutesLeft).toBe(5);
    expect(inProgress.map((o) => o.id)).toEqual(["c", "s"]);
  });

  it("offers one past order per restaurant, only when a dish can be reordered", () => {
    const { reorder } = splitHomeOrders(
      [
        order("new", "delivered", { restaurantId: "mami" }),
        order("old", "delivered", { restaurantId: "mami" }),
        order("gone", "delivered", { restaurantId: "white", items: [{ menuItemId: null }] }),
        order("other", "delivered", { restaurantId: "royal" }),
        order("cancel", "cancelled", { restaurantId: "vab" }),
      ],
      15,
      NOW,
    );
    expect(reorder.map((o) => o.id)).toEqual(["new", "other"]);
  });
});

describe("homeBookings", () => {
  const booking = (status: "pending" | "awaiting_payment" | "confirmed", reservedFor: string, depositPaid = false, depositAmount = 0) => ({
    status,
    reservedFor,
    depositPaid,
    depositAmount,
  });

  it("puts a deposit owed first, whatever its date", () => {
    const owed = booking("awaiting_payment", "2026-10-09T19:00:00Z", false, 5000);
    const tonight = booking("confirmed", "2026-10-02T19:00:00Z");
    expect(homeBookings([tonight, owed], NOW)).toEqual([owed, tonight]);
  });

  it("leaves out tables more than a day and a half away", () => {
    expect(homeBookings([booking("confirmed", "2026-10-05T19:00:00Z")], NOW)).toEqual([]);
  });
});

describe("bookingDay", () => {
  it("reads today and tomorrow on Douala's calendar", () => {
    expect(bookingDay("2026-10-02T19:00:00Z", NOW)).toBe("today");
    // 23:30 UTC is already 00:30 the next day in Douala.
    expect(bookingDay("2026-10-02T23:30:00Z", NOW)).toBe("tomorrow");
    expect(bookingDay("2026-10-04T19:00:00Z", NOW)).toBe("later");
  });
});
