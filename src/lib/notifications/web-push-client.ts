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

export function subscriptionUsesVapidKey(
  subscription: Pick<PushSubscription, "options">,
  expected: Uint8Array,
): boolean {
  return bytesEqual(subscription.options.applicationServerKey, expected);
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

  const previousEndpoint = existing?.endpoint;
  if (existing) await existing.unsubscribe().catch(() => false);

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key as unknown as BufferSource,
  });

  return previousEndpoint ? { subscription, previousEndpoint } : { subscription };
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
