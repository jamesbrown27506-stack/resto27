"use client";

import { useEffect, useState } from "react";
import { getManagerNavCounts } from "@/lib/data/notify-actions";
import { cn } from "@/lib/utils";

/**
 * The "how many of these need me right now" counts behind the sidebar badges
 * and the mobile tab bar.
 *
 * These are a snapshot on mount and on branch change — the *live* signal is
 * the realtime toast + bell badge. A badge that is a few seconds stale is the
 * right trade: polling here would wake the server on every manager's every
 * tab just to keep a number warm.
 */
export function useManagerNavCounts(restaurantId: string | null) {
  const [counts, setCounts] = useState({ orders: 0, reservations: 0, messages: 0 });

  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;
    getManagerNavCounts(restaurantId)
      .then((c) => {
        if (!cancelled) setCounts(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return counts;
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
