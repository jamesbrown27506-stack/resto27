import { getFirebaseApp } from "./client";

export type FirebaseMessagingResult =
  | { ok: true; token: string }
  | { ok: false; reason: "unsupported" | "insecure" | "missingVapid" | "denied" | "failed" };

export function firebaseMessagingVapidKey(): string | null {
  const key = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY?.trim();
  return key && !key.includes("REPLACE_ME") ? key : null;
}

export function firebaseMessagingConfigured(): boolean {
  return Boolean(firebaseMessagingVapidKey());
}

async function activeRegistration(registration: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
  if (registration.active) return registration;
  const worker = registration.installing ?? registration.waiting;
  if (!worker) throw new Error("Firebase worker is unavailable");
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); worker.removeEventListener("statechange", changed); };
    const changed = () => {
      if (worker.state === "activated") { cleanup(); resolve(); }
      else if (worker.state === "redundant") { cleanup(); reject(new Error("Firebase worker failed")); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Firebase worker activation timed out")); }, 15000);
    worker.addEventListener("statechange", changed);
    changed();
  });
  return registration;
}

/** Request from a user gesture and return the Firebase Console test token. */
export async function requestFirebaseMessagingToken(requestPermission = true): Promise<FirebaseMessagingResult> {
  if (typeof window === "undefined") return { ok: false, reason: "unsupported" };
  if (!window.isSecureContext) return { ok: false, reason: "insecure" };
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    return { ok: false, reason: "unsupported" };
  }
  const vapidKey = firebaseMessagingVapidKey();
  if (!vapidKey) return { ok: false, reason: "missingVapid" };

  try {
    const permission = Notification.permission === "granted" ? "granted" : requestPermission ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return { ok: false, reason: "denied" };
    const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
    if (!(await isSupported())) return { ok: false, reason: "unsupported" };
    const registration = await activeRegistration(
      await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
        scope: "/firebase-messaging/",
        updateViaCache: "none",
      }),
    );
    const token = await getToken(getMessaging(getFirebaseApp()), {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    return token ? { ok: true, token } : { ok: false, reason: "failed" };
  } catch (error) {
    console.warn("[firebase] Cloud Messaging registration failed", error);
    return { ok: false, reason: "failed" };
  }
}
