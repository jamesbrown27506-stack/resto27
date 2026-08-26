"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bike, Printer, ReceiptText, Store, ShoppingBag } from "lucide-react";
import { OrderActionBar } from "@/components/order/order-action-bar";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { FilterChips } from "@/components/data/filter-bar";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/format/currency";
import { formatElapsed } from "@/lib/format/datetime";
import { isTerminal } from "@/lib/format/order-status";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { ManagerOrder } from "@/lib/data/orders";
import { cn } from "@/lib/utils";

const TYPE_ICON = { delivery: Bike, pickup: ShoppingBag, dine_in: Store } as const;

/** How often the queue re-reads the server. Realtime replaces this later (B.4). */
const POLL_MS = 30_000;

/**
 * The order queue, on live rows.
 *
 * WHAT THIS SCREEN OWNS is the list: the filters, the poll, and how a ticket
 * reads at a glance. What it no longer owns is what you can DO to a ticket —
 * advancing, quoting the delivery fee and cancelling all live in
 * `OrderActionBar`, because the order detail screen needs exactly the same
 * controls and a second copy is how the fee gate (§14.4) ends up enforced on
 * one screen and not the other.
 */
export function OrdersQueue({
  orders,
  now,
  feeBand,
  canAdvance,
}: {
  orders: ManagerOrder[];
  now: string;
  /** The restaurant's advertised delivery band (migration 0035). */
  feeBand: { min: number; max: number };
  /**
   * `orders.advance`. The queue never consulted it — both server actions
   * re-check it, so a waiter's tap failed with an error instead of the
   * button simply not being there.
   */
  canAdvance: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();

  const [filter, setFilter] = useState("active");

  // New orders arrive without anyone touching the page. router.refresh()
  // re-runs the Server Component, so the poll costs one RSC round trip and
  // never loses client state (open dialogs, chosen filter).
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  const counts = useMemo(
    () => ({
      active: orders.filter((o) => !isTerminal(o.status)).length,
      pending: orders.filter((o) => o.status === "pending").length,
      preparing: orders.filter((o) => o.status === "preparing").length,
      shipped: orders.filter((o) => o.status === "shipped").length,
      all: orders.length,
    }),
    [orders],
  );

  const visible = orders.filter((o) => {
    if (filter === "active") return !isTerminal(o.status);
    if (filter === "all") return true;
    return o.status === filter;
  });

  return (
    <>
      <FilterChips
        items={[
          { value: "active", label: t("mo.filter.active"), count: counts.active },
          { value: "pending", label: t("mo.filter.pending"), count: counts.pending },
          { value: "preparing", label: t("mo.filter.preparing"), count: counts.preparing },
          { value: "shipped", label: t("mo.filter.shipped"), count: counts.shipped },
          { value: "all", label: t("mo.filter.all"), count: counts.all },
        ]}
        value={filter}
        onChange={setFilter}
      />

      <div className="mt-5">
        {visible.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface">
            <EmptyState
              icon={<ReceiptText />}
              title={t("m.orders.none")}
              description={t("m.orders.noneBody")}
            />
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {visible.map((order) => {
              const Icon = TYPE_ICON[order.type];
              const needsFee =
                order.type === "delivery" &&
                order.deliveryFeeSetAt === null &&
                !isTerminal(order.status);

              return (
                <li
                  key={order.id}
                  className={cn(
                    "rounded-lg border bg-surface p-4 transition-colors sm:p-5",
                    order.status === "pending" || order.status === "awaiting_customer"
                      ? "border-warning/40"
                      : "border-border",
                  )}
                >
                  <div className="flex flex-wrap items-start gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-light text-primary">
                      <Icon className="size-4.5" aria-hidden />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Link
                          href={`/m/orders/${order.id}`}
                          className="tnum font-display font-bold hover:text-primary"
                        >
                          {order.reference}
                        </Link>
                        <OrderStatusBadge status={order.status} type={order.type} size="sm" />
                        {order.scheduledFor && (
                          <span
                            className="tnum text-xs font-medium text-primary"
                            title={t("mo.scheduledFor", {
                              time: formatElapsed(order.scheduledFor, new Date(now)),
                            })}
                          >
                            {t("mo.scheduled")}
                          </span>
                        )}
                        <span className="text-xs text-text-light">
                          {t(`order.type.${order.type}` as TranslationKey)} ·{" "}
                          {t("mo.ago", { elapsed: formatElapsed(order.createdAt, new Date(now)) })}
                        </span>
                      </div>

                      <p className="mt-1 text-sm text-text-secondary">
                        <span>
                          {order.deliveryName ?? `${t("mo.table")} ${order.tableNumber ?? "—"}`}
                        </span>
                        {order.deliveryQuartier && <span> · {order.deliveryQuartier}</span>}
                      </p>

                      <ul className="mt-2 flex flex-col gap-0.5 text-sm">
                        {order.items.map((item) => (
                          <li key={item.id} className="text-text-secondary">
                            <span className="tnum font-medium text-text">{item.quantity}×</span>{" "}
                            <span>{item.name}</span>
                            {item.optionsLabel && (
                              <span className="text-text-light"> · {item.optionsLabel}</span>
                            )}
                          </li>
                        ))}
                      </ul>

                      {order.notes && (
                        <p className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-text-secondary italic">
                          <span>{t("common.quoted", { text: order.notes })}</span>
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="tnum font-display text-lg font-bold">
                        {formatMoney(order.total)}
                      </span>
                      {needsFee && (
                        <span className="text-xs font-semibold text-warning">
                          {t("mo.feeMissing")}
                        </span>
                      )}
                    </div>
                  </div>

                  <OrderActionBar
                    order={order}
                    canAdvance={canAdvance}
                    feeBand={feeBand}
                    className="mt-4 border-t border-border pt-3.5"
                  >
                    <Link
                      href={`/m/orders/${order.id}`}
                      className={buttonClasses({ variant: "outline", size: "sm" })}
                    >
                      {t("mo.detail")}
                    </Link>
                    <Link
                      href={`/m/orders/${order.id}/ticket`}
                      target="_blank"
                      className={buttonClasses({ variant: "ghost", size: "sm" })}
                    >
                      <Printer className="size-3.5" aria-hidden />
                      <span>{t("mo.ticket")}</span>
                    </Link>
                  </OrderActionBar>
                </li>
              );
            })}
          </ul>
        )}
      </div>

    </>
  );
}
