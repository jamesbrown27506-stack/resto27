import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ provider: vi.fn(), enabled: vi.fn(), firebase: vi.fn(), configured: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/notification-provider", () => ({ notificationProvider: mocks.provider }));
vi.mock("@/lib/firebase/server", () => ({ sendFirebasePush: mocks.firebase, firebaseDeliveryConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.enabled }) }) }) }) }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.provider.mockResolvedValue("firebase");
  mocks.enabled.mockResolvedValue({ data: { value: "true" }, error: null });
  mocks.configured.mockReturnValue(true);
  mocks.firebase.mockResolvedValue({ devices: [{ status: "sent" }] });
  vi.stubEnv("VAPID_PUBLIC_KEY", "");
  vi.stubEnv("VAPID_PRIVATE_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("shared push provider routing", () => {
  it("delivers to native devices when browsers use Web Push", async () => {
    mocks.provider.mockResolvedValue("web_push");
    const { sendPushWithReport } = await import("./push");
    const report = await sendPushWithReport("user", { title: "Order" });
    expect(mocks.firebase).toHaveBeenCalledWith("user", { title: "Order" }, undefined, true);
    expect(report.devices).toEqual([{ status: "sent" }]);
  });
  it("routes reporting and ordinary notifications through Firebase", async () => {
    const { sendPush, sendPushWithReport } = await import("./push");
    await sendPush("customer", { title: "Order" });
    expect((await sendPushWithReport("manager", { title: "Booking" })).devices).toEqual([{ status: "sent" }]);
    expect(mocks.firebase).toHaveBeenCalledTimes(2);
  });
  it("respects the platform master switch for Firebase", async () => {
    mocks.enabled.mockResolvedValue({ data: { value: "false" }, error: null });
    const { sendPushWithReport } = await import("./push");
    expect(await sendPushWithReport("user", { title: "Test" })).toMatchObject({ platformEnabled: false, devices: [] });
    expect(mocks.firebase).not.toHaveBeenCalled();
  });
  it("does not silently fall back when Firebase credentials are missing", async () => {
    mocks.configured.mockReturnValue(false);
    const { sendPushWithReport } = await import("./push");
    expect(await sendPushWithReport("user", { title: "Test" })).toMatchObject({ configured: false, devices: [] });
    expect(mocks.firebase).not.toHaveBeenCalled();
  });
  it("lets an admin comparison select Web Push without changing the stored provider", async () => {
    const { sendPushWithReport } = await import("./push");
    await sendPushWithReport("admin", { title: "Test" }, undefined, "web_push");
    expect(mocks.firebase).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
