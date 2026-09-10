"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/use-locale";
import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import { Network } from "@capacitor/network";
import { StatusBar, Style } from "@capacitor/status-bar";
import { nativeAuthCallback } from "@/lib/capacitor/links";
import {
  ensureNativeNotificationChannel,
  isNativeApp,
  nativePushEnabled,
  nativeFirebaseToken,
  notificationPayload,
  NATIVE_NOTIFICATION_EVENT,
  safeNativePath,
  syncNativeFirebaseDevice,
} from "@/lib/capacitor/native";

function announce(data: unknown, fallback?: { title?: string; body?: string }): void {
  const payload = notificationPayload(data);
  window.dispatchEvent(new CustomEvent(NATIVE_NOTIFICATION_EVENT, {
    detail: {
      type: "restolink:notification",
      title: payload.title ?? fallback?.title ?? "",
      body: payload.body ?? fallback?.body ?? "",
      tone: payload.tone ?? "info",
    },
  }));
}

/** Initializes native-only behavior without changing the browser/PWA path. */
export function NativeRuntime() {
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useLocale();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    void nativePushEnabled().then((enabled) => {
      if (enabled) void syncNativeFirebaseDevice(false);
    }).catch(() => undefined);
  }, [pathname]);

  useEffect(() => {
    if (!isNativeApp()) return;

    const platform = Capacitor.getPlatform();
    document.documentElement.dataset.nativePlatform = platform;
    const listeners: PluginListenerHandle[] = [];
    let cancelled = false;
    const navigate = (value: unknown) => {
      const path = safeNativePath(value);
      if (!cancelled && path && path !== window.location.pathname + window.location.search + window.location.hash) router.push(path);
    };
    const keep = async (registration: Promise<PluginListenerHandle>) => {
      const handle = await registration;
      if (cancelled) await handle.remove();
      else listeners.push(handle);
    };
    const openAppLink = (url: string) => {
      const callback = nativeAuthCallback(url);
      if (!callback) { navigate(url); return; }
      if (cancelled) return;
      // getLaunchUrl survives document redirects. Consume a one-time code only
      // once per WebView session, or the successful redirect would replay it.
      try {
        if (sessionStorage.getItem("resto237:handled-auth-link") === callback) return;
        sessionStorage.setItem("resto237:handled-auth-link", callback);
      } catch { return; }
      window.location.assign(callback);
    };

    const setNetworkState = (connected: boolean) => {
      if (cancelled) return;
      setOffline(!connected);
      document.documentElement.dataset.network = connected ? "online" : "offline";
      window.dispatchEvent(new CustomEvent("resto237:network", { detail: { connected } }));
    };

    const syncStatusBar = () => {
      const dark = document.documentElement.dataset.theme === "dark";
      // Capacitor names these styles for the foreground color: LIGHT gives
      // dark icons for a light background; DARK gives light icons.
      void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
      if (platform === "android") {
        void StatusBar.setBackgroundColor({ color: dark ? "#131410" : "#F7F4ED" }).catch(() => undefined);
      }
    };

    const observer = new MutationObserver(syncStatusBar);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    syncStatusBar();

    void (async () => {
      await ensureNativeNotificationChannel().catch(() => undefined);
      const status = await Network.getStatus();
      if (!cancelled) setNetworkState(status.connected);

      await keep(Network.addListener("networkStatusChange", ({ connected }) => setNetworkState(connected)));
      await keep(App.addListener("appUrlOpen", ({ url }) => openAppLink(url)));
      if (platform === "android") await keep(App.addListener("backButton", ({ canGoBack }) => {
          const dialog = document.querySelector('[role="dialog"], dialog[open]');
          if (dialog) {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          } else if (canGoBack) window.history.back();
          else void App.minimizeApp();
        }));
      await keep(App.addListener("resume", () => {
          window.dispatchEvent(new Event("resto237:resume"));
          void nativePushEnabled().then((enabled) => {
            if (enabled) void syncNativeFirebaseDevice(false);
          }).catch(() => undefined);
        }));
      await keep(App.addListener("appRestoredResult", (result) => {
          window.dispatchEvent(new CustomEvent("resto237:native-restored-result", { detail: result }));
        }));
      await keep(FirebaseMessaging.addListener("tokenReceived", ({ token }) => {
          // Token rotations are persisted through the same authenticated path.
          void nativeFirebaseToken().then((previous) => {
            if (token && token !== previous) void syncNativeFirebaseDevice(false);
          }).catch(() => undefined);
        }));
      await keep(FirebaseMessaging.addListener("notificationReceived", ({ notification }) => {
          announce(notification.data, notification);
        }));
      await keep(FirebaseMessaging.addListener("notificationActionPerformed", ({ notification }) => {
          const payload = notificationPayload(notification.data);
          navigate(payload.href ?? notification.link);
        }));

      const launch = await App.getLaunchUrl();
      if (launch?.url) openAppLink(launch.url);
      if (await nativePushEnabled()) void syncNativeFirebaseDevice(false);
    })().catch((error) => console.error("[capacitor] native runtime initialization failed", error));

    return () => {
      cancelled = true;
      observer.disconnect();
      delete document.documentElement.dataset.nativePlatform;
      delete document.documentElement.dataset.network;
      for (const listener of listeners) void listener.remove();
    };
  }, [router]);

  return offline ? (
    <div role="status" className="fixed inset-x-0 top-0 z-[100] bg-warning px-4 py-2 text-center text-sm text-white">
      {locale === "fr" ? "Connexion indisponible. Reconnectez-vous avant de passer une commande." : "You're offline. Reconnect before placing an order."}
    </div>
  ) : null;
}
