/**
 * Browser-side Web Push plumbing shared by the prompt, settings and the
 * automatic repair pass. Keeping this in one place is important: if those
 * three paths subscribe differently, the switch can say "on" while the
 * endpoint stored by the server is no longer usable.
 */

export interface SavedPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: string | null;
  userAgent: string;
  previousEndpoint?: string;
}

export function decodeVapidKey(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesEqual(left: ArrayBuffer | null, right: Uint8Array): boolean {
  if (!left) return false;
  const current = new Uint8Array(left);
  if (current.length !== right.length) return false;
  for (let i = 0; i < current.length; i += 1) {
    if (current[i] !== right[i]) return false;
  }
  return true;
}

/**
 * Is this subscription bound to the key we sign with?
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  "CANNOT TELL" MUST MEAN YES, NOT NO.
 *
 *  A mismatch here causes a re-subscribe, and a re-subscribe mints a new
 *  endpoint. So a comparison that answers "different" when it actually means
 *  "I could not read it" churns a fresh endpoint on EVERY repair pass — which
 *  is how one account came to hold six subscription rows, five of them for
 *  browsers that no longer existed, every one of them still accepted by the
 *  push service and delivering into the void.
 *
 *  `options` is absent on older implementations and
 *  `options.applicationServerKey` is null for a subscription created before
 *  the browser started reporting it. Neither is evidence of a rotated key.
 *  The genuine rotation case — the one this function exists for — has a key
 *  present and DIFFERENT, and that is the only case that returns false.
 *
 *  Being wrong in this direction is cheap: a truly stale endpoint is refused
 *  by the push service with 404/410 and pruned server-side. Being wrong in the
 *  other direction is a permanent churn nothing cleans up.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function subscriptionUsesVapidKey(
  subscription: Pick<PushSubscription, "options">,
  expected: Uint8Array,
): boolean {
  const options = subscription.options as PushSubscriptionOptions | undefined;

  /*
    NO `options` AT ALL is "I cannot tell", and must not be read as "different".

    This is the churn case. A false answer here causes a re-subscribe, and a
    re-subscribe mints a new endpoint — so a browser that does not expose
    `options` would mint one on EVERY repair pass. That is how one account came
    to hold six subscription rows, five of them for browsers that no longer
    existed, each still accepted by the push service and delivering nowhere.
  */
  if (!options) return true;

  /*
    A NULL key is a different thing entirely, and IS a mismatch. It means the
    subscription was created with no application server key at all — the legacy
    sender-id path — so it is not bound to our VAPID pair and should be
    replaced. That is a real, answerable question, not an unreadable one.
  */
  const current = options.applicationServerKey;
  if (!current) return false;

  return bytesEqual(current, expected);
}

export function configuredVapidKey(): Uint8Array | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key || key.includes("REPLACE_ME")) return null;
  try {
    return decodeVapidKey(key);
  } catch {
    return null;
  }
}

export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const phone = /iPhone|iPod/i.test(ua);
  const tablet = /iPad/i.test(ua) || (/Mac/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  return phone || tablet;
}

export function isStandaloneApp(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function iosInstallRequired(): boolean {
  return isIOSDevice() && !isStandaloneApp();
}

export async function registerPushWorker(): Promise<ServiceWorkerRegistration> {
  // `updateViaCache: "none"` is specifically useful on phones that keep the
  // installed PWA alive for days: the worker script itself must not be served
  // from an HTTP cache after a push fix is deployed.
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });

  // Registration already checks for an update, but an explicit check repairs
  // older registrations created before updateViaCache was set. It is safe to
  // let this finish in the background; subscribing does not depend on it.
  void registration.update().catch(() => {});

  /*
    ─────────────────────────────────────────────────────────────────────────
     WAIT FOR A WORKER THAT IS ACTUALLY ACTIVE.

     `register()` resolves as soon as the registration EXISTS — its worker may
     still be installing. `pushManager.subscribe()` on a registration with no
     active worker rejects, and the caller catches, and nothing subscribes.

     That is not a theoretical race: the reset control unregisters the worker
     and immediately registers a new one, so it hits the freshly-installing
     case every single time. The repair most likely to be reached for by
     someone whose push is broken was the one most likely to fail.

     `navigator.serviceWorker.ready` resolves once there is an ACTIVE
     registration for this scope, which is precisely the precondition
     `subscribe()` needs. The registration returned is the ready one.
    ─────────────────────────────────────────────────────────────────────────
  */
  if (!registration.active) {
    try {
      return await navigator.serviceWorker.ready;
    } catch {
      // `ready` never rejects in practice, but a browser that resolves it
      // late should not take the whole repair down: fall through and let
      // subscribe() report the real problem.
    }
  }

  return registration;
}

