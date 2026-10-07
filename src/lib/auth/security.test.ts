import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, User } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), insert: vi.fn(), set: vi.fn(), get: vi.fn(), delete: vi.fn(), assurance: vi.fn(), update: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.set, get: mocks.get, delete: mocks.delete }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: () => ({ insert: mocks.insert }), rpc: mocks.rpc, auth: { admin: { updateUserById: mocks.update } } }),
  createClient: async () => ({ auth: { mfa: { getAuthenticatorAssuranceLevel: mocks.assurance } } }),
}));
import { hasFreshMailboxProof, hasVerifiedMailbox, sessionIdentity } from "./security-rules";
import { consumeRecoveryGrant, issueRecoveryGrant, requireAccountAssurance } from "./security";
const token = (claims: object) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
const user: User = { id: "user", email: "owner@example.com", user_metadata: {}, aud: "authenticated", created_at: "2026-10-06T00:00:00Z", app_metadata: { security_email: "owner@example.com", security_email_verified_at: new Date().toISOString() } };
beforeEach(() => { vi.clearAllMocks(); mocks.insert.mockResolvedValue({ error: null }); mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null }); });
describe("verified mailbox and MFA access", () => {
  it("does not trust auto-confirmed addresses or browser-editable metadata", () => {
    const autoConfirmed = { ...user, app_metadata: {}, email_confirmed_at: new Date().toISOString(), user_metadata: user.app_metadata };
    expect(hasVerifiedMailbox(autoConfirmed)).toBe(false);
    expect(hasVerifiedMailbox(user)).toBe(true);
    expect(hasVerifiedMailbox({ ...user, email: "replacement@example.com" })).toBe(false);
  });
  it("requires recent email proof for enrollment", () => {
    expect(hasFreshMailboxProof(user)).toBe(true);
    expect(hasFreshMailboxProof(user, Date.now() + 11 * 60_000)).toBe(false);
    expect(hasFreshMailboxProof(user, Date.now() - 60_000)).toBe(false);
  });
  it("requires mailbox ownership for privileged accounts, separately from optional 2FA", async () => {
    await expect(requireAccountAssurance({ ...user, app_metadata: {} }, true)).rejects.toThrow("step=email");
    await expect(requireAccountAssurance(user, true)).resolves.toBeUndefined();
    await expect(requireAccountAssurance({ ...user, app_metadata: {} }, false)).resolves.toBeUndefined();
    expect(mocks.assurance).not.toHaveBeenCalled();
  });
  it("allows ordinary sessions without enrollment, including abandoned setup", async () => {
    const unfinished = { ...user, factors: [{ id: "factor", status: "unverified", factor_type: "totp" }] } as User;
    await expect(requireAccountAssurance(unfinished, true)).resolves.toBeUndefined();
    await expect(requireAccountAssurance(unfinished, false)).resolves.toBeUndefined();
    expect(mocks.assurance).not.toHaveBeenCalled();
  });
  it.each([true, false])("protects opted-in accounts even when emailRequired=%s", async emailRequired => {
    const enrolled = { ...user, factors: [{ id: "factor", status: "verified", factor_type: "totp" }] } as User;
    mocks.assurance.mockResolvedValueOnce({ data: { currentLevel: "aal1" }, error: null });
    await expect(requireAccountAssurance(enrolled, emailRequired)).rejects.toThrow("step=mfa");
    mocks.assurance.mockResolvedValueOnce({ data: null, error: new Error("offline") });
    await expect(requireAccountAssurance(enrolled, emailRequired)).rejects.toThrow("step=mfa");
    await expect(requireAccountAssurance(enrolled, emailRequired)).resolves.toBeUndefined();
  });
});
describe("recovery proof", () => {
  it("recognizes recent provider OTP authentication, not ordinary or stale sessions", () => {
    const claims = { sub: "user", session_id: "session", amr: [{ method: "password", timestamp: Date.now() / 1000 }] };
    expect(sessionIdentity(token(claims))?.recentOtp).toBe(false);
    expect(sessionIdentity(token({ ...claims, amr: [{ method: "otp", timestamp: Date.now() / 1000 }] }))?.recentOtp).toBe(true);
    expect(sessionIdentity(token({ ...claims, amr: [{ method: "otp", timestamp: Date.now() / 1000 - 600 }] }))?.recentOtp).toBe(false);
    expect(sessionIdentity("invalid")).toBeNull();
  });
  it("persists only a digest and uses a short-lived HttpOnly cookie", async () => {
    const session = { user, access_token: token({ sub: user.id, session_id: "session" }) } as Session;
    await issueRecoveryGrant(session);
    const row = mocks.insert.mock.calls[0][0]; const cookie = mocks.set.mock.calls[0];
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.token_hash).not.toBe(cookie[1]);
    expect(row.auth_user_id).toBe(user.id); expect(row.session_id).toBe("session");
    expect(cookie[2]).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 600 });
  });
  it("fails closed without a durable grant and rejects a different session identity", async () => {
    mocks.insert.mockResolvedValueOnce({ error: new Error("offline") });
    await expect(issueRecoveryGrant({ user, access_token: token({ sub: user.id, session_id: "session" }) } as Session)).rejects.toThrow("unavailable");
    expect(mocks.set).not.toHaveBeenCalled();
    await expect(issueRecoveryGrant({ user, access_token: token({ sub: "someone-else", session_id: "session" }) } as Session)).rejects.toThrow("Invalid");
  });
  it("requires the opaque cookie and a successful atomic consumption", async () => {
    mocks.get.mockReturnValue(undefined);
    expect(await consumeRecoveryGrant("user", "session")).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.get.mockReturnValue({ value: "a".repeat(43) }); mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await consumeRecoveryGrant("user", "session")).toBe(false);
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null }); expect(await consumeRecoveryGrant("user", "session")).toBe(true);
    expect(mocks.rpc).toHaveBeenLastCalledWith("consume_recovery_grant", expect.objectContaining({ p_auth_user_id: "user", p_session_id: "session" }));
    mocks.rpc.mockResolvedValueOnce({ data: true, error: new Error("offline") }); expect(await consumeRecoveryGrant("user", "session")).toBe(false);
    expect(mocks.delete).toHaveBeenCalledWith("restolink-recovery");
  });
});
