import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  platform: vi.fn(), saveNative: vi.fn(), saveWeb: vi.fn(), permission: vi.fn(), request: vi.fn(),
  token: vi.fn(), supported: vi.fn(), channel: vi.fn(), register: vi.fn(), subscribe: vi.fn(),
}));
vi.mock("@/lib/capacitor/platform", () => ({ nativePlatform: m.platform }));
vi.mock("@/lib/capacitor/native", () => ({ ensureNativeNotificationChannel: m.channel }));
vi.mock("@/lib/data/dining-actions", () => ({ saveGuestDiningNativePush: m.saveNative, saveGuestDiningPush: m.saveWeb }));
vi.mock("@capacitor-firebase/messaging", () => ({ FirebaseMessaging: {
  isSupported: m.supported, checkPermissions: m.permission, requestPermissions: m.request, getToken: m.token,
} }));
vi.mock("@/lib/notifications/web-push-client", () => ({
  configuredVapidKey: () => "vapid", registerPushWorker: m.register, ensurePushSubscription: m.subscribe,
  serializePushSubscription: () => ({ endpoint: "https://push.example/device", p256dh: "key", auth: "auth" }),
}));
import { syncGuestPush } from "./guest-push-client";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", { getItem: () => null });
  m.platform.mockReturnValue("android");
  m.supported.mockResolvedValue({ isSupported: true });
  m.permission.mockResolvedValue({ receive: "granted" });
  m.request.mockResolvedValue({ receive: "granted" });
  m.token.mockResolvedValue({ token: "guest-device-token" });
  m.saveNative.mockResolvedValue({ ok: true });
  m.saveWeb.mockResolvedValue({ ok: true });
  m.subscribe.mockResolvedValue({ subscription: {} });
});
afterEach(() => vi.unstubAllGlobals());
describe("table visit push", () => {
  it("registers an anonymous native visit without consulting account authentication", async () => {
    expect(await syncGuestPush("visit-secret", false)).toBe("enabled");
    expect(m.saveNative).toHaveBeenCalledWith("visit-secret", "guest-device-token", "android");
    expect(m.request).not.toHaveBeenCalled();
    expect(m.saveWeb).not.toHaveBeenCalled();
  });
  it("never opens a permission prompt during automatic repair", async () => {
    m.permission.mockResolvedValue({ receive: "prompt" });
    expect(await syncGuestPush("visit", false)).toBe("idle");
    expect(m.request).not.toHaveBeenCalled();
    expect(m.saveNative).not.toHaveBeenCalled();
  });
  it("requests native permission only after a guest tap", async () => {
    m.platform.mockReturnValue("ios");
    m.permission.mockResolvedValue({ receive: "prompt" });
    expect(await syncGuestPush("visit", true)).toBe("enabled");
    expect(m.request).toHaveBeenCalledOnce();
    expect(m.saveNative).toHaveBeenCalledWith("visit", "guest-device-token", "ios");
  });
  it("does not claim enabled when device persistence fails", async () => {
    m.saveNative.mockResolvedValue({ ok: false });
    expect(await syncGuestPush("visit", true)).toBe("unavailable");
  });
  it("reuses browser permission to associate the current visit", async () => {
    m.platform.mockReturnValue(null);
    vi.stubGlobal("window", { Notification: {}, PushManager: {} });
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", { serviceWorker: {} });
    expect(await syncGuestPush("browser-visit", false)).toBe("enabled");
    expect(m.saveWeb).toHaveBeenCalledWith("browser-visit", expect.objectContaining({ endpoint: "https://push.example/device" }));
    expect(m.saveNative).not.toHaveBeenCalled();
  });
  it("honours device opt-out during automatic repair", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "true" });
    expect(await syncGuestPush("visit", false)).toBe("idle");
    expect(m.token).not.toHaveBeenCalled();
  });
});
