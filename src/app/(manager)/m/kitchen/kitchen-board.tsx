"use client";

import Link from "next/link";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bike, Check, ChefHat, Clock, Store, ShoppingBag } from "lucide-react";
import { formatElapsed, formatTime, minutesSince } from "@/lib/format/datetime";
import { advanceLabelKey, nextStatus } from "@/lib/format/order-status";
import { advanceOrder } from "@/lib/data/order-actions";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/use-locale";
import { LIVE_FALLBACK_MS, useRestaurantSignal, useSignalLive } from "@/lib/realtime/restaurant-signal";
import { localizeActionError } from "@/lib/i18n/staff-errors";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { ManagerOrder } from "@/lib/data/orders";
import { cn } from "@/lib/utils";

const TYPE_ICON = { delivery: Bike, pickup: ShoppingBag, dine_in: Store } as const;

/**
 * Thresholds at which a ticket changes colour. A chef should see a late order
 * from across the room without reading the timer.
 */
const AMBER_AFTER_MIN = 15;
const RED_AFTER_MIN = 25;

/** Fast poll — this screen IS the queue, and it hangs on a wall untouched. */
const POLL_MS = 15_000;

/**
 * THE KITCHEN DISPLAY (§14.4).
 *
 * Confirmed + preparing, OLDEST FIRST, one-tap advance. Large type, high
 * contrast, minimal chrome — the design constraint is "read from across a
 * kitchen", not "looks good in a screenshot".
 *
 * Deliberately absent: prices, customer addresses, payment state. None of it
 * helps someone cooking, and all of it competes for the same glance.
 *
 * Advancing calls the SAME server action as /m/orders, so the two screens can
 * never disagree about what a transition means. Supabase Realtime replaces
 * the poll later (B.4); the poll stays as its fallback.
 */
