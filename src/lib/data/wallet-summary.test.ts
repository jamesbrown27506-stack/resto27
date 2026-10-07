import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), hold: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/data/wallet", () => ({ ordersInProgressHold: mocks.hold }));
import { readBranchWalletSummary } from "./wallet-summary";

const branch = { restaurantId: "branch-a", role: "owner" as const };
let query: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn(async () => ({ data: { balance: 5_000 }, error: null })) };
  mocks.from.mockReturnValue(query);
  mocks.hold.mockResolvedValue(1_200);
});

describe("navigation wallet data", () => {
  it.each(["kitchen", "cashier", "waiter"] as const)("never even reads money for %s", async (role) => {
    expect(await readBranchWalletSummary({ ...branch, role })).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.hold).not.toHaveBeenCalled();
  });
  it.each(["owner", "manager"] as const)("reads only the %s's specified branch and subtracts the authoritative refund hold", async (role) => {
    expect(await readBranchWalletSummary({ ...branch, role })).toMatchObject({ restaurantId: "branch-a", available: 3_800, held: 1_200 });
    expect(mocks.from).toHaveBeenCalledWith("restaurant_wallets");
    expect(query.select).toHaveBeenCalledWith("balance");
    expect(query.eq).toHaveBeenCalledWith("restaurant_id", "branch-a");
    expect(mocks.hold).toHaveBeenCalledWith("branch-a");
  });
  it("shows zero when all funds are reserved, without inventing a negative withdrawal amount", async () => {
    mocks.hold.mockResolvedValue(6_000);
    expect(await readBranchWalletSummary(branch)).toMatchObject({ available: 0, held: 6_000 });
  });
  it("treats an absent wallet as zero only after successfully verifying its reserve", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.hold.mockResolvedValue(0);
    expect(await readBranchWalletSummary(branch)).toMatchObject({ available: 0, held: 0 });
  });
  it.each([null, "5000", 5_000.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("does not display an unverified balance %s as zero", async (balance) => {
    query.maybeSingle.mockResolvedValue({ data: { balance }, error: null });
    expect(await readBranchWalletSummary(branch)).toMatchObject({ available: null, held: null });
  });
  it("does not guess a balance if its query or reserve fails", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: { code: "unavailable" } });
    expect(await readBranchWalletSummary(branch)).toMatchObject({ available: null });
    query.maybeSingle.mockResolvedValue({ data: { balance: 5_000 }, error: null });
    mocks.hold.mockRejectedValue(new Error("reserve unavailable"));
    expect(await readBranchWalletSummary(branch)).toMatchObject({ available: null });
  });
});
