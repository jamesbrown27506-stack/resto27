import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/mail", () => ({ trySendMail: vi.fn(async () => ({ sent: true })) }));
vi.mock("@/lib/site-url", () => ({ absoluteUrl: vi.fn(async (path: string) => "https://example.test" + path) }));
import { createAdminClient } from "@/lib/supabase/server";
import { installBranchTeam, loadBranchTeam } from "./team";
import type { AuthProfile } from "@/lib/auth/session";

const actor = { id: "owner" } as AuthProfile;

describe("branch team database boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("reads only active accepted memberships in the owner's group and excludes disabled people", async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "in", "eq"]) query[method] = vi.fn(() => query);
    query.is = vi.fn(async () => ({ error: null, data: [
      { profile_id: "marie", profiles: { id: "marie", name: "Marie", email: "marie@example.com", status: "active", deleted_at: null } },
      { profile_id: "marie", profiles: { id: "marie", name: "Marie", email: "marie@example.com", status: "active", deleted_at: null } },
      { profile_id: "removed", profiles: { id: "removed", name: "Removed", email: "removed@example.com", status: "active", deleted_at: "2026-01-01" } },
      { profile_id: "suspended", profiles: { id: "suspended", name: "Suspended", email: "suspended@example.com", status: "suspended", deleted_at: null } },
    ] }));
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => query) } as unknown as ReturnType<typeof createAdminClient>);
    expect(await loadBranchTeam(["main", "branch"])).toEqual({ available: true, members: [{ profileId: "marie", name: "Marie", email: "marie@example.com" }] });
    expect(query.in).toHaveBeenCalledWith("restaurant_id", ["main", "branch"]);
    expect(query.eq).toHaveBeenCalledWith("status", "active");
    expect(query.eq).toHaveBeenCalledWith("profiles.status", "active");
    expect(query.is).toHaveBeenCalledWith("profiles.deleted_at", null);
    query.is.mockResolvedValue({ data: null, error: { code: "unavailable" } });
    expect(await loadBranchTeam(["main"])).toEqual({ available: false, members: [] });
  });
  it("writes selected roles in one statement, with pending single-use invitations for new people", async () => {
    const insert = vi.fn(async (rows: unknown): Promise<{ error: null | { code: string } }> => { void rows; return { error: null }; });
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => ({ insert })) } as unknown as ReturnType<typeof createAdminClient>);
    const result = await installBranchTeam("new-branch", [
      { profileId: "existing", name: "Existing", email: "existing@example.com", role: "owner" },
      { profileId: null, name: null, email: "new@example.com", role: "manager" },
    ], actor);
    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0][0] as unknown as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ restaurant_id: "new-branch", profile_id: "existing", role: "owner", status: "active", invite_token: null });
    expect(rows[1]).toMatchObject({ restaurant_id: "new-branch", profile_id: null, role: "manager", status: "invited", invited_email: "new@example.com", accepted_at: null });
    expect(rows[1].invite_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(String(rows[1].invite_expires)) - Date.now()).toBeGreaterThan(6 * 86_400_000);
    insert.mockResolvedValue({ error: { code: "write-failed" } });
    expect((await installBranchTeam("new-branch", [{ profileId: null, name: null, email: "new@example.com", role: "manager" }], actor)).ok).toBe(false);
  });
});
