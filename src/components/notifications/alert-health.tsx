"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BellOff, VolumeX, WifiOff, X } from "lucide-react";
import { useNotifications } from "./notification-provider";
import { pushDeviceOptedOut } from "./notification-settings";
import { isNativeApp, nativePushEnabled } from "@/lib/capacitor/native";
import { iosInstallRequired } from "@/lib/notifications/web-push-client";
import { useLocale } from "@/lib/i18n/use-locale";

/** A reconnect normally takes 2–10 s; only a channel down longer is news. */
const REALTIME_GRACE_MS = 20_000;
/** Someone who deliberately switched push off is reminded weekly, not nagged. */
const PUSH_DISMISS_MS = 7 * 24 * 60 * 60_000;
const PUSH_DISMISS_KEY = "resto237:pushBannerDismissedAt";

/**
 * "Will I actually hear the next order?" — answered on screen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THREE SILENT FAILURES, MADE VISIBLE.
 *
 *  Each of these looked, from the counter, exactly like a quiet evening:
 *
 *    · SOUND BLOCKED — browsers refuse audio in a tab nobody has touched.
 *      A tablet reloaded at opening time and left on the stand stays mute
 *      until someone taps it. One tap fixes it (the provider unlocks the
 *      audio on the first pointerdown), so the banner just asks for one.
 *    · PUSH OFF ON THIS DEVICE — no permission, no subscription, or switched
 *      off here. The app then cannot reach this phone once it is closed.
 *    · REALTIME DOWN — the live channel to the notifications table is
 *      disconnected (the same state /a/diagnostics shows). Orders still
 *      arrive through the badge poll, just later.
 *
 *  Everything here is read from the browser or from the provider's existing
 *  state — no server call, nothing polled.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function AlertHealth() {
  const { t } = useLocale();
  const { soundReady, realtime } = useNotifications();

  const [pushOff, setPushOff] = useState(false);
  const [realtimeDown, setRealtimeDown] = useState(false);

  // Push state, re-read when the app comes back to the front (the person may
  // have just changed it in the system settings).
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      let off = false;
      try {
        const dismissed = Number(localStorage.getItem(PUSH_DISMISS_KEY) ?? 0);
        if (dismissed && Date.now() - dismissed < PUSH_DISMISS_MS) {
          if (!cancelled) setPushOff(false);
          return;
        }
      } catch {
        // Storage unavailable: show the banner, which is the safe side.
      }

      try {
        if (isNativeApp()) {
          off = !(await nativePushEnabled());
        } else if (
          !("serviceWorker" in navigator) ||
          !("PushManager" in window) ||
          !("Notification" in window) ||
          iosInstallRequired()
        ) {
          off = true;
        } else if (Notification.permission !== "granted" || pushDeviceOptedOut()) {
          off = true;
        } else {
          const registration = await navigator.serviceWorker.getRegistration();
          const subscription = await registration?.pushManager.getSubscription();
          off = !subscription;
        }
      } catch {
        off = false; // Unknown is not "off" — never cry wolf.
      }
      if (!cancelled) setPushOff(off);
    };

    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Realtime: only after the grace period, so a normal reconnect never flashes.
  useEffect(() => {
    if (realtime !== "error") {
      const timer = window.setTimeout(() => setRealtimeDown(false), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setRealtimeDown(true), REALTIME_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [realtime]);

  function dismissPush() {
    try {
      localStorage.setItem(PUSH_DISMISS_KEY, String(Date.now()));
    } catch {
      // Nothing to remember it in; hiding it for this visit is still right.
    }
    setPushOff(false);
  }

  if (soundReady && !pushOff && !realtimeDown) return null;

  const row =
    "no-print flex items-center gap-2 border-b border-warning/30 bg-warning-light px-4 py-2 text-xs font-semibold text-warning sm:text-sm";

  return (
    <div role="status">
      {!soundReady && (
        // A real button: the tap that lands on it is the tap that unlocks the
        // audio (the provider listens for any pointerdown on the window).
        <button type="button" className={`${row} w-full text-left`}>
          <VolumeX className="size-4 shrink-0" aria-hidden />
          <span>{t("mops.health.sound")}</span>
        </button>
      )}
      {pushOff && (
        <div className={row}>
          <BellOff className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{t("mops.health.push")}</span>
          <Link href="/m/notifications" className="shrink-0 underline underline-offset-2">
            {t("mops.health.pushFix")}
          </Link>
          <button
            type="button"
            onClick={dismissPush}
            aria-label={t("mops.health.dismiss")}
            className="grid size-7 shrink-0 place-items-center rounded-full hover:bg-warning/15"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      {realtimeDown && (
        <div className={row}>
          <WifiOff className="size-4 shrink-0" aria-hidden />
          <span>{t("mops.health.realtime")}</span>
        </div>
      )}
    </div>
  );
}
