import { describe, expect, it } from "vitest";
import { latestBranchWalletSummary, type BranchWalletSummary } from "./summary";

const initial: BranchWalletSummary = { restaurantId: "a", available: 2_600, held: 0, checkedAt: "2026-10-06T13:00:00.000Z" };
describe("wallet navigation freshness", () => {
  it("shows the new branch's server balance immediately, discarding the old branch", () => {
    const next = { ...initial, restaurantId: "b", available: 500 };
    expect(latestBranchWalletSummary("b", next, { restaurantId: "a", wallet: initial })).toBe(next);
    expect(latestBranchWalletSummary("b", initial, { restaurantId: "a", wallet: initial })).toBeNull();
  });
  it("does not let an older in-flight read undo a withdrawal page refresh", () => {
    const old = { ...initial, available: 4_600, checkedAt: "2026-10-06T12:59:59.000Z" };
    expect(latestBranchWalletSummary("a", initial, { restaurantId: "a", wallet: old })).toBe(initial);
  });
  it("updates from a newer read, including an unavailable reserve", () => {
    const next = { ...initial, available: null, checkedAt: "2026-10-06T13:00:01.000Z" };
    expect(latestBranchWalletSummary("a", initial, { restaurantId: "a", wallet: next })).toBe(next);
  });
  it("clears money after membership denial and never displays another branch's response", () => {
    expect(latestBranchWalletSummary("a", initial, { restaurantId: "a", wallet: null })).toBeNull();
    expect(latestBranchWalletSummary("a", initial, { restaurantId: "a", wallet: { ...initial, restaurantId: "foreign" } })).toBeNull();
  });
});
