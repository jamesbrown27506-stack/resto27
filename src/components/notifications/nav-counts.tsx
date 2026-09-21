"use client";

import { useEffect, useState } from "react";
import { getManagerNavCounts, type ManagerNavCounts } from "@/lib/data/notify-actions";
import { cn } from "@/lib/utils";

/** Counts refresh during service and immediately when the app regains focus. */
export function useManagerNavCounts(restaurantId: string | null) {
  const empty: ManagerNavCounts = { orders: 0, kitchen: 0, tableOrder: 0, reservations: 0, messages: 0 };
  const [snapshot, setSnapshot] = useState<{ restaurantId: string | null; counts: ManagerNavCounts }>({
    restaurantId: null, counts: empty,
  });

  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = () => {
      if (cancelled || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      void getManagerNavCounts(restaurantId)
        .then((next) => { if (!cancelled) setSnapshot({ restaurantId, counts: next }); })
        .catch((error) => console.error("[nav:refresh]", error))
        .finally(() => { inFlight = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
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
  }, [restaurantId]);

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
