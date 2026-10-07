import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), from: vi.fn(), summary: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.user, getCurrentProfile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/data/wallet-summary", () => ({ readBranchWalletSummary: mocks.summary }));
vi.mock("@/lib/push", () => ({ capProfileSubscriptions: vi.fn(), sendPushWithReport: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/lib/data/notification-channels", () => ({ fetchNotificationChannels: vi.fn(), saveNotificationChannels: vi.fn() }));
import { getManagerNavCounts } from "./notify-actions";

let staff: { data: { id: string; role: string } | null; error: { message: string } | null };
let membership: ReturnType<typeof makeQuery>;
function makeQuery(isMembership: boolean) {
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query), in: vi.fn(() => query),
    is: vi.fn(() => query), gt: vi.fn(() => query),
    maybeSingle: vi.fn(async () => staff),
    then: (resolve: (value: { count: number; error: null }) => unknown) => Promise.resolve({ count: isMembership ? 1 : 0, error: null }).then(resolve),
  };
  return query;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "signed-in-person", role: "manager" });
  staff = { data: { id: "membership", role: "owner" }, error: null };
  membership = makeQuery(true);
  mocks.from.mockImplementation((table: string) => table === "restaurant_staff" ? membership : makeQuery(false));
  mocks.summary.mockResolvedValue({ restaurantId: "branch-a", available: 2_600, held: 0, checkedAt: "2026-10-06T13:00:00.000Z" });
});

describe("the public navigation action's wallet boundary", () => {
  it.each(["owner", "manager"])("serves wallet data only after verifying an active %s membership at that branch", async (role) => {
    staff.data!.role = role;
    expect(await getManagerNavCounts("branch-a")).toMatchObject({ wallet: { available: 2_600 } });
    expect(membership.eq).toHaveBeenCalledWith("restaurant_id", "branch-a");
    expect(membership.eq).toHaveBeenCalledWith("profile_id", "signed-in-person");
    expect(membership.eq).toHaveBeenCalledWith("status", "active");
    expect(membership.in).toHaveBeenCalledWith("restaurants.status", ["active", "paused"]);
    expect(mocks.summary).toHaveBeenCalledWith({ restaurantId: "branch-a", role });
  });
  it.each(["kitchen", "cashier", "waiter", "unknown"])("returns no financial data or query for %s", async (role) => {
    staff.data!.role = role;
    expect(await getManagerNavCounts("branch-a")).toMatchObject({ wallet: null });
    expect(mocks.summary).not.toHaveBeenCalled();
  });
  it("does not borrow the person's owner role at another branch", async () => {
    staff.data!.role = "waiter";
    expect(await getManagerNavCounts("branch-b")).toMatchObject({ wallet: null });
    expect(membership.eq).toHaveBeenCalledWith("restaurant_id", "branch-b");
    expect(mocks.summary).not.toHaveBeenCalled();
  });
  it("denies a foreign branch and membership-query failure before reading anything else", async () => {
    staff.data = null;
    expect(await getManagerNavCounts("foreign")).toMatchObject({ wallet: null });
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.summary).not.toHaveBeenCalled();
    staff.error = { message: "membership unavailable" };
    expect(await getManagerNavCounts("foreign")).toMatchObject({ wallet: null });
    expect(mocks.summary).not.toHaveBeenCalled();
  });
  it("does not give a customer financial access from a stray staff row", async () => {
    mocks.user.mockResolvedValue({ id: "signed-in-person", role: "customer" });
    expect(await getManagerNavCounts("branch-a")).toMatchObject({ wallet: null });
    expect(mocks.summary).not.toHaveBeenCalled();
  });
  it("preserves unavailable as unknown, instead of claiming the wallet is empty", async () => {
    mocks.summary.mockResolvedValue({ restaurantId: "branch-a", available: null, held: null, checkedAt: "2026-10-06T13:00:00.000Z" });
    expect(await getManagerNavCounts("branch-a")).toMatchObject({ wallet: { available: null } });
  });
});
