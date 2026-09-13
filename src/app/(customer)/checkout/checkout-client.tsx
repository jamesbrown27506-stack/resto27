"use client";
import { LocationButton } from "@/components/capacitor/location-button";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bike,
  Clock,
  Info,
  MapPin,
  Plus,
  ShoppingBag,
} from "lucide-react";
import { useCart } from "@/components/cart/cart-provider";
import { clearIdempotencyKey, currentIdempotencyKey } from "@/lib/orders/idempotency";
import { CartSummary } from "@/components/cart/cart-parts";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Radio, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  getRestaurantOrderCapabilities,
  placeOrder,
  type CheckoutInput,
} from "@/lib/data/checkout-actions";
import type { CustomerAddress } from "@/lib/data/customer";
import { formatMoney } from "@/lib/format/currency";
import type { OrderType } from "@/lib/format/order-status";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { SessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export function CheckoutClient({
  user,
  addresses,
  quartiers,
}: {
  user: SessionUser | null;
  addresses: CustomerAddress[];
  quartiers: string[];
}) {
  const router = useRouter();
  const { lines, totals, promoCode, loyaltyPointsUsed, clear } = useCart();
  const { toast } = useToast();
  const { t } = useLocale();

  /** Why placeOrder refused, as a sentence in the current language. */
  function reasonText(reason: string, detail?: string): string {
    switch (reason) {
      case "itemSoldOut":
        return t("cct.err.itemSoldOut", { dish: detail ?? "" });
      case "notEnoughStock":
        return t("cct.err.notEnoughStock", { dish: detail ?? "" });
      case "optionUnavailable":
        return t("cct.err.optionUnavailable", { option: detail ?? "" });
      case "belowMinimum":
        return t("cct.err.belowMinimum", { amount: formatMoney(Number(detail) || 0) });
      case "belowMinPoints":
        return t("cct.err.belowMinPoints", { points: detail ?? "" });
      default:
        return t(`cct.err.${reason}` as TranslationKey);
    }
  }

  const [type, setType] = useState<OrderType>("delivery");
  const [addressId, setAddressId] = useState(addresses.find((a) => a.isDefault)?.id ?? "");
  const [newAddress, setNewAddress] = useState(addresses.length === 0);
  const [deliveryName, setDeliveryName] = useState(user?.name ?? "");
  const [deliveryPhone, setDeliveryPhone] = useState(user?.phone ?? "");
  const [deliveryQuartier, setDeliveryQuartier] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryLandmark, setDeliveryLandmark] = useState("");
  const payment = "mobile_money" as const;
  const [schedule, setSchedule] = useState("asap");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);

  // The basket lives in localStorage, so the server could not tell us which
  // restaurant it belongs to — ask here, once, so a mode the kitchen does not
  // offer is disabled up front instead of rejected after the whole form.
  const cartRestaurantId = lines[0]?.restaurantId ?? null;
  const [caps, setCaps] = useState<{
    acceptsDelivery: boolean;
    acceptsPickup: boolean;
    quartier: string;
    deliveryEstimateMin: number;
    minimumOrder: number;
    /** The advertised delivery band (migration 0035). 0 = not declared. */
    minDeliveryFee: number;
    maxDeliveryFee: number;
  } | null>(null);

  useEffect(() => {
    if (!cartRestaurantId) return;
    let alive = true;
    getRestaurantOrderCapabilities(cartRestaurantId).then((c) => {
      if (alive) setCaps(c);
    });
    return () => {
      alive = false;
    };
  }, [cartRestaurantId]);

  // Adjusted during render rather than in an effect (same pattern as the
  // modifier sheet): once we know a mode is unavailable, the dead selection
  // must not survive — but setState inside an effect is a cascading render.
  const [knownCaps, setKnownCaps] = useState(caps);
  if (knownCaps !== caps) {
    setKnownCaps(caps);
    if (caps) {
      if (type === "delivery" && !caps.acceptsDelivery && caps.acceptsPickup) setType("pickup");
      else if (type === "pickup" && !caps.acceptsPickup && caps.acceptsDelivery) setType("delivery");
    }
  }

  if (lines.length === 0) {
    return (
      <div className="container-page w-full py-16">
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<ShoppingBag />}
            title={t("cct.empty")}
            description={t("cct.co.emptyBody")}
            action={
              <Link href="/browse" className={buttonClasses()}>
                {t("cct.browse")}
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const restaurant = lines[0];

  async function submit() {
    if (schedule === "later" && (!scheduleDate || !scheduleTime)) {
      toast(t("cct.co.scheduleRequired"), "error");
      return;
    }
    setPlacing(true);

    const chosen = addresses.find((a) => a.id === addressId);
    const input: CheckoutInput = {
      restaurantId: restaurant.restaurantId,
      type: type === "delivery" ? "delivery" : "pickup",
      lines: lines.map((line) => ({
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        optionIds: line.options.map((o) => o.optionId),
        notes: line.notes ?? null,
      })),
      addressId: type === "delivery" && !newAddress && chosen ? chosen.id : null,
      deliveryName: newAddress ? deliveryName : (chosen?.recipientName ?? deliveryName),
      deliveryPhone: newAddress ? deliveryPhone : (chosen?.phone ?? deliveryPhone),
      deliveryAddress: newAddress ? deliveryAddress : (chosen?.addressLine ?? deliveryAddress),
      deliveryQuartier: newAddress ? deliveryQuartier : (chosen?.quartier ?? deliveryQuartier),
      deliveryLandmark: newAddress ? deliveryLandmark : (chosen?.landmark ?? deliveryLandmark),
      promoCode: promoCode ?? null,
      loyaltyPoints: loyaltyPointsUsed,
      paymentMethod: payment,
      notes: notes.trim() || null,
      scheduledFor:
        schedule === "later"
          ? new Date(`${scheduleDate}T${scheduleTime}:00+01:00`).toISOString()
          : null,
      // Survives a reload, so a retry after a lost response returns the order
      // that already exists instead of placing a second one.
      idempotencyKey: currentIdempotencyKey(),
    };

    /*
      THE BUTTON STAYS DISABLED UNTIL THIS PAGE IS GONE.

      This used to call setPlacing(false) the moment placeOrder resolved, and
      only then router.push(). On a slow connection the push takes seconds, and
      for all of them the button was live again and showed no spinner — over an
      order that had already been placed. A second tap was a second real order.

      On success we therefore never re-enable: the navigation unmounts this
      component, which is the only correct end state. `placing` is cleared only
      on a path where the customer is still here and must be able to try again.
    */
    let result: Awaited<ReturnType<typeof placeOrder>>;
    try {
      result = await placeOrder(input);
    } catch {
      /*
        The request threw rather than returning — a dropped connection, which
        is routine here. Without this the promise rejected, setPlacing(false)
        never ran, and the button stayed disabled and spinning forever with no
        message at all.

        We cannot know whether the order was created, so the copy must not
        claim either way. Retrying is safe: the same key comes back and the
        server returns the original order rather than a duplicate.
      */
      setPlacing(false);
      toast(t("cct.co.networkFailed"), "error");
      return;
    }

    if (result.ok) {
      clearIdempotencyKey();
      clear();
      toast(t("cct.co.sent", { ref: result.reference }), "success");
      router.push(`/orders/${result.orderId}`);
      return;
    }

    setPlacing(false);
    toast(reasonText(result.reason, result.detail), "error");
  }

  return (
    <div className="container-page w-full py-8 lg:py-12">
      <Link
        href="/cart"
        className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t("cct.co.back")}
      </Link>

      <h1 className="mt-4 font-display text-3xl font-bold">{t("cct.co.title")}</h1>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          {/* ── Order type ─────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="font-display text-lg font-bold">{t("cct.co.how")}</h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["delivery", "pickup"] as OrderType[]).map((value) => {
                const Icon = value === "delivery" ? Bike : ShoppingBag;
                const unavailable =
                  caps !== null &&
                  (value === "delivery" ? !caps.acceptsDelivery : !caps.acceptsPickup);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={type === value}
                    disabled={unavailable}
                    onClick={() => setType(value)}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-md border p-4 transition-colors",
                      unavailable && "cursor-not-allowed opacity-50",
                      type === value
                        ? "border-primary bg-primary-light text-primary"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    <span className="text-sm font-semibold">
                      {t(value === "delivery" ? "cct.co.typeDelivery" : "cct.co.typePickup")}
                    </span>
                    <span className="text-xs text-text-light">
                      {value === "delivery"
                        ? caps && caps.deliveryEstimateMin > 0
                          ? t("cct.co.deliveryEst", { minutes: caps.deliveryEstimateMin })
                          : t("cct.co.deliveryHint")
                        : caps && caps.quartier
                          ? t("cct.co.pickupAt", { quartier: caps.quartier })
                          : t("cct.co.pickupHint")}
                    </span>
                  </button>
                );
              })}
            </div>
            {caps !== null && (!caps.acceptsDelivery || !caps.acceptsPickup) && (
              <p className="mt-3 text-xs text-text-light">
                {!caps.acceptsDelivery && t("cct.co.noDelivery")}{" "}
                {!caps.acceptsPickup && t("cct.co.noPickup")}
              </p>
            )}
          </section>

          {/* ── Address ────────────────────────────────────────────────── */}
          {type === "delivery" && (
            <section className="rounded-lg border border-border bg-surface p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold">{t("cct.co.address")}</h2>
                <Button variant="ghost" size="sm" onClick={() => setNewAddress((v) => !v)}>
                  <Plus className="size-3.5" aria-hidden />
                  {t("cct.co.useNew")}
                </Button>
              </div>

              {!newAddress ? (
                <div className="mt-4 flex flex-col gap-2">
                  {addresses.length === 0 ? (
                    <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-text-secondary">
                      {t("cct.co.noAddresses")}
                    </p>
                  ) : (
                    addresses.map((a) => (
                      <Radio
                        key={a.id}
                        name="address"
                        checked={addressId === a.id}
                        onChange={() => setAddressId(a.id)}
                        label={
                          <>
                            {a.label}
                            {a.isDefault && (
                              <Badge tone="neutral" className="ml-2">
                                {t("cct.co.default")}
                              </Badge>
                            )}
                          </>
                        }
                        description={`${a.addressLine} · ${a.quartier}${a.landmark ? ` · ${a.landmark}` : ""}`}
                      />
                    ))
                  )}
                </div>
              ) : (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field
                    label={t("cct.co.destinationName")}
                    htmlFor="ck-name"
                    required
                    className="sm:col-span-2"
                  >
                    <Input
                      id="ck-name"
                      value={deliveryName}
                      onChange={(e) => setDeliveryName(e.target.value)}
                    />
                  </Field>
                  <Field label={t("cct.co.phone")} htmlFor="ck-phone" required>
                    <Input
                      id="ck-phone"
                      type="tel"
                      value={deliveryPhone}
                      onChange={(e) => setDeliveryPhone(e.target.value)}
                    />
                  </Field>
                  {/*
                    A DATALIST, NOT A SELECT.

                    A closed list cannot express Douala. The seeded quartiers
                    are the well-known few, and a customer living anywhere
                    else had two options: abandon the order, or pick the
                    nearest wrong neighbourhood — which then decides the
                    delivery fee and where the rider is sent. Anything typed
                    is accepted and becomes a suggestion for the next person
                    (lib/data/quartiers).
                  */}
                  <Field
                    label={t("cct.co.quartier")}
                    htmlFor="ck-quartier"
                    required
                    hint={t("cct.co.quartierHint")}
                  >
                    <Input
                      id="ck-quartier"
                      list="ck-quartier-options"
                      autoComplete="off"
                      value={deliveryQuartier}
                      onChange={(e) => setDeliveryQuartier(e.target.value)}
                      placeholder={t("cct.co.quartierPh")}
                    />
                    <datalist id="ck-quartier-options">
                      {quartiers.map((q) => (
                        <option key={q} value={q} />
                      ))}
                    </datalist>
                  </Field>
                  {/*
                    ADDRESS AND LANDMARK ARE DIFFERENT QUESTIONS, and both
                    now say which. Two free-text boxes stacked with no
                    explanation read as the same question asked twice, so
                    people filled one and left the other empty — usually the
                    landmark, which is the one riders actually navigate by.
                  */}
                  <Field
                    label={t("cct.co.addressLine")}
                    htmlFor="ck-address"
                    required
                    hint={t("cct.co.addressHint")}
                    className="sm:col-span-2"
                  >
                    <Input
                      id="ck-address"
                      icon={<MapPin />}
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder={t("cct.co.addressPh")}
                    />
                  </Field>
                  <Field
                    label={t("cct.co.landmark")}
                    htmlFor="ck-landmark"
                    hint={t("cct.co.landmarkHint")}
                    className="sm:col-span-2"
                  >
                    <Input
                      id="ck-landmark"
                      value={deliveryLandmark}
                      onChange={(e) => setDeliveryLandmark(e.target.value)}
                      placeholder={t("cct.co.landmarkPh")}
                    />
                    <LocationButton value={deliveryLandmark} onChange={setDeliveryLandmark} />
                  </Field>
                </div>
              )}

              {/*
                §14.3 — the fee is quoted on confirmation, not now. Saying so
                here, before the total, is what stops it reading as a surprise
                charge later.

                And when the restaurant has declared a band (migration 0035),
                say the numbers. "The fee is set later" is honest but useless
                for budgeting; "between 1 000 and 3 000 FCFA" is what lets
                someone decide whether they can afford this order.
              */}
              <p className="mt-4 flex items-start gap-2.5 rounded-md border border-info/25 bg-info-light p-3 text-sm text-info">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {caps && (caps.minDeliveryFee > 0 || caps.maxDeliveryFee > 0)
                    ? caps.maxDeliveryFee > 0
                      ? t("cct.co.feeRange", {
                          min: formatMoney(caps.minDeliveryFee),
                          max: formatMoney(caps.maxDeliveryFee),
                        })
                      : t("cct.co.feeFrom", { min: formatMoney(caps.minDeliveryFee) })
                    : t("cct.co.feeNote")}
                </span>
              </p>
            </section>
          )}

          {/* ── Pickup contact ────────────────────────────────────────── */}
          {type === "pickup" && (
            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="font-display text-lg font-bold">{t("cct.co.contact")}</h2>
              {caps?.quartier ? (
                <p className="mt-1 text-sm text-text-secondary">
                  {t("cct.co.pickupWhere", {
                    restaurant: restaurant.restaurantName,
                    quartier: caps.quartier,
                  })}
                </p>
              ) : (
                <p className="mt-1 text-sm text-text-secondary">{t("cct.co.pickupNote")}</p>
              )}

              {/* The longest prep time across the basket is what a pickup
                  customer actually waits for. */}
              {(() => {
                const prep = Math.max(0, ...lines.map((l) => l.prepMinutes ?? 0));
                if (prep <= 0) return null;
                return (
                  <p className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
                    <Clock className="size-4 text-primary" aria-hidden />
                    {t("cct.co.pickupReady", { minutes: prep })}
                  </p>
                );
              })()}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label={t("cct.co.name")} htmlFor="ck-pu-name" required>
                  <Input
                    id="ck-pu-name"
                    value={deliveryName}
                    onChange={(e) => setDeliveryName(e.target.value)}
                  />
                </Field>
                <Field label={t("cct.co.phone")} htmlFor="ck-pu-phone" required>
                  <Input
                    id="ck-pu-phone"
                    type="tel"
                    value={deliveryPhone}
                    onChange={(e) => setDeliveryPhone(e.target.value)}
                  />
                </Field>
              </div>
            </section>
          )}

          {/* ── Schedule ───────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="font-display text-lg font-bold">{t("cct.co.when")}</h2>
            <div className="mt-4 flex flex-col gap-2">
              <Radio
                name="schedule"
                checked={schedule === "asap"}
                onChange={() => setSchedule("asap")}
                label={t("cct.co.asap")}
                description={t("cct.co.asapHint")}
              />
              <Radio
                name="schedule"
                checked={schedule === "later"}
                onChange={() => setSchedule("later")}
                label={t("cct.co.schedule")}
                description={t("cct.co.scheduleHint")}
              />
            </div>

            {schedule === "later" && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label={t("cct.co.date")} htmlFor="ck-date">
                  <Input
                    id="ck-date"
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                  />
                </Field>
                <Field label={t("cct.co.time")} htmlFor="ck-time">
                  <Input
                    id="ck-time"
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                  />
                </Field>
              </div>
            )}
          </section>

          {/* ── Payment ────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="font-display text-lg font-bold">{t("cct.co.payment")}</h2>
            <div className="mt-4 rounded-md border border-success/25 bg-success-light p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">Mobile Money</span>
                <Badge tone="success">{t("cct.co.payment")}</Badge>
              </div>
              <p className="mt-2 flex items-start gap-2 text-sm text-text-secondary">
                <Info className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <span>{t("cct.co.onlineSoon")}</span>
              </p>
            </div>
          </section>
          {/* ── Notes ─────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="font-display text-lg font-bold">{t("cct.co.notes")}</h2>
            <Textarea
              className="mt-4"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("cct.co.notesPh")}
              aria-label={t("cct.co.notes")}
            />
          </section>
        </div>

        {/* ── Summary ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-24">
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="font-display font-bold">{restaurant.restaurantName}</p>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {lines.map((line) => (
                <li key={line.id} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    <span className="tnum font-medium">{line.quantity}×</span> {line.name}
                    {line.options.length > 0 && (
                      <span className="block text-xs text-text-light">
                        {line.options.map((o) => o.optionName).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="tnum shrink-0 text-text-secondary">
                    {formatMoney(
                      (line.basePrice + line.options.reduce((s, o) => s + o.priceDelta, 0)) *
                        line.quantity,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Below the minimum, say so BEFORE the customer commits — the
              basket can't be submitted yet, and a surprise at the last click
              is how baskets get abandoned. */}
          {caps && caps.minimumOrder > 0 && totals.subtotal < caps.minimumOrder && (
            <p className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs leading-relaxed text-warning">
              {t("cct.co.belowMinHint", {
                amount: formatMoney(caps.minimumOrder - totals.subtotal),
              })}
            </p>
          )}

          <CartSummary showDeliveryFee={type === "delivery"}>
            <Button
              size="lg"
              fullWidth
              loading={placing}
              onClick={submit}
              className="rounded-md"
            >
              {t("cct.co.place", { total: formatMoney(totals.total) })}
            </Button>
            <p className="mt-3 text-center text-xs leading-relaxed text-text-light">
              {t("cct.co.terms1")}{" "}
              <Link href="/terms" className="font-medium text-primary hover:underline">
                {t("cct.co.termsLink")}
              </Link>
              .
            </p>
          </CartSummary>
        </div>
      </div>
    </div>
  );
}
