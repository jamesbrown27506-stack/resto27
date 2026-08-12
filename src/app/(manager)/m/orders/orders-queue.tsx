"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bike, Printer, ReceiptText, Store, ShoppingBag } from "lucide-react";
import { DeliveryFeeDialog } from "@/components/order/delivery-fee-dialog";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { FilterChips } from "@/components/data/filter-bar";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format/currency";
import { formatElapsed } from "@/lib/format/datetime";
import { isTerminal, nextStatus } from "@/lib/format/order-status";
import { advanceOrder, cancelOrder } from "@/lib/data/order-actions";
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
 * The one rule this screen exists to enforce: CONFIRMING A DELIVERY ORDER
 * PROMPTS FOR THE FEE (§14.4). The dialog is the UI half; advanceOrder()
 * re-checks it server-side, so there is no path from `pending` to `confirmed`
 * on a delivery order that skips the quote.
 *
 * Advance actions come from `nextStatus()`, so the UI can never offer a
 * transition the state machine will refuse — and the server re-derives the
 * transition anyway, so two taps racing on one ticket cannot double-skip.
 */
export function OrdersQueue({ orders, now }: { orders: ManagerOrder[]; now: string }) {
  const { t } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [filter, setFilter] = useState("active");
  const [feeFor, setFeeFor] = useState<ManagerOrder | null>(null);
  const [cancelling, setCancelling] = useState<ManagerOrder | null>(null);
  const [reason, setReason] = useState("");

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

  function advance(order: ManagerOrder, fee?: number) {
    const next = nextStatus(order.status);
    if (!next) return;

    // The gate. A delivery order cannot reach `confirmed` without a fee.
    if (
      next === "confirmed" &&
      order.type === "delivery" &&
      order.deliveryFeeSetAt === null &&
      fee === undefined
    ) {
      setFeeFor(order);
      return;
    }

    startTransition(async () => {
      const result = await advanceOrder(order.id, fee !== undefined ? { deliveryFee: fee } : {});
      setFeeFor(null);
      if (!result.ok) return toast(result.error, "error");
      toast(t("mo.updated"), "success");
    });
  }

  function submitCancel() {
    const order = cancelling;
    if (!order) return;

    startTransition(async () => {
      const result = await cancelOrder(order.id, reason);
      if (!result.ok) return toast(result.error, "error");
      setCancelling(null);
      setReason("");
      toast(t("mo.cancelled"), "success");
    });
  }

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
              const next = nextStatus(order.status);
              const needsFee =
                order.type === "delivery" &&
                order.deliveryFeeSetAt === null &&
                !isTerminal(order.status);

              return (
                <li
                  key={order.id}
                  className={cn(
                    "rounded-lg border bg-surface p-4 transition-colors sm:p-5",
                    order.status === "pending" ? "border-warning/40" : "border-border",
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
                        <OrderStatusBadge status={order.status} size="sm" />
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

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3.5">
                    {next && (
                      <Button size="sm" disabled={pending} onClick={() => advance(order)}>
                        <span>{t(`order.next.${next}` as TranslationKey)}</span>
                      </Button>
                    )}
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
                    {!isTerminal(order.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        className="ml-auto text-error hover:bg-error-light"
                        onClick={() => {
                          setCancelling(order);
                          setReason("");
                        }}
                      >
                        <span>{t("m.orders.cancel")}</span>
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <DeliveryFeeDialog
        order={feeFor}
        open={feeFor !== null}
        pending={pending}
        onClose={() => setFeeFor(null)}
        onConfirm={(fee) => {
          if (feeFor) advance(feeFor, fee);
        }}
      />

      {/* Cancelling requires a reason — the customer reads it. */}
      <Dialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={t("mo.cancelTitle")}
        description={cancelling?.reference}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCancelling(null)} disabled={pending}>
              <span>{t("common.cancel")}</span>
            </Button>
            <Button
              variant="danger"
              disabled={pending || reason.trim().length < 3}
              loading={pending}
              onClick={submitCancel}
            >
              <span>{t("m.orders.cancel")}</span>
            </Button>
          </>
        }
      >
        <Field
          label={t("m.orders.cancelReason")}
          htmlFor="cancel-reason"
          required
          hint={t("m.orders.cancelHint")}
        >
          <Textarea
            id="cancel-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </Dialog>
    </>
  );
}
