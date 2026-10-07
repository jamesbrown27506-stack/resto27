import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), upsert: vi.fn(), gate: vi.fn(), audit: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("./session", () => ({ superAdminOrError: mocks.gate }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.audit }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }), upsert: mocks.upsert }) }) }));
import { DEFAULT_EMAIL_POLICY, isEmailVerificationPolicy, parseEmailVerificationPolicy } from "./email-policy-rules";
import { emailVerificationRequired } from "./email-policy";
import { saveEmailVerificationPolicy } from "@/lib/data/security-policy-actions";
beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue({ data: null, error: null }); mocks.gate.mockResolvedValue({ ok: true, admin: { id: "super" } }); mocks.upsert.mockResolvedValue({ error: null }); });
describe("email verification rules", () => {
  it("defaults to administrators and restaurants, with customers optional", async () => {
    expect(parseEmailVerificationPolicy(null)).toEqual(DEFAULT_EMAIL_POLICY);
    expect(await emailVerificationRequired("admin")).toBe(true);
    expect(await emailVerificationRequired("manager")).toBe(true);
    expect(await emailVerificationRequired("customer")).toBe(false);
  });
  it("honors all three independently and reads changes on the next request", async () => {
    mocks.read.mockResolvedValue({ data: { value: JSON.stringify({ admin: false, manager: false, customer: true }) }, error: null });
    expect(await emailVerificationRequired("admin")).toBe(false);
    expect(await emailVerificationRequired("manager")).toBe(false);
    expect(await emailVerificationRequired("customer")).toBe(true);
  });
  it("requires real booleans for every role and fails closed on invalid config or database failure", async () => {
    expect(isEmailVerificationPolicy({ admin: "false", manager: true, customer: false })).toBe(false);
    expect(isEmailVerificationPolicy({ admin: true, manager: false })).toBe(false);
    expect(parseEmailVerificationPolicy("invalid")).toEqual({ admin: true, manager: true, customer: true });
    mocks.read.mockResolvedValue({ data: null, error: new Error("offline") });
    await expect(emailVerificationRequired("customer")).rejects.toThrow("unavailable");
  });
});
describe("security policy save authorization", () => {
  it("refuses a non-super-admin before writing", async () => {
    mocks.gate.mockResolvedValue({ ok: false, error: "Super admin only" });
    expect(await saveEmailVerificationPolicy(DEFAULT_EMAIL_POLICY)).toEqual({ ok: false, error: "Super admin only" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("rejects malformed input instead of silently disabling roles", async () => {
    expect(await saveEmailVerificationPolicy({ customer: false } as typeof DEFAULT_EMAIL_POLICY)).toMatchObject({ ok: false });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("saves all three choices atomically and audits/revalidates the change", async () => {
    expect(await saveEmailVerificationPolicy(DEFAULT_EMAIL_POLICY)).toEqual({ ok: true });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ key: "email_verification_roles", value: JSON.stringify(DEFAULT_EMAIL_POLICY), value_type: "json" }), { onConflict: "key" });
    expect(mocks.audit).toHaveBeenCalledWith({ id: "super" }, expect.objectContaining({ metadata: DEFAULT_EMAIL_POLICY }));
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });
  it("reports failed persistence without reporting or auditing success", async () => {
    mocks.upsert.mockResolvedValue({ error: new Error("offline") });
    expect(await saveEmailVerificationPolicy(DEFAULT_EMAIL_POLICY)).toMatchObject({ ok: false });
    expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
