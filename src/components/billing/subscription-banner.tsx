"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Info, Lock, X } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { SUBSCRIPTION_STATE_META, type SubscriptionState } from "@/lib/format/subscription";
import { useDates } from "@/lib/format/use-dates";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import { graceDaysLeft } from "@/lib/billing/grace";

/**
 * The banner a restaurant sees at the top of every manager screen.
 *
 * The `locked` variant is UNDISMISSABLE on purpose (§5). It is the one state
 * the tenant must act on, and a dismissible warning about an account that has
 * stopped working is a warning nobody reads twice.
 *
 * It always links to /m/billing, which stays reachable while locked — locking
 * someone out of the only screen that can unlock them is a trap that also
 * guarantees they never pay.
 *
 * SUBSCRIPTION_STATE_META still supplies the tone, the badge classes and the
 * dismissibility — the things that are not language. Its `label` is not read
 * here: that module is imported by server code where there is no locale, so
 * the words come from the dictionary instead.
 */
export function SubscriptionBanner({
  state,
  endDate,
  graceEndsAt,
  freeModeEndsAt,
}: {
  state: SubscriptionState;
  endDate?: string | null;
  /** End date + grace days: the real deadline while in grace. */
  graceEndsAt?: string | null;
  freeModeEndsAt?: string | null;
}) {
  const { t } = useLocale();
  const dates = useDates();
  const [dismissed, setDismissed] = useState(false);
  const meta = SUBSCRIPTION_STATE_META[state];
  // While in grace the deadline that matters is the END of the grace period,
  // not the end date that has already passed.
  const left = state === "grace" ? graceDaysLeft(graceEndsAt) : null;

  if (meta.tone === null) return null;
  if (dismissed && meta.dismissible) return null;

  const config = {
    warning: {
      Icon: AlertTriangle,
      classes: "bg-warning-light text-warning border-warning/30",
      title: t("common.sub.expiredTitle"),
      body: endDate && graceEndsAt && left !== null && left >= 0
        ? left === 0
          ? t("common.sub.graceLastDay", { expired: dates.date(endDate) })
          : t("common.sub.graceBody", {
              expired: dates.date(endDate),
              deadline: dates.date(graceEndsAt),
              left: t("common.sub.daysLeft", { count: left }),
            })
        : endDate
          ? t("common.sub.expiredBodyDate", { date: dates.date(endDate) })
          : t("common.sub.expiredBody"),
    },
    error: {
      Icon: Lock,
      classes: "bg-error-light text-error border-error/30",
      title: t("common.sub.lockedTitle"),
      body: t("common.sub.lockedBody"),
    },
    info: {
      Icon: Info,
      classes: "bg-info-light text-info border-info/30",
      title: t("common.sub.freeTitle"),
      body: freeModeEndsAt
        ? t("common.sub.freeBodyDate", { date: dates.date(freeModeEndsAt) })
        : t("common.sub.freeBody"),
    },
  }[meta.tone];

  const { Icon, classes, title, body } = config;

  return (
    <div
      role={meta.tone === "error" ? "alert" : "status"}
      className={cn("flex flex-wrap items-center gap-3 border-b px-4 py-2.5 sm:px-6", classes)}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{title}.</span> <span className="opacity-80">{body}</span>
      </p>

      <Link
        href="/m/billing"
        className={cn(buttonClasses({ size: "sm" }), "bg-current/10 text-current shadow-none hover:bg-current/20")}
      >
        <span>{t("common.sub.manage")}</span>
      </Link>

      {meta.dismissible && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("common.hide")}
          className="shrink-0 rounded p-1 opacity-60 transition-opacity hover:opacity-100"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
