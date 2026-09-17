"use client";

import { useState, useTransition } from "react";
import { Clock } from "lucide-react";
import { DeliveryFeeDialog } from "@/components/order/delivery-fee-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { advanceLabelKey, isTerminal, nextStatus } from "@/lib/format/order-status";
import { advanceOrder, cancelOrder, requestPickupReceiptConfirmation } from "@/lib/data/order-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { ManagerOrder } from "@/lib/data/orders";
import { cn } from "@/lib/utils";

/**
 * Everything the restaurant can DO to one order: advance it a step, quote the
 * delivery fee when that is what advancing means, or cancel it with a reason.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS IS A COMPONENT AND NOT A COPY.
 *
 *  These controls lived only on the queue. The order detail screen was
 *  deliberately read-only — and then push notifications started deep-linking
 *  to it, so the most urgent screen in the product was the one you could not
 *  act on. A manager woken by "new order" landed on the details and had to
 *  navigate back to the queue to accept it.
 *
 *  The obvious fix is to paste the buttons onto the detail page. That is how
 *  the fee gate ends up enforced in one place and not the other. So the
 *  cluster moved here whole, and both screens render the same instance of it.
 *
 *  THE RULES IT CARRIES WITH IT:
 *
 *   · THE FEE GATE (§14.4). A delivery order cannot reach `confirmed` without
 *     a quoted fee. This is the UI half; `advanceOrder` re-checks server-side,
 *     so there is no path that skips the quote — but the dialog is what stops
 *     a manager being refused AFTER they pressed confirm.
 *   · `nextStatus()` IS THE ONLY SOURCE for which button to draw, so the UI
 *     can never offer a transition the state machine will refuse. The server
 *     re-derives the transition from the current row anyway, so two taps
 *     racing on one ticket cannot double-skip.
 *   · `awaiting_customer` HAS NO ADVANCE BUTTON, on purpose — the only way out
 *     is the customer accepting or declining the fee. What renders instead is
 *     the notice telling the kitchen not to start, because a missing button
 *     with no explanation is read as a broken screen.
 *   · `canAdvance` mirrors the `orders.advance` capability that both server
 *     actions re-check. A waiter sees no buttons rather than buttons that
 *     fail.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Deliberately a `Pick` rather than `ManagerOrder`, mirroring why the fee
 * dialog takes a `FeeTarget`: this component must be renderable from any
 * screen that can name these seven fields, and widening it to the full row
 * would tie the detail page's fetch shape to the queue's.
 */
export type OrderActionTarget = Pick<
  ManagerOrder,
  | "id"
  | "reference"
  | "status"
  | "type"
  | "total"
  | "deliveryFeeSetAt"
  | "deliveryQuartier"
  | "deliveryAddress"
  // The landmark is how a rider actually finds a door in Douala, and the fee
  // dialog shows it while the manager decides what to charge.
  | "deliveryLandmark"
  // Payment first: an unpaid Mobile Money order shows a notice, not a button.
  | "isPaid"
  | "paymentMethod"
>;

