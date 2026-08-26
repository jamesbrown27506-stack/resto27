"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { OrderStatusBadge, STATUS_ICONS } from "./order-status-badge";
import { formatMoney } from "@/lib/format/currency";
import { formatDateTime, formatRelative, isoAttr } from "@/lib/format/datetime";
import {
  flowIndex,
  orderFlow,
  orderStatusMeta,
  type OrderStatus,
  type OrderType,
} from "@/lib/format/order-status";
import type { CustomerOrder as Order } from "@/lib/data/customer";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";


/**
 * Live status timeline — the centrepiece of /orders/[id], the busiest page in
 * the app (§14.3).
 *
 * A cancelled order does not render a rail: it left the flow, and drawing four
 * greyed steps beneath a red badge implies it might still continue.
 */
export function OrderStatusTimeline({
  status,
  type,
  history,
}: {
  status: OrderStatus;
  /**
   * Which steps this order actually has, and what they are called. A pickup
   * timeline that borrowed delivery's was wrong twice: it showed a
   * "delivery fee to approve" step a takeaway can never reach, and because
   * `flowIndex` counted that step, a confirmed pickup order painted it as
   * already done.
   */
  type: OrderType;
  history: { status: string; at: string; byName: string | null }[];
}) {
  const { t } = useLocale();
  if (status === "cancelled") {
    const event = history.find((h) => h.status === "cancelled");
    return (
      <div className="flex items-start gap-3 rounded-md border border-error/30 bg-error-light p-4">
        <X className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
        <div>
          <p className="font-semibold text-error">{t("ost.cancelled")}</p>
          {event && (
            <p className="mt-0.5 text-sm text-text-secondary">
              <time dateTime={isoAttr(event.at)}>{formatDateTime(event.at)}</time> · {event.byName}
            </p>
          )}
        </div>
      </div>
    );
  }

  const steps = orderFlow(type);
  const current = flowIndex(status, type);

  return (
    <ol className="relative">
      {steps.map((step, i) => {
        const meta = orderStatusMeta(step, type);
        const Icon = STATUS_ICONS[meta.icon];
        const event = history.find((h) => h.status === step);
        const done = i < current;
        const active = i === current;
        const last = i === steps.length - 1;

        return (
          <li key={step} className="relative flex gap-4 pb-7 last:pb-0">
            {!last && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-9 left-4 h-[calc(100%-1.5rem)] w-0.5 -translate-x-1/2",
                  done ? "bg-primary" : "bg-border",
                )}
              />
            )}

            <span
              className={cn(
                "relative z-10 grid size-8 shrink-0 place-items-center rounded-full border-2 transition-colors",
                done && "border-primary bg-primary text-primary-fg",
                active && "border-primary bg-surface text-primary",
                !done && !active && "border-border bg-surface text-text-light",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>

            <div className="min-w-0 pt-0.5">
              <p
                className={cn(
                  "font-semibold",
                  active ? "text-primary" : done ? "text-text" : "text-text-light",
                )}
              >
                {t(meta.labelKey)}
              </p>

              {event ? (
                <p className="mt-0.5 text-sm text-text-secondary">
                  <time dateTime={isoAttr(event.at)}>{formatDateTime(event.at)}</time>
                  {event.byName && ` · ${event.byName}`}
                </p>
              ) : active ? (
                <p className="mt-0.5 text-sm text-text-secondary">
                  {t(meta.descKey)}
                </p>
              ) : null}

              {active && (
                <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                  {t("cor.inProgress")}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Order card, for lists ─────────────────────────────────────────────── */

export function OrderCard({ order, now }: { order: Order; now?: Date }) {
  const { t } = useLocale();
  return (
    <article className="relative rounded-lg border border-border bg-surface p-5 transition-shadow hover:shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">
            <Link href={`/orders/${order.id}`} className="after:absolute after:inset-0">
              {order.restaurantName}
            </Link>
          </h3>
          <p className="tnum mt-0.5 text-xs text-text-light">
            {/* An order reference is an identifier, not prose — translating
                "RL-2408-0147" can only damage it. */}
            <span translate="no">{order.reference}</span> · {t(`cor.type.${order.type}` as TranslationKey)} ·{" "}
            <time dateTime={isoAttr(order.createdAt)}>{formatRelative(order.createdAt, now)}</time>
          </p>
          {order.scheduledFor && (
            <p className="mt-0.5 text-xs font-medium text-primary">
              {t("cor.scheduledFor")}{" "}
              <time dateTime={isoAttr(order.scheduledFor)}>{formatRelative(order.scheduledFor, now)}</time>
            </p>
          )}
        </div>
        <OrderStatusBadge status={order.status} type={order.type} />
      </div>

      <ul className="mt-3.5 flex flex-col gap-1 text-sm text-text-secondary">
        {order.items.slice(0, 3).map((item) => (
          <li key={item.id} className="truncate">
            <span className="tnum font-medium text-text">{item.quantity}×</span> {item.name}
            {item.optionsLabel && (
              <span className="text-text-light"> · {item.optionsLabel}</span>
            )}
          </li>
        ))}
        {order.items.length > 3 && (
          <li className="text-xs text-text-light">
            {t(
              order.items.length - 3 > 1 ? "cor.moreItems_other" : "cor.moreItems_one",
              { count: order.items.length - 3 },
            )}
          </li>
        )}
      </ul>

      <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border pt-3.5">
        <span className="text-sm text-text-secondary">
          {order.deliveryFeeSetAt === null && order.type === "delivery"
            ? t("cor.deliveryToConfirm")
            : t(order.items.length > 1 ? "cor.itemsCount_other" : "cor.itemsCount_one", {
                count: order.items.length,
              })}
        </span>
        <span className="tnum font-display text-lg font-bold">{formatMoney(order.total)}</span>
      </div>
    </article>
  );
}

/* ── Receipt ───────────────────────────────────────────────────────────── */

/**
 * The money breakdown, shown identically on the customer receipt, the manager
 * order detail and the printed ticket. Every figure comes off the ORDER — the
 * snapshot — never recomputed from the current menu.
 */
export function OrderReceipt({ order }: { order: Order }) {
  const { t } = useLocale();
  return (
    <div>
      <ul className="divide-y divide-border">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                <span className="tnum text-text-secondary">{item.quantity}×</span> {item.name}
              </p>
              {item.optionsLabel && (
                <p className="mt-0.5 text-sm text-text-secondary">{item.optionsLabel}</p>
              )}
              {item.notes && (
                <p className="mt-0.5 text-xs text-text-light italic">« {item.notes} »</p>
              )}
            </div>
            <p className="tnum shrink-0 font-medium">
              {formatMoney(item.unitPrice * item.quantity)}
            </p>
          </li>
        ))}
      </ul>

      <dl className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-text-secondary">{t("cor.subtotal")}</dt>
          <dd className="tnum font-medium">{formatMoney(order.subtotal)}</dd>
        </div>

        {order.discountAmount > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">
              {order.promoCode
                ? t("cct.sum.discountCode", { code: order.promoCode })
                : t("cor.discount")}
            </dt>
            <dd className="tnum font-medium text-success">
              −{formatMoney(order.discountAmount)}
            </dd>
          </div>
        )}

        <div className="flex justify-between gap-3">
          <dt className="text-text-secondary">
            {t("cor.service", { percent: order.serviceChargePercent })}
          </dt>
          <dd className="tnum font-medium">{formatMoney(order.serviceCharge)}</dd>
        </div>

        {order.type === "delivery" && (
          <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">{t("cor.delivery")}</dt>
            <dd className="tnum font-medium">
              {order.deliveryFeeSetAt === null ? (
                <span className="text-text-light">{t("cor.toConfirm")}</span>
              ) : (
                formatMoney(order.deliveryFee)
              )}
            </dd>
          </div>
        )}

        {order.loyaltyValue > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">{t("cor.loyalty")}</dt>
            <dd className="tnum font-medium text-success">−{formatMoney(order.loyaltyValue)}</dd>
          </div>
        )}

        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-border pt-3">
          <dt className="font-display text-base font-bold">{t("cor.total")}</dt>
          <dd translate="no" className="tnum font-display text-xl font-bold text-primary">
            {formatMoney(order.total)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
