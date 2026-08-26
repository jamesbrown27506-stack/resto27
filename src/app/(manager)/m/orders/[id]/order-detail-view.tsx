"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MapPin, Phone, Printer } from "lucide-react";
import { ManagerPage } from "@/components/layout/manager-shell";
import { OrderActionBar } from "@/components/order/order-action-bar";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format/currency";
import { isoAttr } from "@/lib/format/datetime";
import { useDates } from "@/lib/format/use-dates";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { ManagerOrder, OrderEvent } from "@/lib/data/orders";
import { hasRestaurantActions, type OrderStatus } from "@/lib/format/order-status";

/**
 * Order detail — and now the screen you can ACT from.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS PAGE USED TO BE READ-ONLY ON PURPOSE, AND THAT STOPPED BEING RIGHT.
 *
 *  The old reasoning was that advancing and cancelling belonged on the queue,
 *  and a second set of mutation buttons would mean two screens whose states
 *  could race. Reasonable, until push notifications started deep-linking
 *  HERE: a new order, a table order, a delivery about to go late all open the
 *  detail page. So the screen a manager reaches at the most urgent moment was
 *  the one screen that could not accept the order — they had to notice the
 *  "Back to orders" link and find the same ticket again in the queue.
 *
 *  The race the old comment worried about is real and is handled the same way
 *  the queue handles it: `advanceOrder` re-derives the transition from the
 *  CURRENT row, so a stale button cannot double-skip, and this page polls on
 *  the same interval the queue does so a decision taken on the kitchen tablet
 *  shows up here within thirty seconds.
 *
 *  The controls are not re-implemented — `OrderActionBar` is the same
 *  component the queue renders, so the delivery-fee gate (§14.4) cannot be
 *  enforced on one screen and forgotten on the other.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Matches the queue's poll, so the two screens age at the same rate. */
const POLL_MS = 30_000;

