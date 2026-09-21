"use client";

import { nativePlatform } from "@/lib/capacitor/platform";
import { saveGuestDiningNativePush, saveGuestDiningPush } from "@/lib/data/dining-actions";
import { configuredVapidKey, ensurePushSubscription, registerPushWorker, serializePushSubscription } from "@/lib/notifications/web-push-client";

export type GuestPushResult = "enabled" | "idle" | "unavailable";

/** Automatic repair never opens a permission prompt; only an explicit tap may. */
export async function syncGuestPush(raw: string, requestPermission: boolean): Promise<GuestPushResult> {
  try {
    if (!requestPermission && localStorage.getItem("restolink:pushDeviceOptOut") !== null) return "idle";
    const platform = nativePlatform();
    if (platform) {
      const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
      if (!(await FirebaseMessaging.isSupported()).isSupported) return "unavailable";
      let permission = await FirebaseMessaging.checkPermissions();
      if (permission.receive !== "granted" && requestPermission) permission = await FirebaseMessaging.requestPermissions();
      if (permission.receive !== "granted") return requestPermission ? "unavailable" : "idle";
      const { ensureNativeNotificationChannel } = await import("@/lib/capacitor/native");
      await ensureNativeNotificationChannel();
      const { token } = await FirebaseMessaging.getToken();
      if (!token) return "unavailable";
      const saved = await saveGuestDiningNativePush(raw, token, platform);
      return saved.ok ? "enabled" : "unavailable";
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unavailable";
    let permission = Notification.permission;
    if (permission === "default" && requestPermission) permission = await Notification.requestPermission();
    if (permission !== "granted") return requestPermission ? "unavailable" : "idle";
    const key = configuredVapidKey();
    if (!key) return "unavailable";
    const registration = await registerPushWorker();
    const { subscription, previousEndpoint } = await ensurePushSubscription(registration, key);
    const saved = await saveGuestDiningPush(raw, serializePushSubscription(subscription, previousEndpoint));
    return saved.ok ? "enabled" : "unavailable";
  } catch { return "unavailable"; }
}
