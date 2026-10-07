import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ required: vi.fn(), create: vi.fn(), signIn: vi.fn(), signup: vi.fn(), confirm: vi.fn(), profile: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error("redirect:" + path); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("./session", () => ({ getManagerRestaurantRejection: async () => null }));
vi.mock("./staff-access", () => ({ syncStaffRole: async (profile: { role: string }) => profile.role }));
vi.mock("./email-policy", () => ({ emailVerificationRequired: mocks.required }));
vi.mock("./optional-email", () => ({ confirmOptionalEmailAccount: mocks.confirm }));
vi.mock("./security", () => ({ consumeRecoveryGrant: vi.fn(), issueRecoveryGrant: vi.fn(), recordMailboxProof: vi.fn() }));
vi.mock("@/lib/data/firebase-actions", () => ({ removeFirebaseDevice: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/site-url", () => ({ siteUrl: async () => "https://resto237.online" }));
vi.mock("@/lib/i18n/locale-server", () => ({ getTranslator: async () => (key: string) => key }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ auth: { admin: { createUser: mocks.create } }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }) }),
  createClient: async () => ({ auth: { signInWithPassword: mocks.signIn, signUp: mocks.signup, signOut: vi.fn() } }),
}));
import { signIn, signUpCustomer } from "./actions";
const signupForm = () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: "Test Customer", email: "test@example.com", phone: "+237699112233", password: "StrongPassword123!", terms: "on", next: "/checkout", role: "admin" })) form.set(key, value);
  return form;
};
beforeEach(() => {
  vi.resetAllMocks(); mocks.required.mockResolvedValue(false);
  mocks.create.mockResolvedValue({ data: { user: { id: "new" } }, error: null });
  mocks.signIn.mockResolvedValue({ data: { user: { id: "new" }, session: { user: { id: "new" } } }, error: null });
  mocks.signup.mockResolvedValue({ data: { user: { id: "new" }, session: null }, error: null });
  mocks.profile.mockResolvedValue({ data: { id: "profile", role: "customer", status: "active", deleted_at: null }, error: null });
});
it("creates an optional-email customer immediately, forces the customer role, and preserves checkout", async () => {
  await expect(signUpCustomer({ ok: false }, signupForm())).rejects.toThrow("redirect:/checkout");
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: true, user_metadata: { name: "Test Customer", phone: "+237699112233", role: "customer" } }));
  expect(mocks.signup).not.toHaveBeenCalled();
});
it("uses normal confirmation signup when the administrator enables customer verification", async () => {
  mocks.required.mockResolvedValue(true);
  expect(await signUpCustomer({ ok: false }, signupForm())).toEqual({ ok: true, done: true, confirmEmail: true });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.signup).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: "https://resto237.online/auth/callback?next=%2Fcheckout" }) }));
});
it("does not overwrite an existing account's credentials during registration", async () => {
  mocks.create.mockResolvedValue({ data: { user: null }, error: { message: "Already registered" } });
  expect(await signUpCustomer({ ok: false }, signupForm())).toMatchObject({ ok: false });
  expect(mocks.signIn).not.toHaveBeenCalled();
});
it("uses the sign-in screen if account creation succeeds but automatic sign-in is unavailable", async () => {
  mocks.signIn.mockResolvedValue({ data: { session: null }, error: new Error("offline") });
  expect(await signUpCustomer({ ok: false }, signupForm())).toEqual({ ok: true, done: true, confirmEmail: false });
});
it("retries an existing unconfirmed customer's password sign-in only when its role policy permits it", async () => {
  mocks.signIn.mockResolvedValueOnce({ data: { user: null }, error: { code: "email_not_confirmed" } }); mocks.confirm.mockResolvedValue("confirmed");
  await expect(signIn({ ok: false }, signupForm())).rejects.toThrow("redirect:/checkout");
  expect(mocks.signIn).toHaveBeenCalledTimes(2);
});
it("keeps required confirmation and invalid passwords refused", async () => {
  mocks.signIn.mockResolvedValueOnce({ data: { user: null }, error: { code: "email_not_confirmed" } }); mocks.confirm.mockResolvedValue("required");
  expect(await signIn({ ok: false }, signupForm())).toEqual({ ok: false, reason: "unconfirmed" });
  expect(mocks.signIn).toHaveBeenCalledOnce();
  mocks.confirm.mockClear(); mocks.signIn.mockResolvedValueOnce({ data: { user: null }, error: { code: "invalid_credentials" } });
  expect(await signIn({ ok: false }, signupForm())).toEqual({ ok: false, reason: "invalid" });
  expect(mocks.confirm).not.toHaveBeenCalled();
});
