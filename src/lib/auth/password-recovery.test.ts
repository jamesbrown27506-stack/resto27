import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn(), grant: vi.fn(), update: vi.fn(), globalLogout: vi.fn(), localLogout: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser, getSession: mocks.getSession, signOut: mocks.localLogout } }),
  createAdminClient: () => ({ auth: { admin: { updateUserById: mocks.update, signOut: mocks.globalLogout } } }),
}));
vi.mock("./security", () => ({ consumeRecoveryGrant: mocks.grant, issueRecoveryGrant: vi.fn(), recordMailboxProof: vi.fn() }));
vi.mock("@/lib/i18n/locale-server", () => ({ getTranslator: async () => (key: string) => key }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
import { updatePassword } from "./actions";
const accessToken = `header.${Buffer.from(JSON.stringify({ sub: "user", session_id: "session" })).toString("base64url")}.signature`;
beforeEach(() => {
  vi.clearAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: accessToken } } });
  mocks.update.mockResolvedValue({ error: null }); mocks.globalLogout.mockResolvedValue({ error: null });
});
function input() { const form = new FormData(); form.set("password", "StrongPassword123!"); form.set("confirm", "StrongPassword123!"); return form; }
it("refuses an ordinary authenticated session without recovery proof", async () => {
  mocks.grant.mockResolvedValue(false);
  expect(await updatePassword({ ok: false }, input())).toEqual({ ok: false, error: "expired" });
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.globalLogout).not.toHaveBeenCalled();
});
it("changes the password only after a grant bound to the verified user/session, then revokes sessions", async () => {
  mocks.grant.mockResolvedValueOnce(true).mockResolvedValue(false);
  expect(await updatePassword({ ok: false }, input())).toEqual({ ok: true, done: true });
  expect(mocks.grant).toHaveBeenCalledWith("user", "session");
  expect(mocks.update).toHaveBeenCalledWith("user", { password: "StrongPassword123!" });
  expect(mocks.globalLogout).toHaveBeenCalledWith(accessToken, "global"); expect(mocks.localLogout).toHaveBeenCalledOnce();
  expect(await updatePassword({ ok: false }, input())).toEqual({ ok: false, error: "expired" });
  expect(mocks.update).toHaveBeenCalledOnce();
});
it("refuses a token whose subject differs from the verified Auth user", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: "other" } } }); mocks.grant.mockResolvedValue(true);
  expect(await updatePassword({ ok: false }, input())).toEqual({ ok: false, error: "expired" });
  expect(mocks.grant).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
