import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preferences: new Map<string, string>(),
  platform: vi.fn(() => "android"),
  state: vi.fn(), save: vi.fn(), remove: vi.fn(),
  permission: vi.fn(), request: vi.fn(), token: vi.fn(), deleteToken: vi.fn(),
  channel: vi.fn(), supported: vi.fn(),
}));
vi.mock("./platform", () => ({
  isNativeApp: () => mocks.platform() !== "web",
  nativePlatform: () => mocks.platform() === "web" ? null : mocks.platform(),
  useNativeApp: () => mocks.platform() !== "web",
}));
vi.mock("@/lib/data/notify-actions", () => ({ getPushSyncState: mocks.state }));
vi.mock("@/lib/data/firebase-actions", () => ({ saveFirebaseToken: mocks.save, removeFirebaseDevice: mocks.remove }));
vi.mock("@capacitor/app", () => ({ App: { getInfo: async () => ({ version: "1.0", build: "1" }) } }));
vi.mock("@capacitor/preferences", () => ({ Preferences: {
  get: async ({ key }: { key: string }) => ({ value: mocks.preferences.get(key) ?? null }),
  set: async ({ key, value }: { key: string; value: string }) => { mocks.preferences.set(key, value); },
  remove: async ({ key }: { key: string }) => { mocks.preferences.delete(key); },
} }));
vi.mock("@capacitor-firebase/messaging", () => ({
  Importance: { High: 4 }, Visibility: { Private: 0 },
  FirebaseMessaging: {
    checkPermissions: mocks.permission, requestPermissions: mocks.request,
    getToken: mocks.token, deleteToken: mocks.deleteToken,
    createChannel: mocks.channel, isSupported: mocks.supported,
  },
}));

import { disconnectNativeFirebaseDevice, nativePushEnabled, notificationPayload, syncNativeFirebaseDevice } from "./native";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preferences.clear();
  mocks.platform.mockReturnValue("android");
  mocks.state.mockResolvedValue({ signedIn: true, wantsPush: true });
  mocks.save.mockResolvedValue({ ok: true });
  mocks.remove.mockResolvedValue({ ok: true, remaining: 2 });
  mocks.permission.mockResolvedValue({ receive: "granted" });
  mocks.request.mockResolvedValue({ receive: "granted" });
  mocks.token.mockResolvedValue({ token: "native-token-1234567890" });
  mocks.supported.mockResolvedValue({ isSupported: true });
  mocks.channel.mockResolvedValue(undefined);
  mocks.deleteToken.mockResolvedValue(undefined);
  vi.stubGlobal("localStorage", { getItem: () => null });
});

describe("native push consent and persistence", () => {
  it("does not prompt or register on first launch", async () => {
    expect((await syncNativeFirebaseDevice()).ok).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
  });
  it("requires an authenticated account even for explicit enable", async () => {
    mocks.state.mockResolvedValue({ signedIn: false, wantsPush: true });
    expect((await syncNativeFirebaseDevice(true)).ok).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("requests permission only for explicit enable and stores native platform", async () => {
    mocks.permission.mockResolvedValue({ receive: "prompt" });
    expect((await syncNativeFirebaseDevice(true)).ok).toBe(true);
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledWith("native-token-1234567890", undefined, { platform: "android", appVersion: "1.0 (1)" });
    expect(await nativePushEnabled()).toBe(true);
  });
  it("keeps disabled state when server storage fails", async () => {
    mocks.save.mockResolvedValue({ ok: false, error: "schema missing" });
    expect(await syncNativeFirebaseDevice(true)).toEqual({ ok: false, reason: "storage", error: "schema missing" });
    expect(await nativePushEnabled()).toBe(false);
  });
  it("respects device opt-out without silently re-enabling", async () => {
    mocks.preferences.set("resto237:native-push-enabled", "true");
    vi.stubGlobal("localStorage", { getItem: () => "1" });
    expect((await syncNativeFirebaseDevice()).ok).toBe(false);
    expect(mocks.token).not.toHaveBeenCalled();
  });
  it("deduplicates concurrent registration", async () => {
    await Promise.all([syncNativeFirebaseDevice(true), syncNativeFirebaseDevice(true)]);
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it("disconnects only this device and reports other devices", async () => {
    await syncNativeFirebaseDevice(true);
    expect(await disconnectNativeFirebaseDevice()).toEqual({ remaining: 2 });
    expect(await nativePushEnabled()).toBe(false);
    expect(mocks.deleteToken).toHaveBeenCalledOnce();
  });
  it("does not claim disconnection when server removal fails", async () => {
    await syncNativeFirebaseDevice(true);
    mocks.remove.mockResolvedValue({ ok: false, error: "offline" });
    await expect(disconnectNativeFirebaseDevice()).rejects.toThrow("offline");
    expect(await nativePushEnabled()).toBe(true);
  });
  it("blocks background registration while disconnecting", async () => {
    let release!: (value: { ok: boolean; remaining: number }) => void;
    mocks.remove.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const disconnecting = disconnectNativeFirebaseDevice();
    await Promise.resolve();
    expect((await syncNativeFirebaseDevice(true)).ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
    release({ ok: true, remaining: 0 });
    await disconnecting;
  });
});

describe("native notification payloads", () => {
  it("reads the existing server's JSON data envelope", () => {
    expect(notificationPayload({ payload: JSON.stringify({ title: "Order", href: "/m/orders/1", tone: "success" }) }))
      .toMatchObject({ title: "Order", href: "/m/orders/1", tone: "success" });
  });
  it.each([null, [], { payload: "bad json" }, { payload: "[]" }])("rejects malformed payload %j", (value) => {
    expect(notificationPayload(value).title).toBeUndefined();
  });
  it("does not forward untyped fields into React", () => {
    expect(notificationPayload({ title: {}, body: [], href: 12, tone: "untrusted" }))
      .toEqual({ title: undefined, body: undefined, href: undefined, tone: "info" });
  });
});
