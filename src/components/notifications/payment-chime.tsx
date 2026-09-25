"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useNotifications } from "./notification-provider";

const EVERY_MS = 10_000;
const RINGS = 6; // the first is the notification's own sound → about one minute

/**
 * "THE RESTAURANT CONFIRMED — PLEASE PAY", RUNG FOR A MINUTE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A customer's order stops at `awaiting_customer` until they pay, and the
 *  time limit cancels it if they don't — so this one update deserves more
 *  than a single sound. The notification's own chime is ring #1; this adds
 *  one every 10 s for about a minute (6 in all), then stops for good.
 *  Opening that order stops it at once — they have seen it.
 *
 *  Recognised by the `?pay=1` the server puts on exactly these links
 *  (order-actions acceptance, the half-time reminder). Browser only: no
 *  server call, no Vercel CPU. A closed app gets the push instead.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function PaymentChime() {
  const { onNotification, playSound } = useNotifications();
  const pathname = usePathname();
  const playRef = useRef(playSound);
  useEffect(() => {
    playRef.current = playSound;
  }, [playSound]);

  const activeRef = useRef<{ path: string; timer: ReturnType<typeof setInterval> } | null>(null);

  const stop = () => {
    if (activeRef.current) clearInterval(activeRef.current.timer);
    activeRef.current = null;
  };

  useEffect(() => {
    const unsubscribe = onNotification((event) => {
      if (!event.href || !/^\/orders\/[^/?#]+\?(?:.*&)?pay=1(?:&|$)/.test(event.href)) return;
      const path = event.href.split("?")[0];
      stop();
      let rung = 1; // the notification itself just played the first sound
      const timer = setInterval(() => {
        rung += 1;
        playRef.current();
        if (rung >= RINGS) stop();
      }, EVERY_MS);
      activeRef.current = { path, timer };
    });
    return () => {
      unsubscribe();
      stop();
    };
  }, [onNotification]);

  // Opening the order it is about means they have seen it.
  useEffect(() => {
    if (activeRef.current && pathname === activeRef.current.path) stop();
  }, [pathname]);

  return null;
}
