"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BellRing } from "lucide-react";
import { useNotifications } from "./notification-provider";
import { getPendingOrderAlarm, type PendingAlarmState } from "@/lib/data/pending-order-actions";
import {
  ORDERS_CHANGED_EVENT,
  isManagerOrderHref,
  nextRingStart,
  ringingOrders,
  soonestDeadline,
} from "@/lib/orders/pending-alarm";
import { minutesLeft } from "@/lib/orders/deadline";
import { useDates } from "@/lib/format/use-dates";
import { useLocale } from "@/lib/i18n/use-locale";

/** One ring every four seconds: continuous without being a single drone. */
const RING_EVERY_MS = 4_000;
/** The server re-check, and ONLY while something rings. */
const CHECK_EVERY_MS = 30_000;
/** A burst of notifications (push + realtime row for one order) is one check. */
const NOTIFY_DEBOUNCE_MS = 1_200;
/** setTimeout's ceiling; a pre-order days away just re-arms later. */
const MAX_TIMER_MS = 2_147_000_000;

/**
 * RING UNTIL ACCEPTED — the owner's rule: "it should continuously ring till
 * it's accepted, when the app is open".
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHAT IT DOES.
 *
 *  While at least one order at this branch is `pending` — placed, not yet
 *  accepted — it plays the new-order sound every four seconds and pins a
 *  banner saying how many are waiting and when the first one will be
 *  cancelled automatically (the admin's `order_response_minutes`, via
 *  lib/orders/deadline). The moment nothing is pending it goes silent.
 *
 *  It uses the provider's ONE unlocked audio element (sound-player.ts), so
 *  it rings in a background tab exactly like a notification does. It cannot
 *  ring an app that is fully closed — only push reaches that, and the
 *  order-nag cron already re-pushes unanswered orders.
 *
 *  WHAT IT COSTS (Vercel CPU is the budget):
 *    · one server read when the back office opens;
 *    · one read when a `/m/orders…` notification lands, or the orders badge
 *      goes up, or someone in this tab accepts/cancels an order;
 *    · one read every 30 s WHILE AND ONLY WHILE something is ringing.
 *  A quiet evening costs exactly one call. A pre-order for tomorrow wakes
 *  the alarm with a local timer when its window opens — no polling for it.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function PendingOrderAlarm({
  restaurantId,
  enabled,
  ordersBadge,
}: {
  restaurantId: string;
  /** `orders.advance` — only the people who can accept are rung for. */
  enabled: boolean;
  /** The nav's live orders count; a rise is a free hint that something arrived. */
  ordersBadge: number;
}) {
  const { t } = useLocale();
  const dates = useDates();
  const router = useRouter();
  const pathname = usePathname();
  const { playSound, onNotification } = useNotifications();

  const [state, setState] = useState<PendingAlarmState | null>(null);
  const [now, setNow] = useState(0);

  // The check is shared by five triggers; one in flight at a time, and a
  // trigger that arrives mid-flight queues exactly one follow-up.
  const checkRef = useRef<() => void>(() => {});
  useEffect(() => {
    let inFlight = false;
    let queued = false;
    let cancelled = false;

    const run = () => {
      if (!enabled || cancelled) return;
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      void getPendingOrderAlarm()
        .then((next) => {
          if (cancelled) return;
          setState(next);
          setNow(Date.now());
        })
        .catch((error) => console.error("[alarm] check failed", error))
        .finally(() => {
          inFlight = false;
          if (queued && !cancelled) {
            queued = false;
            run();
          }
        });
    };

    checkRef.current = run;
    // Seed: once when the back office opens, and again after a branch switch.
    run();
    return () => {
      cancelled = true;
      checkRef.current = () => {};
    };
  }, [enabled, restaurantId]);

  // The page a notification should refresh, read inside a long-lived listener.
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  /*
    A NEW ORDER REFRESHES THE QUEUE NOW, not at the next 30 s poll.

    The queue, the dashboard and the kitchen each poll on their own clock, so
    an order could ring here while the list underneath did not show it yet —
    the manager heard it and could not find it. A `/m/orders…` notification
    is the moment to re-read both.
  */
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onNotification((event) => {
      if (!isManagerOrderHref(event.href)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        checkRef.current();
        const path = pathRef.current ?? "";
        if (path === "/m" || path.startsWith("/m/orders") || path.startsWith("/m/kitchen")) {
          router.refresh();
        }
      }, NOTIFY_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, onNotification, router]);

  // Accepted or cancelled in this tab: stop ringing now, not in 30 s.
  useEffect(() => {
    if (!enabled) return;
    const onChanged = () => checkRef.current();
    window.addEventListener(ORDERS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ORDERS_CHANGED_EVENT, onChanged);
  }, [enabled]);

  // The orders badge already polls (nav-counts); when it RISES, an order may
  // have arrived without a notification (push off, realtime down). Free hint.
  const lastBadge = useRef(ordersBadge);
  useEffect(() => {
    if (ordersBadge > lastBadge.current) checkRef.current();
    lastBadge.current = ordersBadge;
  }, [ordersBadge]);

  const current = state && state.restaurantId === restaurantId ? state : null;
  const ringing = useMemo(
    () => (current && now > 0 ? ringingOrders(current.orders, current.minutes, now) : []),
    [current, now],
  );
  const isRinging = enabled && ringing.length > 0;

  // The provider hands out a fresh playSound on every render; through a ref,
  // an unrelated re-render (the unread count) cannot restart the ring cycle.
  const playRef = useRef(playSound);
  useEffect(() => {
    playRef.current = playSound;
  }, [playSound]);

  // The ring itself, plus the clock that drives the countdown.
  useEffect(() => {
    if (!isRinging) return;
    playRef.current();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      playRef.current();
    }, RING_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [isRinging]);

  // The server re-check — the only poll, and only while ringing.
  useEffect(() => {
    if (!isRinging) return;
    const timer = window.setInterval(() => checkRef.current(), CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [isRinging]);

  // A pre-order whose accept window opens later: one local timer, no server.
  const wakeAt = current && now > 0 ? nextRingStart(current.orders, current.minutes, now) : null;
  useEffect(() => {
    if (wakeAt === null) return;
    const delay = Math.min(Math.max(wakeAt - Date.now(), 0) + 500, MAX_TIMER_MS);
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [wakeAt]);

  if (!isRinging || !current) return null;

  const count = ringing.length;
  const deadline = soonestDeadline(ringing, current.minutes, now);
  const left = minutesLeft(deadline, now);
  const href = count === 1 ? `/m/orders/${ringing[0]!.id}` : "/m/orders";

  return (
    <div
      role="alert"
      className="no-print flex flex-wrap items-center gap-3 border-b-2 border-error bg-error px-4 py-2.5 text-white"
    >
      <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-white/20">
        {/* Disabled under prefers-reduced-motion by the global rule. */}
        <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-white/40" />
        <BellRing className="relative size-4" aria-hidden />
      </span>
      <p className="min-w-0 flex-1 text-sm leading-snug">
        <span className="font-bold">
          {t(count === 1 ? "mops.alarm.one" : "mops.alarm.many", { count })}
        </span>
        {deadline && left !== null && (
          <span className="block text-xs opacity-90 sm:inline sm:before:content-['_·_']">
            {t("mops.alarm.deadline", { minutes: left, time: dates.time(deadline) })}
          </span>
        )}
      </p>
      <Link
        href={href}
        className="inline-flex min-h-11 shrink-0 items-center rounded-md bg-white px-4 text-sm font-bold text-error hover:bg-white/90"
      >
        {t("mops.alarm.view")}
      </Link>
    </div>
  );
}
