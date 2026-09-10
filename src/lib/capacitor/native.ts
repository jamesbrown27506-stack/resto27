"use client";

import { App } from "@capacitor/app";
import { FirebaseMessaging, Importance, Visibility } from "@capacitor-firebase/messaging";
import { Preferences } from "@capacitor/preferences";
import { isNativeApp, nativePlatform } from "./platform";
export { isNativeApp, nativePlatform, useNativeApp } from "./platform";
import { removeFirebaseDevice, saveFirebaseToken } from "@/lib/data/firebase-actions";
import { getPushSyncState } from "@/lib/data/notify-actions";
export { safeNativePath } from "./links";
import type { FirebaseMessagingResult } from "@/lib/firebase/messaging";

const TOKEN_KEY = "resto237:native-fcm-token";
const ENABLED_KEY = "resto237:native-push-enabled";

export const NATIVE_NOTIFICATION_EVENT = "resto237:native-notification";

export async function nativeFirebaseToken(): Promise<string | null> {
  if (!isNativeApp()) return null;
  return (await Preferences.get({ key: TOKEN_KEY })).value;
}

export async function nativePushEnabled(): Promise<boolean> {
  if (!isNativeApp()) return false;
  return (await Preferences.get({ key: ENABLED_KEY })).value === "true";
}

export async function ensureNativeNotificationChannel(): Promise<void> {
  if (nativePlatform() !== "android") return;
  await FirebaseMessaging.createChannel({
    id: "resto237_operational",
    name: "Orders and reservations",
    description: "Time-sensitive order, reservation, chat, and account updates",
    importance: Importance.High,
    visibility: Visibility.Private,
    lights: true,
    lightColor: "#5F7257",
    vibration: true,
  });
}

type SyncResult = FirebaseMessagingResult | { ok: false; reason: "storage"; error?: string };
let syncInFlight: Promise<SyncResult> | null = null;
let disconnectInFlight: Promise<{ remaining: number }> | null = null;

export function syncNativeFirebaseDevice(requestPermission = false): Promise<SyncResult> {
  if (disconnectInFlight) return Promise.resolve({ ok: false, reason: "denied" });
  if (syncInFlight) return syncInFlight;
  syncInFlight = registerNativeDevice(requestPermission).finally(() => { syncInFlight = null; });
  return syncInFlight;
}

async function registerNativeDevice(
  requestPermission = false,
): Promise<SyncResult> {
  const platform = nativePlatform();
  if (!platform) return { ok: false, reason: "unsupported" };

  try {
    const state = await getPushSyncState();
    if (!state.signedIn || (!requestPermission && (!state.wantsPush || !await nativePushEnabled()))) {
      return { ok: false, reason: "denied" };
    }
    if (!requestPermission && localStorage.getItem("restolink:pushDeviceOptOut") !== null) {
      return { ok: false, reason: "denied" };
    }
    const support = await FirebaseMessaging.isSupported();
    if (!support.isSupported) return { ok: false, reason: "unsupported" };

    let permission = await FirebaseMessaging.checkPermissions();
    if (permission.receive !== "granted" && requestPermission) {
      permission = await FirebaseMessaging.requestPermissions();
    }
    if (permission.receive !== "granted") return { ok: false, reason: "denied" };

    await ensureNativeNotificationChannel();
    const { token } = await FirebaseMessaging.getToken();
    if (!token) return { ok: false, reason: "failed" };

    const info = await App.getInfo().catch(() => null);
    const saved = await saveFirebaseToken(token, undefined, {
      platform,
      appVersion: info ? `${info.version} (${info.build})` : undefined,
    });
    if (!saved.ok) return { ok: false, reason: "storage", error: saved.error };

    await Promise.all([
      Preferences.set({ key: TOKEN_KEY, value: token }),
      Preferences.set({ key: ENABLED_KEY, value: "true" }),
    ]);
    return { ok: true, token };
  } catch (error) {
    console.error("[capacitor] native push registration failed", error);
    return { ok: false, reason: "failed" };
  }
}

export function disconnectNativeFirebaseDevice(): Promise<{ remaining: number }> {
  if (disconnectInFlight) return disconnectInFlight;
  disconnectInFlight = disconnectDevice().finally(() => { disconnectInFlight = null; });
  return disconnectInFlight;
}

async function disconnectDevice(): Promise<{ remaining: number }> {
  // A resume-triggered registration must finish before deleting its row.
  await syncInFlight;
  const removed = await removeFirebaseDevice();
  if (!removed.ok) throw new Error(removed.error);
  await FirebaseMessaging.deleteToken().catch(() => undefined);
  await Promise.all([
    Preferences.remove({ key: TOKEN_KEY }),
    Preferences.remove({ key: ENABLED_KEY }),
  ]);
  return { remaining: removed.remaining ?? 0 };
}

export function notificationPayload(data: unknown): {
  title?: string;
  body?: string;
  href?: string;
  tone?: string;
} {
  if (!data || typeof data !== "object") return {};
  let record = data as Record<string, unknown>;
  const value = record.payload;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      record = parsed;
    } catch {
      return {};
    }
  }
  return {
    title: typeof record.title === "string" ? record.title : undefined,
    body: typeof record.body === "string" ? record.body : undefined,
    href: typeof record.href === "string" ? record.href : undefined,
    tone: typeof record.tone === "string" && ["info", "success", "warning", "error"].includes(record.tone) ? record.tone : "info",
  };
}
