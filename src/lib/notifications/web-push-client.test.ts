import { describe, expect, it } from "vitest";
import { decodeVapidKey, subscriptionUsesVapidKey } from "./web-push-client";

describe("Web Push VAPID subscription repair", () => {
  it("decodes URL-safe base64 without padding", () => {
    expect(Array.from(decodeVapidKey("AQID-v8"))).toEqual([1, 2, 3, 250, 255]);
  });

  it("accepts a subscription created with the current key", () => {
    const key = new Uint8Array([1, 2, 3]);
    const subscription = { options: { applicationServerKey: key.buffer } } as PushSubscription;
    expect(subscriptionUsesVapidKey(subscription, key)).toBe(true);
  });

  it("rejects a stale or unknown application server key", () => {
    const key = new Uint8Array([1, 2, 3]);
    const stale = {
      options: { applicationServerKey: new Uint8Array([1, 2, 4]).buffer },
    } as PushSubscription;
    const unknown = { options: { applicationServerKey: null } } as PushSubscription;

    expect(subscriptionUsesVapidKey(stale, key)).toBe(false);
    expect(subscriptionUsesVapidKey(unknown, key)).toBe(false);
  });
});
