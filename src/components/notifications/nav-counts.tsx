"use client";

import { useEffect, useRef, useState } from "react";
import {
  LIVE_FALLBACK_MS,
  reportSignalsAvailable,
  useRestaurantSignal,
  useRestaurantSignalChannel,
  useSignalLive,
} from "@/lib/realtime/restaurant-signal";
import { getManagerNavCounts, type ManagerNavCounts } from "@/lib/data/notify-actions";
import { cn } from "@/lib/utils";

/** Counts refresh during service and immediately when the app regains focus. */
export function useManagerNavCounts(restaurantId: string | null) {
  const empty: ManagerNavCounts = { orders: 0, kitchen: 0, tableOrder: 0, reservations: 0, messages: 0 };
  const [snapshot, setSnapshot] = useState<{ restaurantId: string | null; counts: ManagerNavCounts }>({
    restaurantId: null, counts: empty,
  });

  /*
    LIVE, NOT A 15-SECOND CLOCK (0066). The branch's signal channel is held
    open here (the shell mounts this hook for the active branch) and the
    counts are re-read when the database says something changed. The old
    15 s poll remains only while live updates are unavailable; while live,
    a 5-minute safety net. Focus, visibility and native pushes still refresh.
  */
  useRestaurantSignalChannel(restaurantId);
  const live = useSignalLive();
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = () => {
      if (cancelled || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      void getManagerNavCounts(restaurantId)
        .then((next) => {
          if (cancelled) return;
          const { signals, ...counts } = next;
          reportSignalsAvailable(signals === true);
          setSnapshot({ restaurantId, counts });
        })
        .catch((error) => console.error("[nav:refresh]", error))
        .finally(() => { inFlight = false; });
    };
    refreshRef.current = refresh;
    refresh();
    const timer = window.setInterval(refresh, live ? LIVE_FALLBACK_MS : 15_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("resto237:native-notification", refresh);
    document.addEventListener("visibilitychange", refresh);
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("resto237:native-notification", refresh);
      document.removeEventListener("visibilitychange", refresh);
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", refresh);
    };
  }, [restaurantId, live]);

  useRestaurantSignal(() => refreshRef.current());

  return restaurantId && snapshot.restaurantId === restaurantId ? snapshot.counts : empty;
}

/** The little number bubble beside a nav link — the tab badge in miniature. */
export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "tnum ml-auto grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-4 font-bold text-primary-fg",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
