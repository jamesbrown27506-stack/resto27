"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, MapPin, Phone, RotateCcw, Star, X } from "lucide-react";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { OrderReceipt, OrderStatusTimeline } from "@/components/order/order-parts";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { RatingInput } from "@/components/ui/rating-stars";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, isoAttr } from "@/lib/format/datetime";
import {
  ORDER_TYPE_LABEL,
  PAYMENT_METHOD_LABEL,
  canCustomerCancel,
  type PaymentMethod,
} from "@/lib/format/order-status";
import { cancelOwnOrder, rateOwnDelivery, submitOwnReview } from "@/lib/data/customer-actions";
import type { CustomerOrder as Order } from "@/lib/data/customer";

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
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [deliveryRating, setDeliveryRating] = useState(order.deliveryRating ?? 0);

  const cancellable = canCustomerCancel(order.status);

  async function confirmCancel() {
    setCancelOpen(false);
    setBusy(true);
    const result = await cancelOwnOrder(order.id);
    setBusy(false);
    toast(result.ok ? "Commande annulée." : result.error, result.ok ? "success" : "error");
  }

  async function publishReview() {
    setBusy(true);
    const result = await submitOwnReview(order.id, rating, body);
    setBusy(false);
    if (result.ok) {
      setReviewOpen(false);
      setBody("");
      toast("Merci, votre avis est publié.", "success");
    } else {
      toast(result.error, "error");
    }
  }

  async function rateDelivery(value: number) {
    setDeliveryRating(value);
    const result = await rateOwnDelivery(order.id, value);
    toast(
      result.ok ? "Merci pour votre retour." : result.error,
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
        Mes commandes
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold">{order.restaurantName}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="tnum mt-1 text-sm text-text-secondary">
            {order.reference} · {ORDER_TYPE_LABEL[order.type]} ·{" "}
            <time dateTime={isoAttr(order.createdAt)}>{formatDateTime(order.createdAt)}</time>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/browse/${order.restaurantSlug}`}
            className={buttonClasses({ variant: "outline", size: "sm" })}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Recommander
          </Link>
          {cancellable && (
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
              <X className="size-3.5" aria-hidden />
              Annuler
            </Button>
          )}
        </div>
      </header>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardBody>
              <CardTitle>Suivi</CardTitle>
              <div className="mt-5">
                <OrderStatusTimeline status={order.status} history={order.history} />
              </div>
            </CardBody>
          </Card>

          {order.status === "delivered" && (
            <Card>
              <CardBody>
                <CardTitle>Votre avis</CardTitle>
                <p className="mt-1 text-sm text-text-secondary">
                  Aidez les autres clients — et le restaurant — avec un retour honnête.
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <Button onClick={() => setReviewOpen(true)}>
                    <Star className="size-4" aria-hidden />
                    Noter le restaurant
                  </Button>
                </div>

                {order.type === "delivery" && (
                  <div className="mt-5 border-t border-border pt-5">
                    <p className="text-sm font-semibold">Comment s&apos;est passée la livraison ?</p>
                    <div className="mt-2 flex items-center gap-3">
                      <RatingInput
                        name="delivery-rating"
                        value={deliveryRating}
                        onChange={rateDelivery}
                        size="md"
                      />
                      {deliveryRating > 0 && (
                        <span className="text-sm text-text-secondary">Merci !</span>
                      )}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody>
              <CardTitle>Détail de la commande</CardTitle>
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
                <CardTitle>Livraison</CardTitle>
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
                <CardTitle>Table</CardTitle>
                <p className="tnum mt-2 font-display text-2xl font-bold">{order.tableNumber}</p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody>
              <CardTitle>Paiement</CardTitle>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-text-secondary">
                  {PAYMENT_METHOD_LABEL[order.paymentMethod as PaymentMethod] ?? "Mobile Money"}
                </span>
                <Badge tone={order.isPaid ? "success" : "warning"}>
                  {order.isPaid ? "Réglée" : "À régler"}
                </Badge>
              </div>
            </CardBody>
          </Card>

          {order.notes && (
            <Card>
              <CardBody>
                <CardTitle>Vos instructions</CardTitle>
                <p className="mt-2 text-sm text-text-secondary italic">« {order.notes} »</p>
              </CardBody>
            </Card>
          )}

          {order.cancelledReason && (
            <Card className="border-error/30 bg-error-light">
              <CardBody>
                <CardTitle className="text-error">Motif de l&apos;annulation</CardTitle>
                <p className="mt-2 text-sm text-text-secondary">{order.cancelledReason}</p>
              </CardBody>
            </Card>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={confirmCancel}
        title="Annuler cette commande ?"
        message="Le restaurant en sera informé immédiatement. Cette action est définitive."
        confirmLabel="Annuler la commande"
        cancelLabel="Garder ma commande"
        destructive
      />

      <Dialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Noter le restaurant"
        description={order.restaurantName}
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              Annuler
            </Button>
            <Button
              disabled={body.trim().length < 10 || busy}
              onClick={publishReview}
            >
              Publier
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold">Votre note</p>
            <RatingInput name="review-rating" value={rating} onChange={setRating} />
          </div>
          <div>
            <label htmlFor="review-body" className="mb-2 block text-sm font-semibold">
              Votre commentaire
            </label>
            <Textarea
              id="review-body"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Qualité, portions, délai de livraison…"
            />
            <p className="mt-1.5 text-xs text-text-light">
              Minimum 10 caractères. Votre avis est public sous votre nom.
            </p>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
