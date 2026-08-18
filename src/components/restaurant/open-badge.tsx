"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { isOpenNow, type OpenHours } from "@/lib/format/hours";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * "Ouvert / Fermé" computed from the restaurant's real hours, not from its
 * account status.
 *
 * Rendered after mount only: the server has no idea what time it is on the
 * visitor's device, so computing during the first render would either be wrong
 * (server clock) or a hydration mismatch (client clock). Before mount we show
 * a neutral placeholder that reads as "loading" rather than a verdict.
 *
 * A restaurant that paused orders gets the stronger message — a kitchen that
 * is swamped should not advertise "Ouvert".
 */
export function OpenBadge({
  hours,
  acceptingOrders = true,
}: {
  hours: OpenHours[];
  acceptingOrders?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    const compute = () => setOpen(isOpenNow(hours, new Date()));
    compute();
    // The badge flipping at the top of every hour is the one piece of state
    // that must not wait for a reload — a card that says "Ouvert" at 21:59
    // must say "Fermé" at 22:00 on the same screen.
    const id = window.setInterval(compute, 60_000);
    return () => window.clearInterval(id);
  }, [hours]);

  if (!acceptingOrders) {
    return (
      <Badge tone="warning" className="border-transparent">
        {t("cbr.notAccepting")}
      </Badge>
    );
  }
  if (open === null) {
    return (
      <Badge tone="neutral" className="border-transparent bg-text/45 text-white">
        {t("cbr.openPlaceholder")}
      </Badge>
    );
  }
  return open ? (
    <Badge tone="primary" className="border-transparent bg-primary text-primary-fg">
      {t("cbr.openBadge")}
    </Badge>
  ) : (
    <Badge tone="neutral" className="border-transparent bg-text/45 text-white">
      {t("cbr.closedBadge")}
    </Badge>
  );
}
