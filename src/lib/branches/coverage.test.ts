import { describe, expect, it } from "vitest";
import {
  billableExtraBranches,
  branchStatusChanges,
  coveredBranchCount,
  includedBranchSlots,
  nextBranchCost,
  openBranches,
  planAllowsBranches,
  planInvoiceQuote,
  proratedBranchCharge,
} from "./coverage";

const starter = { monthlyPrice: 0, includedBranches: 1, extraBranchPrice: null };
const professional = { monthlyPrice: 10_000, includedBranches: 1, extraBranchPrice: 10_000 };
const enterprise = { monthlyPrice: 25_000, includedBranches: 3, extraBranchPrice: 7_500 };

describe("what a plan includes", () => {
  it("counts the main restaurant inside included_branches", () => {
    expect(includedBranchSlots(enterprise)).toBe(2);
    expect(includedBranchSlots(professional)).toBe(0);
    expect(includedBranchSlots(starter)).toBe(0);
  });

  it("lets Starter run no branch at all", () => {
    expect(planAllowsBranches(starter)).toBe(false);
    expect(planAllowsBranches(professional)).toBe(true);
    expect(planAllowsBranches(enterprise)).toBe(true);
  });
});

describe("covered branches", () => {
  const live = { mainStatus: "active", mainState: "active", paidExtraBranches: 0 };

  it("covers two branches on Enterprise for the one price", () => {
    expect(coveredBranchCount({ plan: enterprise, ...live })).toBe(2);
  });

  it("adds paid extras on top of the included ones", () => {
    expect(coveredBranchCount({ plan: enterprise, ...live, paidExtraBranches: 2 })).toBe(4);
    expect(coveredBranchCount({ plan: professional, ...live, paidExtraBranches: 1 })).toBe(1);
  });

  it("ignores paid extras on a plan that sells none", () => {
    expect(coveredBranchCount({ plan: starter, ...live, paidExtraBranches: 3 })).toBe(0);
  });

  it("keeps branches running through the grace period", () => {
    expect(coveredBranchCount({ plan: enterprise, ...live, mainState: "grace" })).toBe(2);
  });

  it("pauses every branch once the main subscription lapses or the main is not running", () => {
    expect(coveredBranchCount({ plan: enterprise, ...live, mainState: "locked" })).toBe(0);
    expect(coveredBranchCount({ plan: enterprise, ...live, mainState: "cancelled" })).toBe(0);
    expect(coveredBranchCount({ plan: enterprise, ...live, mainStatus: "suspended" })).toBe(0);
  });
});

describe("billing", () => {
  it("bills nothing extra while the open branches fit the plan", () => {
    expect(planInvoiceQuote(enterprise, 2)).toEqual({ extraBranches: 0, branchAmount: 0, amount: 25_000 });
  });

  it("bills each branch beyond the included ones", () => {
    expect(planInvoiceQuote(enterprise, 4)).toEqual({ extraBranches: 2, branchAmount: 15_000, amount: 40_000 });
    expect(planInvoiceQuote(professional, 2)).toEqual({ extraBranches: 2, branchAmount: 20_000, amount: 30_000 });
  });

  it("never bills branches on a plan that cannot run them", () => {
    expect(billableExtraBranches(starter, 3)).toBe(0);
    expect(planInvoiceQuote(starter, 3).amount).toBe(0);
  });

  it("makes three locations cheaper on Enterprise than on Professional", () => {
    expect(planInvoiceQuote(enterprise, 2).amount).toBeLessThan(planInvoiceQuote(professional, 2).amount);
  });
});

