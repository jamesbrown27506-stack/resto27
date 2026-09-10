"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { BannerCard } from "@/components/notifications/pwa-prompts";
import { useLocale } from "@/lib/i18n/use-locale";
import { announcePushEnabled, getPushSyncState } from "@/lib/data/notify-actions";
import { isNativeApp, nativePushEnabled, syncNativeFirebaseDevice } from "@/lib/capacitor/native";
import { nativePushOffer, type NativePushOffer } from "@/lib/capacitor/push-prompt";

const DISMISS_KEY = "resto237:nativePushPromptDismissedAt";
/** Written by the notification settings when this device is switched off. */
const DEVICE_OPT_OUT_KEY = "restolink:pushDeviceOptOut";

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function currentOffer(): Promise<NativePushOffer> {
  const [enabled, permission] = await Promise.all([nativePushEnabled(), FirebaseMessaging.checkPermissions()]);
  const dismissed = Number(readLocal(DISMISS_KEY));
  const local = {
    enabled,
    permission: permission.receive,
    optedOut: readLocal(DEVICE_OPT_OUT_KEY) !== null,
    dismissedAt: Number.isFinite(dismissed) && dismissed > 0 ? dismissed : null,
    now: Date.now(),
  };
  // Nothing to offer whoever is signed in: skip the server round trip, which
  // is what keeps this cheap on every navigation of a registered phone.
  if (!nativePushOffer({ ...local, signedIn: true, wantsPush: true })) return null;
  return nativePushOffer({ ...local, ...(await getPushSyncState()) });
}

/**
 * The installed app's notification offer — see lib/capacitor/push-prompt for
 * who gets it and when.
 *
 * The website's banner (PwaPrompts) stands down inside the app, so without
 * this the only way to turn push on was the settings screen. Re-checked on
 * every navigation, because signing in is a navigation: the offer lands on
 * the first page after login instead of waiting for the app's next launch.
 * Allowing goes through the same registration as the settings switch, then
 * sends a real confirmation notification.
 */
export function NativePushPrompt({ brandName }: { brandName: string }) {
  const pathname = usePathname();
  const { t } = useLocale();
  const { toast } = useToast();
  const [offer, setOffer] = useState<NativePushOffer>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    // A beat after the page, so the offer arrives on it rather than over the
    // redirect that follows a login.
    const timer = setTimeout(() => {
      currentOffer()
        .then((next) => { if (!cancelled) setOffer(next); })
        .catch((error) => console.error("[capacitor] push offer check failed", error));
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pathname]);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Storage unavailable — the offer simply returns on the next page.
    }
    setOffer(null);
  }

  async function enable() {
    setBusy(true);
    try {
      const result = await syncNativeFirebaseDevice(true);
      if (!result.ok) {
        // "denied" is a No in Android's own dialog: respect it for the hour.
        toast(t(result.reason === "denied" ? "nset.push.dismissed" : "nset.push.failed"), "warning");
        dismiss();
        return;
      }
      try {
        localStorage.removeItem(DEVICE_OPT_OUT_KEY);
      } catch {
        // Storage unavailable — nothing to lift.
      }
      setOffer(null);
      const announced = await announcePushEnabled().catch(() => ({ ok: false as const }));
      toast(t(announced.ok ? "nset.push.enabled" : "nset.push.enabledNoSend"), "success");
    } finally {
      setBusy(false);
    }
  }

  if (!offer) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center p-3 sm:p-4 lg:bottom-0">
      <BannerCard
        icon={<BellRing className="size-4.5" aria-hidden />}
        title={t("pwa.notif.title")}
        onClose={dismiss}
        closeLabel={t("pwa.dismiss")}
      >
        <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
          <span>{offer === "blocked" ? t("pwa.native.blocked", { name: brandName }) : t("pwa.native.body")}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {offer === "ask" && (
            <Button size="sm" loading={busy} disabled={busy} onClick={enable}>
              <span>{t("pwa.notif.action")}</span>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={dismiss}>
            <span>{t("pwa.later")}</span>
          </Button>
        </div>
      </BannerCard>
    </div>
  );
}
