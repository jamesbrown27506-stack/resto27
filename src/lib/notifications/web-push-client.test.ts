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

  it("does NOT treat an unreadable `options` as a mismatch", () => {
    /*
      The distinction this pins is the difference between a repair and a churn.

      A `null` applicationServerKey (above) is an answerable question: the
      subscription was created with no key, so it is not bound to our VAPID
      pair and must be replaced. A MISSING `options` is not an answer at all,
      and reading it as "different" re-subscribes on every repair pass — which
      mints a new endpoint every time, leaves the old rows behind, and is the
      measured cause of one account holding six subscriptions for browsers that
      no longer existed.

      Being wrong in this direction is cheap: a genuinely stale endpoint is
      refused 404/410 by the push service and pruned server-side. Being wrong
      the other way is a permanent churn nothing cleans up.
    */
    const key = new Uint8Array([1, 2, 3]);
    const unreadable = {} as PushSubscription;
    expect(subscriptionUsesVapidKey(unreadable, key)).toBe(true);
  });
});