export function OrderDetailView({
  order,
  canAdvance,
  feeBand,
}: {
  order: ManagerOrder & { history: OrderEvent[] };
  /** `orders.advance` — see the note on the page that resolves it. */
  canAdvance: boolean;
  /** The restaurant's advertised delivery band (migration 0035). */
  feeBand: { min: number; max: number };
}) {
  const { t } = useLocale();
  const dates = useDates();
  const router = useRouter();

  /*
    A ticket left open on a back-office screen goes stale silently, and here
    that is worse than on the queue: the buttons below act on what this render
    believes the status to be. The server re-derives the real transition, so a
    stale tap cannot corrupt the order — but it can do something the manager
    did not intend, and refreshing narrows that window to the one the queue
    already lives with.
  */
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  const money: { key: TranslationKey; value: number; strike?: boolean }[] = [
    { key: "mo.subtotal", value: order.subtotal },
    ...(order.discountAmount > 0
      ? [{ key: "mo.discount" as TranslationKey, value: -order.discountAmount }]
      : []),
    { key: "mo.serviceCharge", value: order.serviceCharge },
    ...(order.type === "delivery"
      ? [{ key: "mo.deliveryFee" as TranslationKey, value: order.deliveryFee }]
      : []),
  ];

  return (
    <ManagerPage
      title={order.reference}
      description={`${t(`order.type.${order.type}` as TranslationKey)} · ${dates.dateTime(order.createdAt)}`}
      action={
        <>
          <Link href="/m/orders" className={buttonClasses({ variant: "ghost" })}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t("mo.backToOrders")}</span>
          </Link>
          <Link
            href={`/m/orders/${order.id}/ticket`}
            target="_blank"
            className={buttonClasses({ variant: "outline" })}
          >
            <Printer className="size-4" aria-hidden />
            <span>{t("m.orders.print")}</span>
          </Link>
        </>
      }
    >
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          {/*
            FIRST IN THE LEFT COLUMN, ABOVE THE ITEMS.

            On a phone the left column stacks first, so the decision is the
            first thing on screen after the header — which is the whole point
            when a notification put you here. It carries no CardTitle: the
            buttons say what they do, and a heading above two buttons is a
            label for something that is already labelled.
          */}
          {hasRestaurantActions(order.status, canAdvance) && (
            <Card>
              <CardBody>
                <OrderActionBar
                  order={order}
                  canAdvance={canAdvance}
                  feeBand={feeBand}
                  size="md"
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{t("m.orders.items")}</CardTitle>
                <OrderStatusBadge status={order.status} type={order.type} />
              </div>

              <ul className="mt-4 divide-y divide-border">
                {order.items.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        <span className="tnum mr-1.5 text-primary">{item.quantity}×</span>
                        <span>{item.name}</span>
                      </p>
                      {item.optionsLabel && (
                        <p className="text-sm text-text-light">{item.optionsLabel}</p>
                      )}
                      {item.notes && (
                        <p className="mt-1 text-sm text-warning italic">{item.notes}</p>
                      )}
                    </div>
                    <span className="tnum shrink-0 font-medium">
                      {formatMoney(item.unitPrice * item.quantity)}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="mt-2 flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
                {money.map((line) => (
                  <div key={line.key} className="flex justify-between gap-3">
                    <dt className="text-text-secondary">{t(line.key)}</dt>
                    <dd className="tnum">
                      {line.key === "mo.deliveryFee" && order.deliveryFeeSetAt === null ? (
                        <span className="text-warning">{t("mo.feeTBD")}</span>
                      ) : (
                        <span>{formatMoney(line.value)}</span>
                      )}
                    </dd>
                  </div>
                ))}
                <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-border pt-2">
                  <dt className="font-semibold">{t("m.orders.total")}</dt>
                  <dd className="tnum font-display text-lg font-bold text-primary">
                    {formatMoney(order.total)}
                  </dd>
                </div>
              </dl>

              {order.notes && (
                <p className="mt-4 rounded-md bg-surface-2 px-3 py-2 text-sm text-text-secondary italic">
                  <span>{t("common.quoted", { text: order.notes })}</span>
                </p>
              )}

              {order.cancelledReason && (
                <p className="mt-4 rounded-md border border-error/30 bg-error-light px-3 py-2 text-sm text-error">
                  <span className="font-semibold">{t("mo.cancelledReason")}</span>{" "}
                  <span>{order.cancelledReason}</span>
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <CardTitle>{t("mo.history")}</CardTitle>
              <ul className="mt-4 divide-y divide-border">
                {order.history.map((event, i) => (
                  <li key={i} className="flex items-center justify-between gap-4 py-3">
                    <OrderStatusBadge status={event.status as OrderStatus} type={order.type} size="sm" />
                    <div className="text-right text-sm">
                      {event.byName && (
                        <p className="font-medium">{t("mo.by", { name: event.byName })}</p>
                      )}
                      <time dateTime={isoAttr(event.createdAt)} className="text-xs text-text-light">
                        {dates.dateTime(event.createdAt)}
                      </time>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        <aside className="flex flex-col gap-5 lg:sticky lg:top-24">
          {order.type !== "dine_in" && order.deliveryName && (
            <Card>
              <CardBody>
                <CardTitle>{t("m.orders.customer")}</CardTitle>
                <address className="mt-3 flex flex-col gap-2 text-sm not-italic">
                  <span className="font-medium">{order.deliveryName}</span>
                  {order.deliveryPhone && (
                    <a
                      href={`tel:${order.deliveryPhone.replace(/\s/g, "")}`}
                      className="flex items-center gap-2 text-text-secondary hover:text-primary"
                    >
                      <Phone className="size-3.5 shrink-0 text-primary" aria-hidden />
                      <span>{order.deliveryPhone}</span>
                    </a>
                  )}
                  {order.deliveryAddress && (
                    <span className="flex items-start gap-2 text-text-secondary">
                      <MapPin className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                      <span>
                        <span>{order.deliveryAddress}</span>
                        {order.deliveryQuartier && (
                          <span className="block">{order.deliveryQuartier}</span>
                        )}
                        {order.deliveryLandmark && (
                          <span className="block text-text-light">{order.deliveryLandmark}</span>
                        )}
                      </span>
                    </span>
                  )}
                </address>
              </CardBody>
            </Card>
          )}

          {order.tableNumber && (
            <Card>
              <CardBody className="flex items-center justify-between gap-3">
                <CardTitle>{t("mo.table")}</CardTitle>
                <span className="tnum font-display text-2xl font-bold">{order.tableNumber}</span>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody>
              <CardTitle>{t("nav.m.billing")}</CardTitle>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-text-secondary">
                  {t(`order.pay.${order.paymentMethod}` as TranslationKey)}
                </span>
                <Badge tone={order.isPaid ? "success" : "warning"}>
                  {order.isPaid ? t("order.paid") : t("order.unpaid")}
                </Badge>
              </div>
            </CardBody>
          </Card>
        </aside>
      </div>
    </ManagerPage>
  );
}
