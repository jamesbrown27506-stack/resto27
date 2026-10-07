import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn((path: string) => { throw new Error("redirect:" + path); }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./session", () => ({ getSessionUser: vi.fn(), getActiveProfile: vi.fn() }));
vi.mock("./staff-invitations", async (original) => ({ ...await original<typeof import("./staff-invitations")>(), fetchStaffInvitation: vi.fn() }));
vi.mock("./staff-access", () => ({ syncStaffRole: vi.fn(async () => "manager") }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));
import { acceptStaffInvitation } from "./staff-invite-actions";
import { getSessionUser, getActiveProfile } from "./session";
import { fetchStaffInvitation } from "./staff-invitations";
import { createAdminClient } from "@/lib/supabase/server";
import { syncStaffRole } from "./staff-access";
const token = "c5e3cde0-9a7e-46e4-bccf-28a518adbac1";
const user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>> = { id: "auth-id", email: "staff@example.com", email_confirmed_at: "2026-09-18", user_metadata: {}, aud: "authenticated", created_at: "2026-09-18", app_metadata: { security_email: "staff@example.com", security_email_verified_at: "2026-09-18" } };
const profile = { id: "profile-id", role: "customer", status: "active", deletedAt: null } as NonNullable<Awaited<ReturnType<typeof getActiveProfile>>["profile"]>;
const invitation = { id: "staff-id", status: "invited", invited_email: "staff@example.com", invite_expires: "2099-01-01T00:00:00Z" } as NonNullable<Awaited<ReturnType<typeof fetchStaffInvitation>>>;
describe("accept staff invitation authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessionUser).mockResolvedValue(user);
    vi.mocked(getActiveProfile).mockResolvedValue({ profile });
    vi.mocked(fetchStaffInvitation).mockResolvedValue(invitation);
  });
  it("requires sign in before accessing the roster", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    await expect(acceptStaffInvitation(token)).rejects.toThrow("redirect:/login?next=");
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it("requires verified email and an active profile", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ ...user, app_metadata: {} });
    await expect(acceptStaffInvitation(token)).rejects.toThrow("/security?step=email");
    expect(createAdminClient).not.toHaveBeenCalled();
    vi.mocked(getSessionUser).mockResolvedValue(user);
    vi.mocked(getActiveProfile).mockResolvedValue({ reason: "suspended" });
    await expect(acceptStaffInvitation(token)).rejects.toThrow("error=account");
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it("rejects another account holding a forwarded invite", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ ...user, email: "other@example.com", app_metadata: { ...user.app_metadata, security_email: "other@example.com" } });
    await expect(acceptStaffInvitation(token)).rejects.toThrow("error=invalid");
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it("consumes the invitation conditionally and preserves its branch role", async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["update", "eq", "gt", "select"]) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => ({ data: { id: "staff-id" }, error: null }));
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => chain) } as unknown as ReturnType<typeof createAdminClient>);
    await expect(acceptStaffInvitation(token)).rejects.toThrow("redirect:/m");
    expect(chain.eq).toHaveBeenCalledWith("status", "invited");
    expect(chain.eq).toHaveBeenCalledWith("invite_token", token);
    expect(chain.eq).toHaveBeenCalledWith("invited_email", user.email);
    expect(chain.gt).toHaveBeenCalledWith("invite_expires", expect.any(String));
    const update = chain.update.mock.calls[0][0];
    expect(update).toMatchObject({ profile_id: profile.id, status: "active", invite_token: null });
    expect(update).not.toHaveProperty("role");
    expect(syncStaffRole).toHaveBeenCalled();
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    vi.mocked(syncStaffRole).mockClear();
    await expect(acceptStaffInvitation(token)).rejects.toThrow("error=invalid");
    expect(syncStaffRole).not.toHaveBeenCalled();
  });
});
