import { describe, expect, it } from "vitest";
import { applyTablePlanLimit, onsiteOrdersAllowed } from "./plan-access";
import { seatableTables } from "@/lib/reservations/availability";
import { MANAGER_NAV } from "@/lib/nav";

const floor = Array.from({ length: 9 }, (_, index) => ({
  id: "table-" + (index + 1),
  number: String(index + 1),
  capacity: 4,
  status: "available",
}));

describe("on-site order package access", () => {
  it("blocks Starter, including during platform free mode", () => {
    expect(onsiteOrdersAllowed({ planTier: "starter", subscriptionState: "active" })).toBe(false);
    expect(onsiteOrdersAllowed({ planTier: "starter", subscriptionState: "free_mode" })).toBe(false);
  });

  it("allows paid tiers while active or in their grace period", () => {
    expect(onsiteOrdersAllowed({ planTier: "professional", subscriptionState: "active" })).toBe(true);
    expect(onsiteOrdersAllowed({ planTier: "enterprise", subscriptionState: "grace" })).toBe(true);
  });

  it("blocks an expired paid package and unrecognized tiers", () => {
    expect(onsiteOrdersAllowed({ planTier: "enterprise", subscriptionState: "locked" })).toBe(false);
    expect(onsiteOrdersAllowed({ planTier: "unknown", subscriptionState: "active" })).toBe(false);
  });

  it("leaves reservations ungated and marks on-site orders as paid-only", () => {
    const links = MANAGER_NAV.flatMap((group) => group.items);
    expect(links.find((link) => link.href === "/m/reservations")?.planGated).toBeUndefined();
    expect(links.find((link) => link.href === "/m/table-order")).toMatchObject({
      planGated: true,
      paidOnly: true,
    });
  });
});

describe("table package freeze", () => {
  it("keeps all nine records but permits only the first five by table number", () => {
    const result = applyTablePlanLimit([...floor].reverse(), 5);
    expect(result).toHaveLength(9);
    expect(result.filter((table) => !table.planLocked).map((table) => table.number)).toEqual(["1", "2", "3", "4", "5"]);
    expect(result.filter((table) => table.planLocked)).toHaveLength(4);
    expect(floor.every((table) => table.status === "available")).toBe(true);
  });

  it("uses numeric table order rather than putting table 10 before table 2", () => {
    const tables = [{ id: "ten", number: "10" }, { id: "two", number: "2" }];
    expect(applyTablePlanLimit(tables, 1).find((table) => !table.planLocked)?.id).toBe("two");
  });

  it("automatically unfreezes saved tables when the package allowance rises", () => {
    expect(applyTablePlanLimit(floor, 10).every((table) => !table.planLocked)).toBe(true);
    expect(applyTablePlanLimit(floor, null).every((table) => !table.planLocked)).toBe(true);
  });

  it("excludes frozen tables from customer reservation capacity", () => {
    const result = applyTablePlanLimit(floor, 5);
    const capacity = result.map((table) => ({
      capacity: table.capacity,
      status: table.planLocked ? "out_of_service" : table.status,
    }));
    expect(seatableTables(capacity, 4)).toBe(5);
  });
});