export function OrderActionBar({
  order,
  canAdvance,
  feeBand,
  size = "sm",
  className,
  children,
}: {
  order: OrderActionTarget;
  /** `orders.advance`. False hides both buttons; the notice still shows. */
  canAdvance: boolean;
  /** The restaurant's advertised delivery band (migration 0035). */
  feeBand?: { min: number; max: number };
  /** `sm` in the dense queue row, `md` on the roomier detail card. */
  size?: "sm" | "md";
  className?: string;
  /** Screen-specific extras — the queue's Detail and Ticket links. */
  children?: React.ReactNode;
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [feeOpen, setFeeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pickupRequestSent, setPickupRequestSent] = useState(false);

  const next = nextStatus(order.status);
  /*
    The button's WORDS depend on the order type, not just the transition.
    preparing -> shipped is one move that reads "Envoyer" for a delivery and
    "Prête à retirer" for a takeaway, because it is one promise to a rider and
    a different one to someone walking to a counter.
  */
  const nextLabel = advanceLabelKey(order.status, order.type);

  /*
    PAYMENT FIRST. An unpaid Mobile Money order is waiting on the customer,
    and `advanceOrder` refuses every step until the money lands — except
    quoting a delivery fee, because the customer cannot pay a total nobody has
    priced. So that one button stays; every other advance becomes a notice
    instead of a button the server would refuse after it was pressed.
  */
  const blockedByPayment =
    order.status === "awaiting_customer" && !order.isPaid && !isTerminal(order.status);
  const needsPickupConfirmation = order.type === "pickup" && order.status === "shipped";

  function advance(fee?: number) {
    if (!next) return;

    // The gate. A delivery order cannot reach `confirmed` without a fee.
    if (
      next === "awaiting_customer" &&
      order.type === "delivery" &&
      order.deliveryFeeSetAt === null &&
      fee === undefined
    ) {
      setFeeOpen(true);
      return;
    }

    startTransition(async () => {
      const result = await advanceOrder(order.id, fee !== undefined ? { deliveryFee: fee } : {});
      setFeeOpen(false);
      if (!result.ok) return toast(result.error, "error");

      /*
        A quoted fee does not confirm the order any more — it parks it at
        `awaiting_customer` until the customer accepts (0040). Saying
        "updated" there would tell the kitchen it may start, which is the one
        thing that state exists to prevent.
      */
      toast(
        result.status === "awaiting_customer" ? t("oact.sentToCustomer") : t("mo.updated"),
        result.status === "awaiting_customer" ? "info" : "success",
      );
    });
  }

  function requestPickupConfirmation() {
    startTransition(async () => {
      const result = await requestPickupReceiptConfirmation(order.id);
      if (!result.ok) return toast(result.error, "error");
      setPickupRequestSent(true);
      toast(t("oact.pickupConfirmationSent"), "success");
    });
  }

  function submitCancel() {
    startTransition(async () => {
      const result = await cancelOrder(order.id, reason);
      if (!result.ok) return toast(result.error, "error");
      setCancelOpen(false);
      setReason("");
      toast(t("mo.cancelled"), "success");
    });
  }

  return (
    <>
      {/*
        The explanation for a missing button belongs WITH the buttons, which is
        why this sits inside the cluster rather than above it.
      */}
      {order.status === "awaiting_customer" && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-light px-3 py-2 text-xs leading-relaxed text-warning">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <strong>{t("mo.awaitingCustomer")}</strong> {t("mo.awaitingCustomerBody")}
          </span>
        </p>
      )}

      {needsPickupConfirmation && pickupRequestSent && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-info/30 bg-info-light px-3 py-2 text-xs leading-relaxed text-info">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{t("oact.pickupConfirmationPending")}</span>
        </p>
      )}

      {blockedByPayment && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-info/30 bg-info-light px-3 py-2 text-xs leading-relaxed text-info">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <strong>{t("mo.awaitingPayment")}</strong> {t("mo.awaitingPaymentBody")}
          </span>
        </p>
      )}

      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        {canAdvance && next && nextLabel && !blockedByPayment && !pickupRequestSent && (
          <Button
            size={size}
            disabled={pending}
            onClick={() => (needsPickupConfirmation ? requestPickupConfirmation() : advance())}
          >
            <span>{needsPickupConfirmation ? t("oact.requestPickupConfirmation") : t(nextLabel)}</span>
          </Button>
        )}

        {children}

        {canAdvance && !isTerminal(order.status) && (
          <Button
            variant="ghost"
            size={size}
            disabled={pending}
            className="ml-auto text-error hover:bg-error-light"
            onClick={() => {
              setCancelOpen(true);
              setReason("");
            }}
          >
            <span>{t("mo.cancelTitle")}</span>
          </Button>
        )}
      </div>

      {/*
        ALWAYS MOUNTED, NEVER `{feeOpen && …}`.

        DeliveryFeeDialog pre-fills the advertised minimum with a render-phase
        reset that compares the last session key against the current one.
        Mounting it only while open initialises both to the same value on the
        first render, the prefill never fires, and the field paints empty — a
        silent regression of the migration-0035 band with nothing to catch it.
      */}
      <DeliveryFeeDialog
        order={feeOpen ? order : null}
        open={feeOpen}
        pending={pending}
        band={feeBand}
        onClose={() => setFeeOpen(false)}
        onConfirm={(fee) => advance(fee)}
      />

      {/*
        CONDITIONALLY MOUNTED, and this one has to be.

        The queue renders one of these per row. A hundred always-mounted
        cancel dialogs is a hundred hidden <dialog> elements, every one of them
        carrying the same `id="dialog-title"` from dialog.tsx — invalid
        document-wide, and it breaks the aria-labelledby every dialog relies
        on. The fee dialog above can afford to stay mounted because there is
        one meaningful reason it must; this one has none.
      */}
      {cancelOpen && (
        <Dialog
          open
          onClose={() => setCancelOpen(false)}
          title={t("mo.cancelTitle")}
          description={order.reference}
          size="sm"
          footer={
            <>
              <Button variant="outline" className="whitespace-normal text-center leading-snug" onClick={() => setCancelOpen(false)} disabled={pending}>
                <span>{t("mo.keepOrder")}</span>
              </Button>
              <Button
                variant="danger"
                className="whitespace-normal text-center leading-snug"
                disabled={pending || reason.trim().length < 3}
                loading={pending}
                onClick={submitCancel}
              >
                <span>{t("mo.cancelTitle")}</span>
              </Button>
            </>
          }
        >
          <Field
            label={t("m.orders.cancelReason")}
            // Per-order, because the queue can mount several of these over the
            // life of the page and a duplicated id points every label at the
            // first textarea on the screen.
            htmlFor={`cancel-reason-${order.id}`}
            required
            hint={t("m.orders.cancelHint")}
          >
            <Textarea
              id={`cancel-reason-${order.id}`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </Dialog>
      )}
    </>
  );
}
