import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));
import { canClaimInvitation, validInviteToken } from "./staff-invitations";
import { syncStaffRole } from "./staff-access";
import { createAdminClient } from "@/lib/supabase/server";
const invite = { status: "invited", invited_email: "staff@example.com", invite_expires: "2026-10-01T00:00:00Z" };
const now = Date.parse("2026-09-18T00:00:00Z");
describe("staff invitation identity and expiry", () => {
  it("allows only the invited email before expiry", () => {
    expect(canClaimInvitation(invite, "STAFF@example.com", now)).toBe(true);
    expect(canClaimInvitation(invite, "someone@example.com", now)).toBe(false);
  });
  it("rejects expired, consumed, suspended, and malformed invitations", () => {
    expect(canClaimInvitation(invite, "staff@example.com", Date.parse(invite.invite_expires))).toBe(false);
    for (const status of ["active", "suspended"]) expect(canClaimInvitation({ ...invite, status }, "staff@example.com", now)).toBe(false);
    expect(canClaimInvitation({ ...invite, invite_expires: null }, "staff@example.com", now)).toBe(false);
    expect(canClaimInvitation({ ...invite, invite_expires: "invalid" }, "staff@example.com", now)).toBe(false);
  });
  it("rejects prototype tokens and accepts real UUID tokens", () => {
    expect(validInviteToken("existing")).toBe(false);
    expect(validInviteToken("expired")).toBe(false);
    expect(validInviteToken("c5e3cde0-9a7e-46e4-bccf-28a518adbac1")).toBe(true);
  });
});
describe("staff platform role recovery", () => {
  const profile = { id: "profile-id", role: "customer", status: "active", deleted_at: null };
  function mockDb(membership: unknown[], error: unknown = null) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is", "update"]) chain[method] = vi.fn(() => chain);
    chain.limit = vi.fn(async () => ({ data: membership, error }));
    chain.maybeSingle = vi.fn(async () => ({ data: { role: "manager" }, error: null }));
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => chain) } as unknown as ReturnType<typeof createAdminClient>);
    return chain;
  }
  it("keeps diners as customers without active membership", async () => {
    const db = mockDb([]);
    expect(await syncStaffRole(profile)).toBe("customer");
    expect(db.update).not.toHaveBeenCalled();
    expect(db.eq).toHaveBeenCalledWith("status", "active");
  });
  it("restores restaurant access only from an active linked membership", async () => {
    const db = mockDb([{ id: "staff-id" }]);
    expect(await syncStaffRole(profile)).toBe("manager");
    expect(db.update).toHaveBeenCalledWith({ role: "manager" });
    expect(db.eq).toHaveBeenCalledWith("profile_id", profile.id);
    expect(db.eq).toHaveBeenCalledWith("role", "customer");
  });
  it("does not elevate suspended or deleted profiles or alter administrators", async () => {
    const db = mockDb([{ id: "staff-id" }]);
    expect(await syncStaffRole({ ...profile, status: "suspended" })).toBe("customer");
    expect(await syncStaffRole({ ...profile, deleted_at: "2026-09-18" })).toBe("customer");
    expect(await syncStaffRole({ ...profile, role: "admin" })).toBe("admin");
    expect(db.update).not.toHaveBeenCalled();
  });
  it("fails closed if membership cannot be verified", async () => {
    const db = mockDb([], { message: "unavailable" });
    await expect(syncStaffRole(profile)).rejects.toThrow("verify restaurant membership");
    expect(db.update).not.toHaveBeenCalled();
  });
});
