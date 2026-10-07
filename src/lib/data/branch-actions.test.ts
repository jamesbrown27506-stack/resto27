import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), account: vi.fn(), team: vi.fn(), install: vi.fn(), announce: vi.fn(),
  coverage: vi.fn(), from: vi.fn(), limits: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/locale-server", () => ({ getTranslator: async () => (key: string) => key }));
vi.mock("@/lib/auth/branch", () => ({ requireBranch: mocks.context }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/branches/team", () => ({ loadBranchTeam: mocks.team, installBranchTeam: mocks.install, announceBranchTeam: mocks.announce }));
vi.mock("@/lib/branches/account", () => ({
  loadBranchAccount: mocks.account, syncBranchCoverage: mocks.coverage,
  refreshBranchInvoices: vi.fn(), accountOpenBranchCount: () => 0, accountCoveredCount: () => 2,
  ensureBranchTopUp: vi.fn(),
}));
vi.mock("@/lib/billing/entitlements", () => ({ entitlementsFor: mocks.limits }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("./quartiers", () => ({ resolveOrCreateQuartier: async () => "quartier" }));
import { createBranch } from "./branch-actions";

const input = { label: "Bonapriso", quartier: "Bonapriso", address: "Rue Njo Njo", manager: { kind: "member" as const, profileId: "marie" } };
const main = { id: "main", name: "Restaurant", label: "Principal", status: "active", ownerId: "owner", serviceAreaId: "city", row: {} };
const query = () => {
  let operation = "read";
  const chain = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain),
    insert: vi.fn(() => { operation = "insert"; return chain; }),
    update: vi.fn(() => { operation = "ready"; return chain; }),
    delete: vi.fn(() => { operation = "delete"; return chain; }),
    single: vi.fn(async () => ({ data: { id: "new-branch" }, error: null })),
    maybeSingle: vi.fn(async () => ({ data: operation === "ready" ? { id: "new-branch" } : null, error: null })),
    then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  return chain;
};
let restaurantQuery: ReturnType<typeof query>;

describe("creating a branch with leadership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({ profile: { id: "owner", name: "Owner" }, active: { restaurantId: "main", parentId: null, role: "owner" }, branches: [{ restaurantId: "main", role: "owner" }], impersonating: false });
    mocks.account.mockResolvedValue({ migrated: true, main, branches: [], plan: { tier: "professional", includedBranches: 3, extraBranchPrice: 7500 }, subscription: { state: "active" } });
    mocks.team.mockResolvedValue({ available: true, members: [{ profileId: "owner", name: "Owner", email: "owner@example.com" }, { profileId: "marie", name: "Marie", email: "marie@example.com" }] });
    mocks.install.mockResolvedValue({ ok: true, invitations: [] });
    mocks.announce.mockResolvedValue(true);
    mocks.limits.mockResolvedValue({ staffManagement: true, staffLimit: 10 });
    restaurantQuery = query(); mocks.from.mockReturnValue(restaurantQuery);
  });
  it("checks the main owner's capability before any role grants or branch writes", async () => {
    mocks.context.mockResolvedValue({ profile: { id: "manager" }, active: { restaurantId: "main", parentId: null, role: "manager" }, branches: [{ restaurantId: "main", role: "manager" }], impersonating: false });
    expect(await createBranch(input)).toMatchObject({ ok: false, reason: "notOwner" });
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.install).not.toHaveBeenCalled();
  });
  it("rejects foreign team ids and phone numbers entered as an address before creating anything", async () => {
    expect(await createBranch({ ...input, manager: { kind: "member", profileId: "foreign" } })).toMatchObject({ ok: false, reason: "teamInvalid" });
    expect(await createBranch({ ...input, address: "+237699123456" })).toMatchObject({ ok: false, reason: "address" });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("preserves the main owner, installs the manager before publishing and never grants withdrawal rights", async () => {
    expect(await createBranch(input)).toMatchObject({ ok: true, branchId: "new-branch" });
    expect(restaurantQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ parent_id: "main", owner_id: "owner", status: "paused", branch_closed_at: expect.any(String) }));
    expect(mocks.install).toHaveBeenCalledWith("new-branch", [expect.objectContaining({ profileId: "marie", role: "manager" })], expect.anything());
    expect(mocks.install.mock.invocationCallOrder[0]).toBeLessThan(restaurantQuery.update.mock.invocationCallOrder[0]);
    expect(mocks.from).toHaveBeenCalledWith("restaurants");
    expect(mocks.from).not.toHaveBeenCalledWith("withdrawal_permissions");
    expect(mocks.coverage).toHaveBeenCalledOnce();
  });
  it("respects the plan's staff seats before creating the branch", async () => {
    mocks.limits.mockResolvedValue({ staffManagement: true, staffLimit: 0 });
    expect(await createBranch(input)).toMatchObject({ ok: false, reason: "staffLimit" });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("undoes an unpublished branch when the team write fails, without billing or sending invitations", async () => {
    mocks.install.mockResolvedValue({ ok: false, invitations: [] });
    expect(await createBranch(input)).toMatchObject({ ok: false, reason: "teamSaveFailed" });
    expect(restaurantQuery.delete).toHaveBeenCalledOnce();
    expect(restaurantQuery.update).not.toHaveBeenCalled();
    expect(mocks.coverage).not.toHaveBeenCalled(); expect(mocks.announce).not.toHaveBeenCalled();
  });
  it("returns the saved closed branch if activation fails, avoiding duplicate retries and automatic publication", async () => {
    restaurantQuery.maybeSingle.mockImplementation(async () => ({ data: null, error: null }));
    expect(await createBranch(input)).toMatchObject({ ok: true, branchId: "new-branch", note: "mbr.note.createdClosed" });
    expect(mocks.coverage).not.toHaveBeenCalled();
    expect(mocks.announce).toHaveBeenCalledOnce();
  });
});