/**
 * Return a subscription bound to the CURRENT VAPID public key.
 *
 * A PushSubscription is restricted to the applicationServerKey used when it
 * was created. Reusing an endpoint after rotating the VAPID pair makes the
 * push service reject every message (usually 401/403), even though browser
 * permission remains granted. This comparison turns that permanent false-on
 * state into a one-time re-subscribe.
 */
export async function ensurePushSubscription(
  registration: ServiceWorkerRegistration,
  key: Uint8Array,
): Promise<{ subscription: PushSubscription; previousEndpoint?: string }> {
  const existing = await registration.pushManager.getSubscription();
  if (existing && subscriptionUsesVapidKey(existing, key)) {
    return { subscription: existing };
  }

  /*
    ─────────────────────────────────────────────────────────────────────────
     SUBSCRIBE FIRST, THEN DISCARD THE OLD ONE.

     This used to unsubscribe before subscribing, which is the wrong order in
     the one case that matters. `subscribe()` can fail — the push service is
     unreachable, the handset is offline, the worker has just been replaced —
     and the old subscription was already destroyed by then. The device came
     out of the attempt with NO subscription at all, permission still granted,
     the switch still reading "on", and no error anywhere. That is worse than
     the stale endpoint it was trying to replace, because a stale endpoint at
     least 410s and gets cleaned up.

     Chrome allows subscribing over an existing subscription with a different
     applicationServerKey — it replaces it and returns the new one. So the
     unsubscribe is not required for correctness, only for tidiness, and it
     now happens after there is something to fall back to.
    ─────────────────────────────────────────────────────────────────────────
  */
  const previousEndpoint = existing?.endpoint;

  let subscription: PushSubscription;
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key as unknown as BufferSource,
    });
  } catch (error) {
    // Keep whatever the device already had rather than leaving it with
    // nothing. A stale endpoint still gets a 410 and is cleaned up server-side;
    // no endpoint is invisible.
    if (existing) return { subscription: existing };
    throw error;
  }

  // Only now is the old one safe to release, and only if it is genuinely a
  // different endpoint — Chrome may hand back the same one.
  if (existing && existing.endpoint !== subscription.endpoint) {
    await existing.unsubscribe().catch(() => false);
  }

  return previousEndpoint && previousEndpoint !== subscription.endpoint
    ? { subscription, previousEndpoint }
    : { subscription };
}

function keyToBase64(key: ArrayBuffer | null): string {
  if (!key) return "";
  return btoa(String.fromCharCode(...new Uint8Array(key)));
}

export function serializePushSubscription(
  subscription: PushSubscription,
  previousEndpoint?: string,
): SavedPushSubscription {
  const json = subscription.toJSON();
  const keys = json.keys ?? {};

  return {
    endpoint: subscription.endpoint,
    // toJSON() uses the standard URL-safe representation. The fallback keeps
    // compatibility with older engines that expose getKey() but omit keys in
    // their JSON representation.
    p256dh: keys.p256dh ?? keyToBase64(subscription.getKey("p256dh")),
    auth: keys.auth ?? keyToBase64(subscription.getKey("auth")),
    expirationTime:
      subscription.expirationTime == null
        ? null
        : new Date(subscription.expirationTime).toISOString(),
    userAgent: navigator.userAgent.slice(0, 500),
    ...(previousEndpoint ? { previousEndpoint } : {}),
  };
}
