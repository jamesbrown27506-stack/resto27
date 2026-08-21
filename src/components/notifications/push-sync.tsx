"use client";

import { useCallback, useEffect, useRef } from "react";
import { getPushSyncState, savePushSubscription } from "@/lib/data/notify-actions";

/**
 * Push self-repair, on every app open. Renders nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE BUG THIS EXISTS FOR.
 *
 *  "Most of the time I have to turn push notifications off and back on
 *  before I actually start receiving them."
 *
 *  Push has two independent halves. The PREFERENCE — "I want push" — lives in
 *  `notification_channels` and never changes on its own. The SUBSCRIPTION —
 *  "this browser can receive it" — is a row in `push_subscriptions` holding an
 *  endpoint the browser vendor issued, and that one dies constantly:
 *
 *    · the browser rotates the endpoint (fires `pushsubscriptionchange`,
 *      handled in sw.js);
 *    · Android force-stops the app, or the battery optimiser reaps it, and
 *      the subscription does not come back with it;
 *    · the service worker is evicted under storage pressure and the next
 *      registration is a fresh one;
 *    · the server sent to a stale endpoint, got 410 Gone, and deleted the row
 *      — correctly — leaving the device with a live subscription the server
 *      no longer knows about;
 *    · the person signed in on a device that had subscribed under a previous
 *      account.
 *
 *  In every one of those the preference still reads "on", so the switch in
 *  settings looks right and the notifications do not arrive. Toggling it off
 *  and on subscribes from scratch, which is why the workaround worked — and
 *  why it had to be repeated.
 *
 *  Until now, the ONLY code that re-synced a subscription lived inside the
 *  settings panel's mount effect. So the repair existed, but you had to walk
 *  to Settings to trigger it, which is the trip the toggle was standing in
 *  for.
 *
 *  This runs the same repair from the root layout: on every load, and again
 *  whenever the app is brought back to the foreground.
 *
 *  WHAT IT DELIBERATELY DOES NOT DO: ask for permission. A permission prompt
 *  belongs to a deliberate tap (the settings switch, or the PWA banner), and
 *  one that appears because a page loaded is the pattern browsers now punish
 *  with a permanent block. This acts only where permission is ALREADY granted
 *  and the person has ALREADY said they want push — it repairs plumbing, it
 *  never asks for anything.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Don't re-run on every tab focus — a phone fires `visibilitychange` when you
 * glance at a notification shade. Once a minute is plenty for a repair whose
 * subject only breaks on the order of hours.
 */
const MIN_INTERVAL_MS = 60_000;

function keyToBase64(key: ArrayBuffer | null): string {
  if (!key) return "";
  return btoa(String.fromCharCode(...new Uint8Array(key)));
}

function decodeVapidKey(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushSync() {
  const lastRunAt = useRef(0);
  const running = useRef(false);

  const sync = useCallback(async () => {
    if (running.current) return;
    if (Date.now() - lastRunAt.current < MIN_INTERVAL_MS) return;

    // Cheap client-side gates first, so a guest on a public page — the common
    // case — costs nothing but three property reads.
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return;
    }
    if (!window.isSecureContext) return;
    // Not granted means either never asked or blocked. Both are somebody
    // else's job; see the note above about never prompting from here.
    if (Notification.permission !== "granted") return;

    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key || key.includes("REPLACE_ME")) return;

    running.current = true;
    lastRunAt.current = Date.now();

    try {
      const state = await getPushSyncState().catch(() => null);
      if (!state?.signedIn || !state.wantsPush) return;

      // `register` rather than `getRegistration`: if the worker was evicted,
      // this is what brings it back. It is idempotent when one is already
      // installed, so the common path costs a resolved promise.
      const registration = await navigator.serviceWorker.register("/sw.js");

      // A subscription can exist on the device and be unknown to the server
      // (the 410 case above), so the endpoint is re-sent EITHER WAY. The write
      // is an upsert keyed on the endpoint, so re-sending a known one is a
      // no-op that costs one round trip a minute at worst.
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast: the decoder returns Uint8Array<ArrayBufferLike>, the DOM
          // wants BufferSource — same bytes, narrower generic.
          applicationServerKey: decodeVapidKey(key) as unknown as BufferSource,
        }));

      await savePushSubscription({
        endpoint: subscription.endpoint,
        p256dh: keyToBase64(subscription.getKey("p256dh")),
        auth: keyToBase64(subscription.getKey("auth")),
      }).catch(() => {});
    } catch (error) {
      // A failed repair is invisible on purpose: nothing was asked for, so
      // there is nothing to report. The next app open tries again.
      console.error("[push] sync failed", error);
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    void sync();

    // Returning to the app is the other moment worth repairing at: a phone
    // that was asleep for a day is exactly when the endpoint has gone stale.
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [sync]);

  return null;
}