export function KitchenBoard({ orders, now }: { orders: ManagerOrder[]; now: string }) {
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // LIVE (0066): refresh when the branch signals a change; the 15 s clock
  // only while live updates are unavailable, a 5-minute net while live.
  const live = useSignalLive();
  useRestaurantSignal(() => {
    if (document.visibilityState === "visible") router.refresh();
  });
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = window.setInterval(refresh, live ? LIVE_FALLBACK_MS : POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router, live]);

  function advance(order: ManagerOrder) {
    startTransition(async () => {
      const result = await advanceOrder(order.id);
      if (!result.ok) toast(localizeActionError(result.error, locale), "error");
    });
  }

  const clock = new Date(now);

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        THE HEADER IS BUILT FOR THE WALL TABLET AND HAS TO SURVIVE THE PHONE.

        Three big things — title, ticket count, clock — at wall-legible sizes
        add up to more than a 360px screen has, and the row used to push the
        whole board sideways. Every size now steps down below `sm`, the title
        truncates, and the counters are allowed to shrink. Nothing is hidden:
        a chef checking the queue from their own phone needs the same numbers
        as the one standing at the tablet.
      */}
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-3 sm:gap-4 sm:px-5 sm:py-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <Link
            href="/m"
            aria-label={t("mk.back")}
            className="grid size-9 shrink-0 place-items-center rounded-full text-text-secondary transition-colors hover:bg-surface-2 hover:text-text sm:size-10"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <h1 className="flex min-w-0 items-center gap-2 font-display text-lg font-bold sm:gap-2.5 sm:text-2xl">
            <ChefHat className="size-5 shrink-0 text-primary sm:size-6" aria-hidden />
            <span className="truncate">{t("m.kitchen.title")}</span>
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-3 sm:gap-6">
          <p className="tnum text-right">
            <span className="block font-display text-2xl leading-none font-bold sm:text-3xl">
              {orders.length}
            </span>
            <span className="text-[10px] tracking-wide text-text-light uppercase sm:text-xs">
              {t("mk.tickets")}
            </span>
          </p>
          <p className="tnum font-display text-2xl font-bold text-text-secondary sm:text-3xl">
            {formatTime(clock)}
          </p>
        </div>
      </header>

      {orders.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <Check className="size-12 text-success sm:size-16" aria-hidden />
          <p className="font-display text-2xl font-bold sm:text-3xl">{t("mk.allServed")}</p>
          <p className="text-base text-text-secondary sm:text-lg">{t("mk.allServedBody")}</p>
        </div>
      ) : (
        <ul className="grid flex-1 auto-rows-min gap-3 p-3 sm:grid-cols-2 sm:gap-4 sm:p-4 xl:grid-cols-3 2xl:grid-cols-4">
          {orders.map((order) => {
            // From PAYMENT, not placement (payment first): the minutes an order
            // sat waiting for the customer's Mobile Money are not kitchen minutes,
            // and counting them turned every ticket amber on arrival.
            const startedAt = order.confirmedAt ?? order.createdAt;
            const minutes = minutesSince(startedAt, clock);
            const late = minutes >= RED_AFTER_MIN;
            const warning = !late && minutes >= AMBER_AFTER_MIN;
            const Icon = TYPE_ICON[order.type];
            const next = nextStatus(order.status);
            // Same transition, different promise: "Envoyer" for a rider,
            // "Prête à retirer" for a counter. See order-status.ts.
            const nextLabel = advanceLabelKey(order.status, order.type);

            return (
              <li
                key={order.id}
                className={cn(
                  "flex flex-col overflow-hidden rounded-lg border-2 bg-surface",
                  late ? "border-error" : warning ? "border-warning" : "border-border",
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-between gap-3 px-4 py-3",
                    late
                      ? "bg-error text-white"
                      : warning
                        ? "bg-warning text-white"
                        : "bg-surface-2",
                  )}
                >
                  <span className="tnum font-display text-xl font-bold">
                    {order.reference.split("-").pop()}
                  </span>
                  <span className="tnum flex items-center gap-1.5 text-lg font-bold">
                    <Clock className="size-4" aria-hidden />
                    <span>{formatElapsed(startedAt, clock)}</span>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-2 text-sm font-semibold text-text-secondary">
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                  <span>{t(`order.type.${order.type}` as TranslationKey)}</span>
                  {order.tableNumber && (
                    <span>
                      · {t("mo.table")} {order.tableNumber}
                    </span>
                  )}
                  <span
                    className={cn(
                      "ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs",
                      order.status === "preparing"
                        ? "bg-warning/20 text-warning"
                        : "bg-info/20 text-info",
                    )}
                  >
                    {order.status === "preparing" ? t("mk.inProgress") : t("mk.toStart")}
                  </span>
                </div>

                {/* The ticket body. Big type, generous spacing — this is the
                    part that has to be legible at three metres. */}
                <ul className="flex flex-1 flex-col gap-3 p-4">
                  {order.items.map((item) => (
                    <li key={item.id}>
                      <p className="text-lg leading-tight font-bold">
                        <span className="tnum mr-1.5 text-primary">{item.quantity}×</span>
                        <span>{item.name}</span>
                      </p>
                      {item.optionsLabel && (
                        <p className="mt-0.5 text-base leading-snug text-text-secondary">
                          {item.optionsLabel}
                        </p>
                      )}
                      {item.notes && (
                        <p className="mt-1 rounded bg-warning/15 px-2 py-1 text-base font-semibold text-warning">
                          {item.notes}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>

                {order.notes && (
                  <p className="mx-4 mb-3 rounded bg-surface-2 px-3 py-2 text-base text-text-secondary">
                    {order.notes}
                  </p>
                )}

                {next && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => advance(order)}
                    // Tall tap target — this is used with wet or gloved hands.
                    className="w-full bg-primary px-4 py-4 text-lg font-bold text-primary-fg transition-colors hover:bg-primary-hover active:brightness-95 disabled:opacity-70"
                  >
                    {nextLabel && t(nextLabel)}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
