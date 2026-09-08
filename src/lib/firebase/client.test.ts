import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  getApps: vi.fn(() => [] as { name: string }[]),
  getApp: vi.fn(() => ({ name: "[DEFAULT]" })),
  initializeApp: vi.fn(() => ({ name: "[DEFAULT]" })),
  isSupported: vi.fn(async () => true),
  getAnalytics: vi.fn(() => ({ app: "test" })),
}));
vi.mock("firebase/app", () => sdk);
vi.mock("firebase/analytics", () => sdk);

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); sdk.isSupported.mockResolvedValue(true); sdk.getApps.mockReturnValue([]); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Firebase initialization", () => {
  it("does not initialize Analytics during server rendering", async () => {
    const { initializeFirebaseAnalytics } = await import("./client");
    expect(await initializeFirebaseAnalytics()).toBeNull();
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    expect(sdk.isSupported).not.toHaveBeenCalled();
  });
  it("shares initialization across concurrent browser mounts", async () => {
    vi.stubGlobal("window", {});
    const { initializeFirebaseAnalytics } = await import("./client");
    await Promise.all([initializeFirebaseAnalytics(), initializeFirebaseAnalytics()]);
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.getAnalytics).toHaveBeenCalledTimes(1);
  });
  it("skips Analytics in unsupported browsers", async () => {
    vi.stubGlobal("window", {});
    sdk.isSupported.mockResolvedValue(false);
    const { initializeFirebaseAnalytics } = await import("./client");
    expect(await initializeFirebaseAnalytics()).toBeNull();
    expect(sdk.getAnalytics).not.toHaveBeenCalled();
  });
  it("reuses the default app", async () => {
    sdk.getApps.mockReturnValue([{ name: "[DEFAULT]" }]);
    const { getFirebaseApp } = await import("./client");
    getFirebaseApp();
    expect(sdk.getApp).toHaveBeenCalledOnce();
    expect(sdk.initializeApp).not.toHaveBeenCalled();
  });
  it("contains browser failures and allows a later retry", async () => {
    vi.stubGlobal("window", {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sdk.isSupported.mockRejectedValueOnce(new Error("Storage blocked"));
    const { initializeFirebaseAnalytics } = await import("./client");
    expect(await initializeFirebaseAnalytics()).toBeNull();
    expect(await initializeFirebaseAnalytics()).not.toBeNull();
  });
});
