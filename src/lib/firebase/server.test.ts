import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

const mocks = vi.hoisted(() => ({ read: vi.fn(), remove: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ from: () => ({
  select: () => ({ eq: mocks.read }),
  delete: () => ({ eq: () => ({ eq: mocks.remove }) }),
}) }) }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("FIREBASE_PROJECT_ID", "resto237-da372");
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "test@resto237-da372.iam.gserviceaccount.com");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  mocks.read.mockResolvedValue({ data: [{ id: "device", token: "example-device-token", web_endpoint: "https://push/device" }], error: null });
  mocks.remove.mockResolvedValue({ error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Firebase operational delivery", () => {
  it("sends one data payload with the full event and marks the current browser", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "bearer", expires_in: 3600 })))
      .mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const { sendFirebasePush } = await import("./server");
    const payload = { title: "Order", href: "/m/orders/1", actions: [{ action: "open", title: "View", href: "/m/orders/1" }] };
    const result = await sendFirebasePush("user", payload, "https://push/device");
    expect(result.devices[0]).toMatchObject({ status: "sent", isThisDevice: true });
    const sent = JSON.parse(fetch.mock.calls[1][1].body);
    expect(JSON.parse(sent.message.data.payload)).toEqual(payload);
    expect(sent.message.notification).toBeUndefined();
    expect(sent.message.webpush.headers.Urgency).toBe("high");
  });
  it.each([["UNREGISTERED", "expired", true], ["NOT_FOUND", "failed", false], ["INVALID_ARGUMENT", "failed", false]])(
    "handles %s without pruning valid registrations", async (code, status, removed) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "bearer" })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { details: [{ errorCode: code }] } }), { status: 404 })));
      const { sendFirebasePush } = await import("./server");
      expect((await sendFirebasePush("user", { title: "Test" })).devices[0].status).toBe(status);
      expect(mocks.remove).toHaveBeenCalledTimes(removed ? 1 : 0);
    });
  it("distinguishes unavailable storage from a user with no devices", async () => {
    mocks.read.mockResolvedValue({ data: null, error: { code: "PGRST205" } });
    const { sendFirebasePush } = await import("./server");
    expect(await sendFirebasePush("user", { title: "Test" })).toEqual({ devices: [], queryFailed: true });
  });
  it("reports OAuth failure instead of claiming delivery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    const { sendFirebasePush } = await import("./server");
    expect((await sendFirebasePush("user", { title: "Test" })).devices[0]).toMatchObject({ status: "failed", detail: "Firebase authentication failed" });
  });
});
