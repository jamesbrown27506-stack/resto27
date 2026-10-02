"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { minutesLeft } from "@/lib/orders/deadline";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * The time left to pay an accepted order, ticking down in the browser.
 *
 * Seeded with the minutes the server counted, so the first paint is already
 * right; after that it recounts from the deadline every 15 seconds — no
 * network, only the clock. At zero it keeps saying "under a minute": the
 * order-nag sweep cancels it, and the next realtime refresh moves it off the
 * home.
 */
export function PayCountdown({
  deadline,
  totalMinutes,
  initialMinutes,
  beforeLabel,
}: {
  deadline: string;
  totalMinutes: number;
  initialMinutes: number | null;
  beforeLabel: string;
}) {
  const { t } = useLocale();
  const [left, setLeft] = useState(initialMinutes);

  useEffect(() => {
    const id = window.setInterval(() => setLeft(minutesLeft(new Date(deadline))), 15_000);
    return () => window.clearInterval(id);
  }, [deadline]);

  if (left === null) return null;
  const share = totalMinutes > 0 ? Math.min(1, Math.max(0, left / totalMinutes)) : 0;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="tnum flex items-center gap-1.5 font-bold text-primary">
          <Clock className="size-4" aria-hidden />
          {left <= 1 ? t("chm.pay.lastMinute") : t("chm.pay.minutesLeft", { count: left })}
        </span>
        <span className="tnum text-text-secondary">{beforeLabel}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-primary-light" aria-hidden>
        <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}
