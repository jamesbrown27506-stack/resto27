import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const firebase = vi.hoisted(() => ({
  getMessaging: vi.fn(() => ({ app: "firebase" })),
  getToken: vi.fn(async () => "fcm-test-token"),
  isSupported: vi.fn(async () => true),
  getFirebaseApp: vi.fn(() => ({ name: "[DEFAULT]" })),
}));

vi.mock("firebase/messaging", () => firebase);
vi.mock("./client", () => ({ getFirebaseApp: firebase.getFirebaseApp }));

const originalVapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY = "firebase-web-push-key";
  firebase.isSupported.mockResolvedValue(true);
  firebase.getToken.mockResolvedValue("fcm-test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalVapidKey === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  else process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY = originalVapidKey;
});

describe("Firebase Cloud Messaging registration", () => {
  it("does not run during server rendering", async () => {
    const { requestFirebaseMessagingToken } = await import("./messaging");
    await expect(requestFirebaseMessagingToken()).resolves.toEqual({ ok: false, reason: "unsupported" });
  });

  it("uses an isolated service-worker scope and the Firebase VAPID key", async () => {
    const registration = { active: {} } as ServiceWorkerRegistration;
    const register = vi.fn(async () => registration);
    const permission = vi.fn(async () => "granted");
    vi.stubGlobal("window", { isSecureContext: true, Notification: { requestPermission: permission } });
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    vi.stubGlobal("Notification", { requestPermission: permission });
    const { requestFirebaseMessagingToken } = await import("./messaging");

    await expect(requestFirebaseMessagingToken()).resolves.toEqual({ ok: true, token: "fcm-test-token" });
    expect(register).toHaveBeenCalledWith("/firebase-messaging-sw.js", {
      scope: "/firebase-messaging/",
      updateViaCache: "none",
    });
    expect(firebase.getToken).toHaveBeenCalledWith(expect.anything(), {
      vapidKey: "firebase-web-push-key",
      serviceWorkerRegistration: registration,
    });
  });

  it("does not request permission until a Firebase VAPID key is configured", async () => {
    delete process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    const permission = vi.fn(async () => "granted");
    vi.stubGlobal("window", { isSecureContext: true, Notification: { requestPermission: permission } });
    vi.stubGlobal("navigator", { serviceWorker: {} });
    vi.stubGlobal("Notification", { requestPermission: permission });
    const { requestFirebaseMessagingToken } = await import("./messaging");

    await expect(requestFirebaseMessagingToken()).resolves.toEqual({ ok: false, reason: "missingVapid" });
    expect(permission).not.toHaveBeenCalled();
  });
});
