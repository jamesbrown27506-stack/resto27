"use client";

import { useEffect, useState } from "react";
import { BellRing, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/use-locale";
import {
  announcePushEnabled,
  getPromptUserState,
  savePushSubscription,
} from "@/lib/data/notify-actions";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * The PWA banners — install and notification permission.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHAT THIS OWNS (mounted once, in the root layout):
 *
 *   · on every load it CHECKS the two things that can only be asked once:
 *     is the app installed (display-mode: standalone / iOS navigator.standalone)
 *     and what does Notification.permission say;
 *   · if the site is installable but not installed, it offers the install
 *     (Chrome/Edge via beforeinstallprompt, iOS via a how-to hint);
 *   · if a signed-in user has not decided on notifications, it offers to
 *     enable them — and actually subscribes the browser on grant;
 *   · a dismissed banner is remembered in localStorage for ONE HOUR and only
 *     reappears after that hour has passed. Accepted states (installed,
 *     granted) are permanent — never shown again.
 *
 *  The banners are non-blocking, bottom-anchored cards that never steal
 *  focus, so a dismiss is just a dismiss — but a "no thanks" is not stored
 *  forever, which is the whole point of the hour.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Chrome/Edge fire this before showing their install UI. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** One hour — the user asked for dismissal tracking with an hourly retry. */
const COOLDOWN_MS = 60 * 60 * 1000;
const INSTALL_KEY = "restolink:installPromptDismissedAt";
const NOTIF_KEY = "restolink:notifPromptDismissedAt";

function readDismissed(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeDismissed(key: string) {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // localStorage can be unavailable (private mode, sandboxed iframe) — the
    // banner just reappears next visit, which is acceptable degradation.
  }
}

/** True while the stored dismissal is younger than an hour. */
function withinCooldown(stored: string | null): boolean {
  if (!stored) return false;
  const t = Number(stored);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < COOLDOWN_MS;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64_ = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64_);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari keeps a separate flag; it is the only way to know there.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  const iPhone = /iPhone|iPod/i.test(ua);
  // iPadOS 13+ reports a Mac user agent — the touch-points check catches it.
  const iPad = /iPad/i.test(ua) || (/Mac/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  return iPhone || iPad;
}

export function PwaPrompts({ brandName }: { brandName: string }) {
  const { t } = useLocale();
  const { toast } = useToast();

  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [installDismissedAt, setInstallDismissedAt] = useState<string | null>(null);
  const [notifDismissedAt, setNotifDismissedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tKey = (key: string) => `pwa.${key}` as TranslationKey;

  useEffect(() => {
    let cancelled = false;

    const onBeforeInstall = (e: Event) => {
      // The event is cancellable; preventDefault keeps the browser from
      // showing its own prompt before our banner offers it.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    // Returning to the tab may mean the user enabled/blocked notifications in
    // the browser UI, or installed from the address bar — re-check.
    const onVisible = () => {
      setInstalled(isStandalone());
      if ("Notification" in window) setPermission(Notification.permission);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("visibilitychange", onVisible);

    /*
      Every first read happens HERE, in one pass, rather than synchronously in
      the effect body. Same values, same moment in practice — but written as
      one update from a callback instead of four cascading renders on mount,
      which is the shape React asks for and the linter enforces.

      All of it is browser-only state (localStorage, display-mode, the
      Notification permission), so it cannot be lazy initial state either: none
      of it exists during the server render.
    */
    void (async () => {
      const state = await getPromptUserState().catch(() => ({ signedIn: false }));
      if (cancelled) return;

      setInstallDismissedAt(readDismissed(INSTALL_KEY));
      setNotifDismissedAt(readDismissed(NOTIF_KEY));
      setInstalled(isStandalone());
      setPermission("Notification" in window ? Notification.permission : null);
      setSignedIn(state.signedIn);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const ios = isIOS();

  function dismissInstall() {
    setInstallDismissedAt(String(Date.now()));
    writeDismissed(INSTALL_KEY);
  }

  async function handleInstall() {
    if (!deferred) return;
    setBusy(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
      } else {
        // They looked and said no — an hour before we ask again.
        dismissInstall();
      }
    } catch {
      // Chrome can refuse prompt() after too many dismissals — same rule.
      dismissInstall();
    } finally {
      setDeferred(null);
      setBusy(false);
    }
  }

  function dismissNotif() {
    setNotifDismissedAt(String(Date.now()));
    writeDismissed(NOTIF_KEY);
  }

  /**
   * The banner's Enable button — the same work the settings panel does, and
   * it now REPORTS THE SAME REASONS.
   *
   * It used to skip subscribing whenever the VAPID key was missing and then
   * toast "Notifications enabled" regardless, so the one configuration
   * problem that makes push impossible announced itself as success. Every
   * cause now names itself, and a real confirmation notification is sent on
   * the way out — proof, rather than a claim.
   */
  async function handleNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast(t("nset.push.unsupported"), "warning");
      dismissNotif();
      return;
    }
    setBusy(true);
    try {
      if (!window.isSecureContext) {
        toast(t("nset.push.insecure"), "warning");
        dismissNotif();
        return;
      }

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key || key.includes("REPLACE_ME")) {
        // Nothing the visitor can do — do not ask for a permission we cannot
        // use, and do not claim it worked.
        toast(t("nset.push.notConfigured"), "warning");
        dismissNotif();
        return;
      }

      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        // Blocked (or refused) — the browser will not re-ask; an hour from
        // now we point them at the site settings instead.
        toast(t(result === "denied" ? "nset.push.denied" : "nset.push.dismissed"), "warning");
        dismissNotif();
        return;
      }

      // Granted: subscribe this browser and record it, exactly like the
      // settings toggle — otherwise the permission is earned and unused.
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast: our decoder returns Uint8Array<ArrayBufferLike>, the DOM
          // wants BufferSource — same bytes, narrower generic.
          applicationServerKey: urlBase64ToUint8Array(key) as unknown as BufferSource,
        }));

      const saved = await savePushSubscription({
        endpoint: subscription.endpoint,
        p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("p256dh")!))),
        auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("auth")!))),
      });
      if (!saved.ok) {
        if (!existing) await subscription.unsubscribe().catch(() => {});
        toast(t("nset.push.failed"), "error");
        return;
      }

      const announced = await announcePushEnabled().catch(() => ({ ok: false as const }));
      toast(t(announced.ok ? "nset.push.enabled" : "nset.push.enabledNoSend"), "success");
    } catch (error) {
      console.error("[push] banner enable failed", error);
      toast(t("nset.push.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  const showInstall =
    ready && !installed && (deferred !== null || ios) && !withinCooldown(installDismissedAt);
  const showNotif =
    ready &&
    signedIn &&
    permission !== null &&
    permission !== "granted" &&
    !withinCooldown(notifDismissedAt);

  if (!showInstall && !showNotif) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-3 p-3 sm:p-4">
      {showInstall && (
        <BannerCard
          icon={<Download className="size-4.5" aria-hidden />}
          title={t(tKey("install.title"), { name: brandName })}
          onClose={dismissInstall}
          closeLabel={t(tKey("dismiss"))}
        >
          <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
            <span>{t(tKey("install.body"), { name: brandName })}</span>
          </p>
          {ios && (
            <p className="mt-1 text-xs text-text-light">
              <span>{t(tKey("install.ios"))}</span>
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {!ios && deferred && (
              <Button size="sm" loading={busy} disabled={busy} onClick={handleInstall}>
                <span>{t(tKey("install.action"))}</span>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={dismissInstall}>
              <span>{t(tKey("later"))}</span>
            </Button>
          </div>
        </BannerCard>
      )}

      {showNotif && (
        <BannerCard
          icon={<BellRing className="size-4.5" aria-hidden />}
          title={t(tKey("notif.title"))}
          onClose={dismissNotif}
          closeLabel={t(tKey("dismiss"))}
        >
          <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
            <span>
              {permission === "denied" ? t(tKey("notif.denied")) : t(tKey("notif.body"))}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {permission !== "denied" && (
              <Button size="sm" loading={busy} disabled={busy} onClick={handleNotifications}>
                <span>{t(tKey("notif.action"))}</span>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={dismissNotif}>
              <span>{t(tKey("later"))}</span>
            </Button>
          </div>
        </BannerCard>
      )}
    </div>
  );
}

/** One bottom card: icon, title, body/actions, and a dismiss X. */
function BannerCard({
  icon,
  title,
  onClose,
  closeLabel,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  onClose: () => void;
  closeLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pointer-events-auto w-full max-w-md rounded-xl border border-border bg-surface p-4 shadow-xl">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            <span>{title}</span>
          </p>
          {children}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="grid size-7 shrink-0 place-items-center rounded-full text-text-light transition-colors hover:bg-surface-2 hover:text-text"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
