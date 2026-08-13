"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { removePushSubscription, savePushSubscription } from "@/lib/data/notify-actions";

/**
 * The "notifications on this device" control, shared by the manager settings
 * and the customer settings.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHAT IT DOES:
 *
 *   · registers the service worker (public/sw.js),
 *   · asks the browser for permission and subscribes through the Push API,
 *     handing back endpoint + p256dh + auth,
 *   · stores that trio under the signed-in profile (savePushSubscription),
 *   · offers one tap to unsubscribe and forget.
 *
 *  A granted permission is re-synced on mount: if the subscription exists in
 *  the browser but not on the server (data wiped, another device), it is
 *  re-saved. Nothing here decides WHICH notifications arrive — the per-event
 *  toggles and the platform's master switch do that server-side.
 *
 *  THE VAPID PUBLIC KEY IS IN THE BUNDLE ON PURPOSE — it is public by
 *  design; the browser needs it to subscribe. The private key never leaves
 *  the server.
 * ─────────────────────────────────────────────────────────────────────────
 */

type State = "unsupported" | "default" | "granted" | "denied";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64_ = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64_);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The applicationServerKey the browser expects — a Uint8Array. */
function applicationServerKey(): Uint8Array | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key || key.includes("REPLACE_ME")) return null;
  try {
    return urlBase64ToUint8Array(key);
  } catch {
    return null;
  }
}

export function PushToggle({ tPrefix }: { tPrefix: "mset" | "cst" }) {
  const { t } = useLocale();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>("default");
  const [ready, setReady] = useState(false);

  const tKey = (key: string) => `${tPrefix}.push.${key}` as TranslationKey;

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      setReady(true);
      return;
    }
    setState(Notification.permission);
    setReady(true);
  }, []);

  useEffect(() => {
    if (state !== "granted") return;
    // Sync an existing subscription (browser wiped, or first visit since push
    // was added): register, then make sure the server knows about it.
    let cancelled = false;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await savePushSubscription({
            endpoint: subscription.endpoint,
            p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("p256dh")!))),
            auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("auth")!))),
          });
        }
      } catch (error) {
        console.error("[push] sync failed", error);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  async function subscribe() {
    if (pending) return;
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        setState(permission);
        if (permission !== "granted") return;

        const key = applicationServerKey();
        if (!key) {
          toast(t(tKey("failed")), "error");
          return;
        }

        const registration = await navigator.serviceWorker.register("/sw.js");
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast: our base64 decoder returns Uint8Array<ArrayBufferLike>, the
          // DOM wants BufferSource — same bytes, narrower generic.
          applicationServerKey: key as unknown as BufferSource,
        });

        const result = await savePushSubscription({
          endpoint: subscription.endpoint,
          p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("p256dh")!))),
          auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("auth")!))),
        });

        if (!result.ok) {
          await subscription.unsubscribe().catch(() => {});
          toast(result.error ?? t(tKey("failed")), "error");
          setState("default");
          return;
        }
        toast(t(tKey("enabled")), "success");
      } catch (error) {
        console.error("[push] subscribe failed", error);
        toast(t(tKey("failed")), "error");
      }
    });
  }

  async function unsubscribe() {
    if (pending) return;
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/sw.js");
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await removePushSubscription(subscription.endpoint);
          await subscription.unsubscribe().catch(() => {});
        }
        setState(Notification.permission);
      } catch (error) {
        console.error("[push] unsubscribe failed", error);
      }
    });
  }

  if (!ready) return null;

  const enabled = state === "granted";
  const denied = state === "denied";
  const unsupported = state === "unsupported";

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <BellRing className="mt-0.5 size-4 shrink-0 text-text-light" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            <span>{t(tKey("title"))}</span>
          </p>
          <p className="mt-0.5 text-xs text-text-light">
            <span>{t(tKey("body"))}</span>
          </p>
          {unsupported ? (
            <p className="mt-1 text-xs text-warning">
              <span>{t(tKey("unsupported"))}</span>
            </p>
          ) : denied ? (
            <p className="mt-1 text-xs text-warning">
              <span>{t(tKey("denied"))}</span>
            </p>
          ) : enabled ? (
            <Badge tone="success" className="mt-2">
              <span>{t(tKey("enabled"))}</span>
            </Badge>
          ) : null}
        </div>
      </div>

      {!unsupported && !denied && (
        <Button
          variant={enabled ? "outline" : "primary"}
          size="sm"
          loading={pending}
          disabled={pending}
          onClick={enabled ? unsubscribe : subscribe}
        >
          <span>{t(tKey(enabled ? "disable" : "enable"))}</span>
        </Button>
      )}
    </div>
  );
}
