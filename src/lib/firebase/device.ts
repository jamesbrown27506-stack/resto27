import { requestFirebaseMessagingToken } from "./messaging";
import { saveFirebaseToken, removeFirebaseDevice } from "@/lib/data/firebase-actions";
import { getFirebaseApp } from "./client";
import {
  disconnectNativeFirebaseDevice,
  isNativeApp,
  syncNativeFirebaseDevice,
} from "@/lib/capacitor/native";

export async function syncFirebaseDevice(requestPermission = false) {
  if (!requestPermission && localStorage.getItem("restolink:pushDeviceOptOut") !== null) return { ok: false as const, reason: "denied" as const };
  if (isNativeApp()) return syncNativeFirebaseDevice(requestPermission);
  const result = await requestFirebaseMessagingToken(requestPermission);
  if (!result.ok) return result;
  const root = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await root?.pushManager.getSubscription();
  const saved = await saveFirebaseToken(result.token, subscription?.endpoint);
  if (!saved.ok) return { ok: false as const, reason: "storage" as const, error: saved.error };
  return result;
}

export async function disconnectFirebaseDevice() {
  if (isNativeApp()) return disconnectNativeFirebaseDevice();
  const removed = await removeFirebaseDevice();
  if (!removed.ok) throw new Error(removed.error);
  if (!await navigator.serviceWorker.getRegistration("/firebase-messaging/")) return { remaining: removed.remaining ?? 0 };
  const { deleteToken, getMessaging, isSupported } = await import("firebase/messaging");
  if (await isSupported()) await deleteToken(getMessaging(getFirebaseApp()));
  return { remaining: removed.remaining ?? 0 };
}
