"use client";

import { useEffect } from "react";
import { getFirebaseApp } from "@/lib/firebase/client";
import { initializeFirebaseAnalytics } from "@/lib/firebase/client";

export function FirebaseInit() {
  useEffect(() => {
    void initializeFirebaseAnalytics();
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void import("firebase/messaging").then(async ({ isSupported, getMessaging, onMessage }) => {
      if (!await isSupported() || cancelled) return;
      unsubscribe = onMessage(getMessaging(getFirebaseApp()), message => {
        if (document.visibilityState !== "visible") return;
        let payload: { title?: string; body?: string; href?: string; tone?: string };
        try { payload = message.data?.payload ? JSON.parse(message.data.payload) : message.notification ?? {}; }
        catch { return; }
        if (!payload.title) return;
        // Reuse the existing page notification handler and its realtime deduplication.
        navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
          data: { type: "restolink:notification", ...payload },
        }));
      });
    }).catch(() => undefined);
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);
  return null;
}
