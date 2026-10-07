import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ profile: vi.fn(), required: vi.fn(), account: vi.fn(), update: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./email-policy", () => ({ emailVerificationRequired: mocks.required }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }), auth: { admin: { getUserById: mocks.account, updateUserById: mocks.update } } }) }));
import { confirmOptionalEmailAccount } from "./optional-email";
beforeEach(() => {
  vi.resetAllMocks(); mocks.profile.mockResolvedValue({ data: { auth_user_id: "auth", role: "customer", status: "active", deleted_at: null }, error: null });
  mocks.required.mockResolvedValue(false); mocks.account.mockResolvedValue({ data: { user: { email: "test@example.com" } }, error: null }); mocks.update.mockResolvedValue({ error: null });
});
it("lets an existing optional-email account sign in without creating mailbox ownership proof", async () => {
  expect(await confirmOptionalEmailAccount("TEST@example.com")).toBe("confirmed");
  expect(mocks.update).toHaveBeenCalledWith("auth", { email_confirm: true });
});
it.each(["customer", "manager", "admin"])("never exempts a %s when its verification switch is on", async role => {
  mocks.profile.mockResolvedValue({ data: { auth_user_id: "auth", role, status: "active" }, error: null }); mocks.required.mockResolvedValue(true);
  expect(await confirmOptionalEmailAccount("test@example.com")).toBe("required"); expect(mocks.update).not.toHaveBeenCalled();
});
it("refuses stale profile emails that no longer match Auth", async () => {
  mocks.account.mockResolvedValue({ data: { user: { email: "other@example.com" } }, error: null });
  expect(await confirmOptionalEmailAccount("test@example.com")).toBe("required"); expect(mocks.update).not.toHaveBeenCalled();
});
it("does not confirm suspended or deleted accounts", async () => {
  mocks.profile.mockResolvedValueOnce({ data: { role: "customer", status: "suspended" }, error: null });
  expect(await confirmOptionalEmailAccount("test@example.com")).toBe("required");
  mocks.profile.mockResolvedValueOnce({ data: { role: "customer", status: "active", deleted_at: "2026-10-06" }, error: null });
  expect(await confirmOptionalEmailAccount("test@example.com")).toBe("required"); expect(mocks.update).not.toHaveBeenCalled();
});
it("fails closed if the policy or account update is unavailable", async () => {
  mocks.required.mockRejectedValueOnce(new Error("offline"));
  expect(await confirmOptionalEmailAccount("test@example.com")).toBe("unavailable");
  mocks.update.mockResolvedValueOnce({ error: new Error("offline") });
  expect(await confirmOptionalEmailAccount("test@example.com")).toBe("unavailable");
});