describe("prorating a branch opened mid-period", () => {
  const now = new Date("2026-10-04T10:00:00Z");

  it("charges the days left, rounded up to the franc", () => {
    const periodEnd = new Date(now.getTime() + 10 * 86_400_000).toISOString();
    expect(proratedBranchCharge({ unitPrice: 7_500, branches: 1, now, periodEnd })).toEqual({ amount: 2_500, days: 10 });
    expect(proratedBranchCharge({ unitPrice: 10_000, branches: 1, now, periodEnd })).toEqual({ amount: 3_334, days: 10 });
  });

  it("counts a started day as a day", () => {
    const periodEnd = new Date(now.getTime() + 3_600_000).toISOString();
    expect(proratedBranchCharge({ unitPrice: 7_500, branches: 2, now, periodEnd })).toEqual({ amount: 500, days: 1 });
  });

  it("bills a full month when the subscription has no end date", () => {
    expect(proratedBranchCharge({ unitPrice: 7_500, branches: 1, now, periodEnd: null })).toEqual({ amount: 7_500, days: 30 });
  });

  it("charges nothing once the period is over — the renewal bills it", () => {
    const periodEnd = new Date(now.getTime() - 86_400_000).toISOString();
    expect(proratedBranchCharge({ unitPrice: 7_500, branches: 1, now, periodEnd })).toEqual({ amount: 0, days: 0 });
  });
});

describe("the price shown before opening a branch", () => {
  const now = new Date("2026-10-04T10:00:00Z");
  const periodEnd = new Date(now.getTime() + 15 * 86_400_000).toISOString();
  const base = { paidExtraBranches: 0, periodEnd, now, freeMode: false };

  it("is free while the branch fits the plan", () => {
    expect(nextBranchCost({ plan: enterprise, openBranches: 0, ...base })).toEqual({ kind: "covered" });
    expect(nextBranchCost({ plan: enterprise, openBranches: 1, ...base })).toEqual({ kind: "covered" });
  });

  it("charges the 4th location on Enterprise, prorated to the renewal", () => {
    expect(nextBranchCost({ plan: enterprise, openBranches: 2, ...base })).toEqual({
      kind: "extra",
      monthly: 7_500,
      dueNow: 3_750,
      days: 15,
    });
  });

  it("charges the first branch on Professional at its higher price", () => {
    expect(nextBranchCost({ plan: professional, openBranches: 0, ...base })).toMatchObject({ kind: "extra", monthly: 10_000 });
  });

  it("reuses an extra already paid for", () => {
    expect(nextBranchCost({ plan: enterprise, openBranches: 2, ...base, paidExtraBranches: 1 })).toEqual({ kind: "covered" });
  });

  it("refuses on Starter", () => {
    expect(nextBranchCost({ plan: starter, openBranches: 0, ...base })).toEqual({ kind: "unavailable" });
  });

  it("asks nothing now during free mode", () => {
    expect(nextBranchCost({ plan: professional, openBranches: 0, ...base, freeMode: true })).toEqual({
      kind: "extra",
      monthly: 10_000,
      dueNow: 0,
      days: 0,
    });
  });
});

describe("who runs and who pauses", () => {
  const rows = [
    { id: "c", status: "active", closedAt: null, createdAt: "2026-03-01T00:00:00Z" },
    { id: "a", status: "active", closedAt: null, createdAt: "2026-01-01T00:00:00Z" },
    { id: "b", status: "paused", closedAt: null, createdAt: "2026-02-01T00:00:00Z" },
  ];

  it("keeps the oldest branches and pauses the newest first", () => {
    expect(branchStatusChanges(rows, 2)).toEqual(new Map([["b", "active"], ["c", "paused"]]));
  });

  it("pauses everything when nothing is covered (downgrade to Starter)", () => {
    expect(branchStatusChanges(rows, 0)).toEqual(new Map([["a", "paused"], ["c", "paused"]]));
  });

  it("resumes everything when the plan covers them again", () => {
    expect(branchStatusChanges(rows, 5)).toEqual(new Map([["b", "active"]]));
  });

  it("keeps a closed branch paused and gives its slot to the next one", () => {
    const closed = rows.map((row) => (row.id === "a" ? { ...row, closedAt: "2026-10-01T00:00:00Z" } : row));
    expect(branchStatusChanges(closed, 2)).toEqual(new Map([["a", "paused"], ["b", "active"]]));
    expect(openBranches(closed).map((row) => row.id).sort()).toEqual(["b", "c"]);
  });

  it("never touches a branch the admin suspended", () => {
    const suspended = [{ id: "s", status: "suspended", closedAt: null, createdAt: "2026-01-01T00:00:00Z" }];
    expect(branchStatusChanges(suspended, 3).size).toBe(0);
    expect(openBranches(suspended)).toHaveLength(0);
  });
});
