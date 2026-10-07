import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ active: vi.fn(), user: vi.fn(), rate: vi.fn(), otp: vi.fn(), proof: vi.fn(), factors: vi.fn(), enroll: vi.fn(), unenroll: vi.fn(), verify: vi.fn(), assurance: vi.fn() }));
vi.mock("./session", () => ({ getActiveProfile: mocks.active, getSessionUser: mocks.user }));
vi.mock("./security", () => ({ recordMailboxProof: mocks.proof }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rate }));
vi.mock("@/lib/site-url", () => ({ siteUrl: async () => "https://resto237.online" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp: mocks.otp, mfa: { listFactors: mocks.factors, enroll: mocks.enroll, unenroll: mocks.unenroll, challengeAndVerify: mocks.verify, getAuthenticatorAssuranceLevel: mocks.assurance } } }) }));
import { disableOwnAuthenticator, enrollOwnAuthenticator, verifyOwnAuthenticator, verifyOwnEmailCode } from "./security-actions";

const user: User = { id: "own-auth", email: "owner@example.com", aud: "authenticated", user_metadata: {}, created_at: "2026-10-06T00:00:00Z", app_metadata: { security_email: "owner@example.com", security_email_verified_at: new Date().toISOString() } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.active.mockResolvedValue({ profile: { id: "own-profile", role: "customer" } });
  mocks.user.mockResolvedValue(user);
  mocks.rate.mockResolvedValue({ ok: true });
  mocks.otp.mockResolvedValue({ data: { user }, error: null });
  mocks.proof.mockResolvedValue(undefined);
  mocks.factors.mockResolvedValue({ data: { all: [] }, error: null });
  mocks.enroll.mockResolvedValue({ data: { id: "own-factor", totp: { qr_code: "data:image/svg+xml,test", secret: "test-secret" } }, error: null });
  mocks.unenroll.mockResolvedValue({ error: null });
  mocks.verify.mockResolvedValue({ error: null });
  mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
});
describe("email code submission", () => {
  it("normalizes a pasted code, verifies the signed-in email and saves mailbox proof", async () => {
    expect(await verifyOwnEmailCode(" 123 456 ")).toEqual({ ok: true });
    expect(mocks.otp).toHaveBeenCalledWith({ email: user.email, token: "123456", type: "email" });
    expect(mocks.proof).toHaveBeenCalledWith(user);
  });
  it("rejects malformed codes without asking Auth or spending a verification attempt", async () => {
    expect(await verifyOwnEmailCode("12")).toEqual({ ok: false, error: "code" });
    expect(mocks.otp).not.toHaveBeenCalled(); expect(mocks.rate).not.toHaveBeenCalled();
  });
  it("does not accept an OTP for a different account", async () => {
    mocks.otp.mockResolvedValue({ data: { user: { ...user, id: "other" } }, error: null });
    expect(await verifyOwnEmailCode("123456")).toEqual({ ok: false, error: "code" });
    expect(mocks.proof).not.toHaveBeenCalled();
  });
  it("reports invalid codes and persistence failures", async () => {
    mocks.otp.mockResolvedValueOnce({ data: { user: null }, error: new Error("expired") });
    expect(await verifyOwnEmailCode("123456")).toEqual({ ok: false, error: "code" });
    mocks.proof.mockRejectedValueOnce(new Error("offline"));
    expect(await verifyOwnEmailCode("123456")).toEqual({ ok: false, error: "unavailable" });
  });
  it("fails closed when rate limiting is unavailable", async () => {
    mocks.rate.mockResolvedValue({ ok: false });
    expect(await verifyOwnEmailCode("123456")).toEqual({ ok: false, error: "rate" });
    expect(mocks.otp).not.toHaveBeenCalled();
  });
});
describe("optional authenticator management", () => {
  it.each(["customer", "manager", "admin"])("allows %s to opt in", async role => {
    mocks.active.mockResolvedValue({ profile: { id: "own-profile", role } });
    expect(await enrollOwnAuthenticator()).toMatchObject({ ok: true, factorId: "own-factor" });
    expect(mocks.enroll).toHaveBeenCalledWith({ factorType: "totp", friendlyName: "Resto237" });
  });
  it("requires recent mailbox proof and cannot replace an enabled factor", async () => {
    mocks.user.mockResolvedValueOnce({ ...user, app_metadata: {} });
    expect(await enrollOwnAuthenticator()).toEqual({ ok: false, error: "recentEmail" });
    mocks.factors.mockResolvedValue({ data: { all: [{ id: "existing", status: "verified" }] }, error: null });
    expect(await enrollOwnAuthenticator()).toEqual({ ok: false, error: "alreadyEnrolled" });
    expect(mocks.enroll).not.toHaveBeenCalled(); expect(mocks.unenroll).not.toHaveBeenCalled();
  });
  it("challenges only a factor belonging to the signed-in account", async () => {
    mocks.factors.mockResolvedValue({ data: { all: [{ id: "own-factor", factor_type: "totp" }] }, error: null });
    expect(await verifyOwnAuthenticator("foreign", "123456")).toEqual({ ok: false, error: "identity" });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(await verifyOwnAuthenticator("own-factor", "123 456")).toEqual({ ok: true });
    expect(mocks.verify).toHaveBeenCalledWith({ factorId: "own-factor", code: "123456" });
  });
  it("cannot disable 2FA with a password-only session", async () => {
    mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
    expect(await disableOwnAuthenticator()).toEqual({ ok: false, error: "authenticatorRequired" });
    expect(mocks.unenroll).not.toHaveBeenCalled();
  });
  it("removes only the account's own TOTP factors after two-step verification", async () => {
    mocks.factors.mockResolvedValue({ data: { all: [{ id: "own-factor", factor_type: "totp", status: "verified" }] }, error: null });
    expect(await disableOwnAuthenticator()).toEqual({ ok: true });
    expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: "own-factor" });
  });
  it("reports provider failure instead of claiming 2FA was disabled", async () => {
    mocks.factors.mockResolvedValue({ data: { all: [{ id: "own-factor", factor_type: "totp" }] }, error: null });
    mocks.unenroll.mockResolvedValue({ error: new Error("offline") });
    expect(await disableOwnAuthenticator()).toEqual({ ok: false, error: "unavailable" });
  });
});
