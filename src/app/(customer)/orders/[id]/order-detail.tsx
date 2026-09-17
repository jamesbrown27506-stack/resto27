"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MapPin, PackageCheck, Phone, RotateCcw, Star, X } from "lucide-react";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { OrderReceipt, OrderStatusTimeline } from "@/components/order/order-parts";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { PaymentPendingView } from "@/components/payment/payment-pending";
import { RatingInput } from "@/components/ui/rating-stars";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format/currency";
import { formatDateTime, isoAttr } from "@/lib/format/datetime";
import { canCustomerCancel } from "@/lib/format/order-status";
import {
  cancelOwnOrder,
  checkOwnOrderPayment,
  payOwnOrder,
  payOwnOrderWithWallet,
  confirmOwnDelivery,
  rateOwnDelivery,
  submitOwnReview,
  uploadReviewPhoto,
} from "@/lib/data/customer-actions";
import { intlLocale, useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { CustomerOrder as Order } from "@/lib/data/customer";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";
import { PICKUP_RECEIPT_CONFIRMATION_NOTE } from "@/lib/orders/pickup-receipt";

/**
 * /orders/[id] — "the busiest page in the app" (§14.3).
 *
 * Receipt, live status timeline, cancel while allowed, reorder, review, the
 * manager's reply, and the delivery rating. The cancel control appears only in
 * states where the server will actually accept it (§4) — offering a button
 * that 403s is worse than not offering one.
 */
export function OrderDetail({ order }: { order: Order }) {
  const { toast } = useToast();
  const { locale, t } = useLocale();
  const dates = intlLocale(locale);
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deliveryRating, setDeliveryRating] = useState(order.deliveryRating ?? 0);
  const [paymentPhone, setPaymentPhone] = useState(order.deliveryPhone ?? "");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentAttemptId, setPaymentAttemptId] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInstruction, setPaymentInstruction] = useState<PaymentInstruction | null>(null);

  const cancellable = canCustomerCancel(order.status);

  /**
   * The customer can close their own order once it is out for delivery.
   *
   * `shipped` is the only state where this makes sense: before it the food
   * has not left, and after it the order is already closed. See
   * confirmOwnDelivery for why the person holding the bag is the right one
   * to press this.
   */
  const pickupReceiptRequested =
    order.type === "pickup" &&
    order.history.some(
      (event) => event.status === "shipped" && event.note === PICKUP_RECEIPT_CONFIRMATION_NOTE,
    );
  const confirmable =
    order.status === "shipped" && (order.type !== "pickup" || pickupReceiptRequested);


  /*
    THIS PAGE STAYS LIVE WHILE THE ORDER DOES. Checkout sends people here,
    the push deep-links here, and the fee-approval card only exists here —
    a screen that renders once and goes stale left both sides waiting on
    each other whenever a push was missed. Same cadence as the manager
    screens; stops the moment the order reaches a terminal state.
  */
  const live = order.status !== "delivered" && order.status !== "cancelled";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.refresh(), 15_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, router]);


  const canPay =
    !order.isPaid &&
    order.status === "awaiting_customer" &&
    (order.paymentMethod === "mobile_money" || order.paymentMethod === "wallet");

  async function startOrderPayment() {
    setPaymentBusy(true);
    setPaymentInstruction(null);
    const result =
      order.paymentMethod === "wallet"
        ? await payOwnOrderWithWallet(order.id)
        : await payOwnOrder(order.id, paymentPhone);
    setPaymentBusy(false);
    if (!result.ok) return toast(result.error, "error");
    if (result.status === "succeeded") {
      toast(t("cor.paymentDone"), "success");
      router.refresh();
      return;
    }
    if ("attemptId" in result && result.attemptId) {
      if ("instruction" in result && result.instruction) setPaymentInstruction(result.instruction);
      setPaymentAttemptId(result.attemptId);
      setPaymentOpen(true);
    }
  }

  useEffect(() => {
    if (!paymentAttemptId) return;
    let checking = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (checking) return;
      checking = true;
      try {
        const result = await checkOwnOrderPayment(paymentAttemptId);
        if (result.instruction) setPaymentInstruction(result.instruction);
        if (result.status === "succeeded") {
          if (timer) clearInterval(timer);
          setPaymentAttemptId(null);
          setPaymentOpen(false);
          toast(t("cor.paymentDone"), "success");
          router.refresh();
        } else if (!result.ok || result.status === "failed") {
          if (timer) clearInterval(timer);
          setPaymentAttemptId(null);
          setPaymentOpen(false);
          toast(result.ok ? t("cor.paymentFailed") : result.error, "error");
          router.refresh();
        }
      } finally {
        checking = false;
      }
    };
    timer = setInterval(() => void tick(), 4_000);
    void tick();
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [paymentAttemptId, router, t, toast]);
  async function confirmReceived() {
    setConfirming(true);
    const result = await confirmOwnDelivery(order.id);
    setConfirming(false);
    toast(result.ok ? t("cor.receivedDone") : result.error, result.ok ? "success" : "error");
    if (result.ok) router.refresh();
  }

  async function confirmCancel() {
    setCancelOpen(false);
    setBusy(true);
    const result = await cancelOwnOrder(order.id);
    setBusy(false);
    toast(result.ok ? t("cor.cancelled") : result.error, result.ok ? "success" : "error");
  }

  async function addPhotos(files: FileList | null) {
    if (!files || photos.length >= 3) return;
    setUploading(true);
    const added: string[] = [];
    for (const file of Array.from(files).slice(0, 3 - photos.length)) {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadReviewPhoto(formData);
      if (result.ok && result.url) added.push(result.url);
      else toast(result.error ?? t("cor.photoRejected"), "error");
    }
    setPhotos((current) => [...current, ...added].slice(0, 3));
    setUploading(false);
  }

  async function publishReview() {
    setBusy(true);
    const result = await submitOwnReview(order.id, rating, body, photos);
    setBusy(false);
    if (result.ok) {
      setReviewOpen(false);
      setBody("");
      setPhotos([]);
      toast(t("cor.reviewPublished"), "success");
    } else {
      toast(result.error, "error");
    }
  }

  async function rateDelivery(value: number) {
    setDeliveryRating(value);
    const result = await rateOwnDelivery(order.id, value);
    toast(
      result.ok ? t("cor.thanksFeedback") : result.error,
      result.ok ? "success" : "error",
    );
  }

  return (
    <div className="container-page w-full py-8 lg:py-12">
      <Link
        href="/orders"
        className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t("cor.title")}
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold">{order.restaurantName}</h1>
            <OrderStatusBadge status={order.status} type={order.type} />
          </div>
          <p className="tnum mt-1 text-sm text-text-secondary">
            <span translate="no">{order.reference}</span> ·{" "}
            {t(`cor.type.${order.type}` as TranslationKey)} ·{" "}
            <time dateTime={isoAttr(order.createdAt)}>
              {formatDateTime(order.createdAt, dates)}
            </time>
          </p>
          {order.scheduledFor && (
            <p className="tnum mt-1 text-sm font-medium text-primary">
              {t("cor.scheduledFor")}{" "}
              <time dateTime={isoAttr(order.scheduledFor)}>
                {formatDateTime(order.scheduledFor, dates)}
              </time>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/restaurants/${order.restaurantSlug}`}
            className={buttonClasses({ variant: "outline", size: "sm" })}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {t("cor.reorder2")}
          </Link>
          {cancellable && (
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
              <X className="size-3.5" aria-hidden />
              {t("cor.cancelShort")}
            </Button>
          )}
        </div>
      </header>

      {/*
        ────────────────────────────────────────────────────────────────────
         "DID YOU GET IT?" — ASKED WHERE IT CANNOT BE MISSED.

         `delivered` used to be the restaurant's word alone, which meant it
         was a guess: the kitchen does not know when the rider arrived. It
         also gates the customer's own loyalty points and their review, so
         an order left open in `shipped` quietly withholds both.

         Deliberately NOT a small button in the header row beside "reorder"
         and "cancel". It is the single thing this page wants from the
         customer while the food is in transit, so it gets a card of its own
         above everything else, in success colours rather than error ones —
         this is a good-news confirmation, not a warning.
        ────────────────────────────────────────────────────────────────────
      */}
      {/*
        ────────────────────────────────────────────────────────────────────
         THE DELIVERY FEE, PUT TO THE CUSTOMER (0040).

         A delivery order is placed before anyone knows what delivering it
         costs. The restaurant quotes the fee afterwards, and that raises the
         total this customer already agreed to — so it is a question, not a
         notification.

         Nothing is cooking while this is on screen. Before this state
         existed, quoting a fee confirmed the order and started the kitchen in
         the same move, so a customer refusing the price was refusing food
         that had already been made.

         Same treatment as "did you get it?" below and for the same reason:
         the one thing the page wants from the customer gets a card of its
         own, not a button in the header row. Warning colours, because it is a
         decision with a deadline rather than good news — and BOTH answers are
         given equal weight, since a decline is a legitimate outcome and not
         an error.
        ────────────────────────────────────────────────────────────────────
      */}
      {order.status === "awaiting_customer" && (
        <div className="mt-6 rounded-lg border-2 border-info/35 bg-info-light p-4">
          <p className="font-semibold text-info">{t("cor.paymentRequired")}</p>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            {t("ost.desc.awaiting_customer")}
          </p>
          {order.type === "delivery" && (
            <p className="tnum mt-3 border-t border-info/20 pt-3 text-sm text-text-secondary">
              {t("cor.feeAmount")}: <span className="font-semibold text-text">{formatMoney(order.deliveryFee)}</span>
            </p>
          )}
        </div>
      )}

      {canPay && (
        <div className="mt-6 rounded-lg border-2 border-info/35 bg-info-light p-4">
          <p className="font-semibold text-info">{t("cor.paymentRequired")}</p>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            {t("cor.paymentRequiredBody")}
          </p>
          {order.paymentMethod === "mobile_money" ? (
            <div className="mt-4 grid items-end gap-3 sm:grid-cols-[1fr_auto]">
              <Field label={t("cor.paymentPhone")} htmlFor="order-payment-phone" required>
                <Input
                  id="order-payment-phone"
                  type="tel"
                  inputMode="tel"
                  value={paymentPhone}
                  onChange={(event) => setPaymentPhone(event.target.value)}
                />
              </Field>
              <Button
                loading={paymentBusy}
                disabled={paymentBusy || !paymentPhone.trim()}
                onClick={() => void startOrderPayment()}
                className="min-h-11"
              >
                {t("cor.payNow")}
              </Button>
            </div>
          ) : (
            <Button
              loading={paymentBusy}
              disabled={paymentBusy}
              onClick={() => void startOrderPayment()}
              className="mt-4 min-h-11"
            >
              {t("cor.payNow")}
            </Button>
          )}
        </div>
      )}
      {confirmable && (
        <div className="mt-6 flex flex-wrap items-center gap-4 rounded-lg border-2 border-success/40 bg-success-light p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success text-white">
            <PackageCheck className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-success">
              {t(order.type === "pickup" ? "cor.pickupReceiptTitle" : "cor.receivedTitle")}
            </p>
            <p className="mt-0.5 text-sm text-text-secondary">
              {t(order.type === "pickup" ? "cor.pickupReceiptBody" : "cor.receivedBody")}
            </p>
          </div>
          <Button
            variant="primary"
            loading={confirming}
            disabled={confirming}
            onClick={confirmReceived}
            className="max-sm:w-full"
          >
            {t(order.type === "pickup" ? "cor.pickupReceiptAction" : "cor.receivedAction")}
          </Button>
        </div>
      )}

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardBody>
              <CardTitle>{t("cor.progress")}</CardTitle>
              <div className="mt-5">
                <OrderStatusTimeline status={order.status} type={order.type} history={order.history} />
              </div>
            </CardBody>
          </Card>

          {order.status === "delivered" && (
            <Card>
              <CardBody>
                <CardTitle>{t("cor.review")}</CardTitle>
                <p className="mt-1 text-sm text-text-secondary">
                  {t("cor.reviewBody")}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <Button onClick={() => setReviewOpen(true)}>
                    <Star className="size-4" aria-hidden />
                    {t("cor.rateRestaurant")}
                  </Button>
                </div>

                {order.type === "delivery" && (
                  <div className="mt-5 border-t border-border pt-5">
                    <p className="text-sm font-semibold">{t("cor.deliveryQuestion")}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <RatingInput
                        name="delivery-rating"
                        value={deliveryRating}
                        onChange={rateDelivery}
                        size="md"
                      />
                      {deliveryRating > 0 && (
                        <span className="text-sm text-text-secondary">{t("cor.thanks")}</span>
                      )}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody>
              <CardTitle>{t("cor.detail")}</CardTitle>
              <div className="mt-4">
                <OrderReceipt order={order} />
              </div>
            </CardBody>
          </Card>
        </div>

        <aside className="flex flex-col gap-5 lg:sticky lg:top-24">
          {order.type === "delivery" && order.deliveryAddress && (
            <Card>
              <CardBody>
                <CardTitle>{t("cor.deliveryCard")}</CardTitle>
                {/*
                  These fields are the SNAPSHOT copied onto the order (§3), not
                  a lookup into customer_addresses. Editing the saved address
                  later must not rewrite what this order said.
                */}
                <address className="mt-3 flex flex-col gap-2 text-sm not-italic">
                  <span className="font-medium">{order.deliveryName}</span>
                  <span className="flex items-start gap-2 text-text-secondary">
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                    <span>
                      {order.deliveryAddress}
                      <span className="block">{order.deliveryQuartier}</span>
                      {order.deliveryLandmark && (
                        <span className="block text-text-light">{order.deliveryLandmark}</span>
                      )}
                    </span>
                  </span>
                  {order.deliveryPhone && (
                    <a
                      href={`tel:${order.deliveryPhone.replace(/\s/g, "")}`}
                      className="flex items-center gap-2 text-text-secondary hover:text-primary"
                    >
                      <Phone className="size-3.5 shrink-0 text-primary" aria-hidden />
                      {order.deliveryPhone}
                    </a>
                  )}
                </address>
              </CardBody>
            </Card>
          )}

          {order.tableNumber && (
            <Card>
              <CardBody>
                <CardTitle>{t("cor.table")}</CardTitle>
                <p className="tnum mt-2 font-display text-2xl font-bold">{order.tableNumber}</p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody>
              <CardTitle>{t("cor.payment")}</CardTitle>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-text-secondary">
                  {t(`cor.pay.${order.paymentMethod}` as TranslationKey)}
                </span>
                <Badge tone={order.isPaid ? "success" : "warning"}>
                  {t(order.isPaid ? "cor.paid" : "cor.unpaid")}
                </Badge>
              </div>
            </CardBody>
          </Card>

          {order.notes && (
            <Card>
              <CardBody>
                <CardTitle>{t("cor.yourNotes")}</CardTitle>
                <p className="mt-2 text-sm text-text-secondary italic">« {order.notes} »</p>
              </CardBody>
            </Card>
          )}

          {order.cancelledReason && (
            <Card className="border-error/30 bg-error-light">
              <CardBody>
                <CardTitle className="text-error">{t("cor.cancelReason")}</CardTitle>
                <p className="mt-2 text-sm text-text-secondary">{order.cancelledReason}</p>
              </CardBody>
            </Card>
          )}
        </aside>
      </div>

      <Dialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        title={t("cor.paymentPendingTitle")}
        size="sm"
        footer={
          <Button variant="outline" onClick={() => setPaymentOpen(false)}>
            {t("cor.paymentBackground")}
          </Button>
        }
      >
        <PaymentPendingView
          body={t("cor.paymentPendingBody")}
          hint={t("cor.paymentPendingHint")}
          amountLabel={t("cor.total")}
          amount={formatMoney(order.total)}
          referenceLabel={t("cor.paymentReference")}
          reference={order.reference}
          phoneLabel={t("cor.paymentPhone")}
          phone={paymentPhone}
          gatewayLabel={t("cor.paymentGateway")}
          instruction={paymentInstruction}
          requesting={paymentBusy && !paymentAttemptId}
        />
      </Dialog>
      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={confirmCancel}
        title={t("cor.cancelTitle")}
        message={t("cor.cancelBody2")}
        confirmLabel={t("cor.cancelConfirm")}
        cancelLabel={t("cor.cancelKeepMine")}
        destructive
      />

      <Dialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title={t("cor.rateRestaurant")}
        description={order.restaurantName}
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={body.trim().length < 10 || busy}
              onClick={publishReview}
            >
              {t("cor.publish")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold">{t("cor.rating")}</p>
            <RatingInput name="review-rating" value={rating} onChange={setRating} />
          </div>
          <div>
            <label htmlFor="review-body" className="mb-2 block text-sm font-semibold">
              {t("cor.comment")}
            </label>
            <Textarea
              id="review-body"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("cor.commentPh")}
            />
            <p className="mt-1.5 text-xs text-text-light">
              {t("cor.commentHint")}
            </p>
          </div>

          <div>
            <label htmlFor="review-photos" className="mb-2 block text-sm font-semibold">
              {t("cor.photos")}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {photos.map((url) => (
                <span key={url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={t("cor.photoAlt")}
                    className="size-16 rounded-md border border-border object-cover"
                  />
                  <button
                    type="button"
                    aria-label={t("cor.photoRemove")}
                    onClick={() => setPhotos((current) => current.filter((p) => p !== url))}
                    className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-text/70 text-white hover:bg-error"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
              {photos.length < 3 && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs font-medium text-text-secondary hover:border-primary hover:text-primary">
                  <Star className="size-3.5" aria-hidden />
                  <span>{t(uploading ? "cor.photoUploading" : "cor.photoAdd")}</span>
                  <input
                    id="review-photos"
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    multiple
                    className="sr-only"
                    disabled={uploading || busy}
                    onChange={(e) => {
                      void addPhotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
            <p className="mt-1.5 text-xs text-text-light">{t("cor.photoHint")}</p>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
