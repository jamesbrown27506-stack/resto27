"use client";

import Link from "next/link";
import { ArrowLeft, MapPin, Phone, Printer } from "lucide-react";
import { ManagerPage } from "@/components/layout/manager-shell";
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
import type { OrderStatus } from "@/lib/format/order-status";

/**
 * Order detail, read-only.
 *
 * Advancing and cancelling live on the QUEUE, deliberately — this page is for
 * checking an address or reading history mid-dispute, and stacking a second
 * set of mutation buttons here would mean two screens whose states can race.
 */
export function OrderDetailView({
  order,
}: {
  order: ManagerOrder & { history: OrderEvent[] };
}) {
  const { t } = useLocale();
  const dates = useDates();

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
          <Card>
            <CardBody>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{t("m.orders.items")}</CardTitle>
                <OrderStatusBadge status={order.status} />
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
                    <OrderStatusBadge status={event.status as OrderStatus} size="sm" />
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
