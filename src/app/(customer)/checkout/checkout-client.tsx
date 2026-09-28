"use client";
import { todayInDisplayTz } from "@/lib/reservations/slots";
import { lastBookableDate } from "@/lib/reservations/rules";
import { LocationButton } from "@/components/capacitor/location-button";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bike,
  ChevronUp,
  Clock,
  Info,
  MapPin,
  Plus,
  ShoppingBag,
  Smartphone,
  WalletCards,
} from "lucide-react";
import { useCart } from "@/components/cart/cart-provider";
import { clearIdempotencyKey, currentIdempotencyKey } from "@/lib/orders/idempotency";
import { CartSummary } from "@/components/cart/cart-parts";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Field, Input, Radio, Textarea } from "@/components/ui/input";
import { isSameAddress } from "@/lib/orders/address-match";
// The pure rules module, not the gateway client: it has no server imports, so
// the browser checks a number with exactly the rule CamerPay will apply.
import { normalisePhone } from "@/lib/payments/camerpay/match";
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
import { canFulfilAt, canTakeAsapOrder, nextServiceSlot, serviceDateAndTime, type ServiceHours } from "@/lib/restaurant/service-hours";

/**
 * "En commandant, vous acceptez nos conditions" — shown under BOTH submit
 * buttons. It used to live only in the desktop column, so on a phone the
 * customer committed without ever being shown the terms they accepted.
 */
function TermsLine({ compact = false }: { compact?: boolean }) {
  const { t } = useLocale();
  return (
    <p className={cn("text-center leading-relaxed text-text-light", compact ? "text-[11px]" : "mt-3 text-xs")}>
      {t("cct.co.terms1")}{" "}
      <Link href="/terms" className="font-medium text-primary hover:underline">
        {t("cct.co.termsLink")}
      </Link>
      .
    </p>
  );
}

export function CheckoutClient({
  user,
  addresses,
  quartiers,
  wallet,
  scheduleMaxDays = 7,
}: {
  user: SessionUser | null;
  addresses: CustomerAddress[];
  quartiers: string[];
  wallet: { balance: number; available: boolean };
  /** Admin limit on scheduling ahead (0068); the date picker greys what lies beyond. */
  scheduleMaxDays?: number;
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
      case "describeCustom":
        return t("ons.d.describeRequiredDish", { dish: detail ?? "" });
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
  const [payment, setPayment] = useState<"mobile_money" | "wallet">("mobile_money");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState("asap");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [clock, setClock] = useState(() => new Date());
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);
  // Ticked by default: someone typing a new address at checkout almost always
  // orders to it again, and retyping it on a phone is the friction this saves.
  const [saveAddress, setSaveAddress] = useState(true);

  // The basket lives in localStorage, so the server could not tell us which
  // restaurant it belongs to — ask here, once, so a mode the kitchen does not
  // offer is disabled up front instead of rejected after the whole form.
  const cartRestaurantId = lines[0]?.restaurantId ?? null;
  const [caps, setCaps] = useState<{
    acceptsDelivery: boolean;
    acceptsPickup: boolean;
    isAcceptingOrders: boolean;
    hours: ServiceHours[];
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

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const nextSlot = useMemo(() => caps?.hours.length ? nextServiceSlot(caps.hours, clock) : null, [caps, clock]);
  const closedForAsap = Boolean(caps && !canTakeAsapOrder(caps.hours, clock));
  const selectedServiceTime = schedule === "later" && scheduleDate && scheduleTime
    ? new Date(`${scheduleDate}T${scheduleTime}:00+01:00`) : null;
  const outsideServiceHours = Boolean(caps && selectedServiceTime && !canFulfilAt(caps.hours, selectedServiceTime));
  const serviceBlocked = Boolean(caps && (!caps.isAcceptingOrders || (schedule === "asap" && closedForAsap) || outsideServiceHours));

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

  /*
    ─────────────────────────────────────────────────────────────────────────
     THE MINIMUM ORDER USED TO BE DESKTOP-ONLY.

     It sat in the summary column, which is `hidden lg:flex` — so on a phone,
     where nearly every order here is placed, the customer never saw it and
     only met it as a refusal after filling the whole form. It now disables
     both submit buttons, and the button itself says why.
    ─────────────────────────────────────────────────────────────────────────
  */
  const belowMinimum = Boolean(
    type === "delivery" && caps && caps.minimumOrder > 0 && totals.subtotal < caps.minimumOrder,
  );
  const submitBlocked = placing || serviceBlocked || belowMinimum;
  const submitLabel = belowMinimum && caps
    ? t("cct.co.belowMinBtn", { amount: formatMoney(caps.minimumOrder) })
    : null;

  // The restaurant's declared band, shown on the fee row. The fee itself is
  // paid to the rider in cash and is never added to the online total.
  const feeDetail = caps && caps.maxDeliveryFee > 0
    ? t("cct.sum.feeBand", { min: formatMoney(caps.minDeliveryFee), max: formatMoney(caps.maxDeliveryFee) })
    : caps && caps.minDeliveryFee > 0
      ? t("cct.sum.feeFromBand", { min: formatMoney(caps.minDeliveryFee) })
      : null;

  // Already in the address book → nothing to offer; the server re-checks too.
  const typedAddressKnown = addresses.some((a) =>
    isSameAddress(a, { addressLine: deliveryAddress, quartier: deliveryQuartier }),
  );

  function showFieldError(id: string, message: string) {
    setErrors({ [id === "checkout-form-error" ? "form" : id]: message });
    requestAnimationFrame(() => {
      const field = document.getElementById(id);
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
      field?.focus({ preventScroll: true });
    });
  }

  async function submit() {
    setErrors({});
    const chosen = addresses.find((a) => a.id === addressId);
    if (type === "delivery" && !newAddress && !chosen) {
      showFieldError("checkout-addresses", t("cct.err.addressNotFound"));
      return;
    }
    if ((newAddress || type === "pickup") && !deliveryName.trim()) {
      showFieldError(type === "pickup" ? "ck-pu-name" : "ck-name", t("cct.err.nameRequired"));
      return;
    }
    if ((newAddress || type === "pickup") && !deliveryPhone.trim()) {
      showFieldError(type === "pickup" ? "ck-pu-phone" : "ck-phone", t("cct.err.phoneRequired"));
      return;
    }
    // The restaurant and the rider call this number, and a typo is only
    // discovered when nobody answers at the gate. Same rule as CamerPay:
    // nine digits starting with 6, with or without +237.
    if ((newAddress || type === "pickup") && !normalisePhone(deliveryPhone)) {
      showFieldError(type === "pickup" ? "ck-pu-phone" : "ck-phone", t("cct.err.phoneInvalid"));
      return;
    }
    if (belowMinimum && caps) {
      showFieldError("checkout-form-error", t("cct.err.belowMinimum", { amount: formatMoney(caps.minimumOrder) }));
      return;
    }
    if (type === "delivery" && newAddress && !deliveryQuartier.trim()) {
      showFieldError("ck-quartier", t("cct.err.quartierRequired"));
      return;
    }
    if (type === "delivery" && newAddress && !deliveryAddress.trim()) {
      showFieldError("ck-address", t("cct.err.addressRequired"));
      return;
    }
    if (schedule === "later" && !scheduleDate) {
      showFieldError("ck-date", t("cct.co.scheduleRequired"));
      return;
    }
    if (schedule === "later" && !scheduleTime) {
      showFieldError("ck-time", t("cct.co.scheduleRequired"));
      return;
    }
    if (payment === "wallet" && (!wallet.available || wallet.balance < totals.total)) {
      showFieldError("payment-wallet", t("cct.err.notEnoughWallet"));
      return;
    }
    setPlacing(true);

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
      saveAddress: Boolean(user) && type === "delivery" && newAddress && saveAddress && !typedAddressKnown,
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
    const message = reasonText(result.reason, result.detail);
    const fieldByReason: Record<string, string> = {
      nameRequired: type === "pickup" ? "ck-pu-name" : "ck-name",
      phoneRequired: type === "pickup" ? "ck-pu-phone" : "ck-phone",
      addressRequired: "ck-address",
      addressNotFound: "checkout-addresses",
      notEnoughWallet: "payment-wallet",
      walletUnavailable: "payment-wallet",
      badSchedule: "ck-date",
      scheduleTooSoon: "ck-time",
      scheduleTooFar: "ck-date",
      restaurantClosed: "ck-schedule",
      outsideServiceHours: "ck-time",
      hoursUnavailable: "ck-schedule",
    };
    showFieldError(fieldByReason[result.reason] ?? "checkout-form-error", message);
    toast(message, "error");
  }

  return (
    <div className="container-page w-full py-6 pb-56 lg:py-12 lg:pb-12">
      <Link
        href="/cart"
        className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t("cct.co.back")}
      </Link>

      <h1 className="mt-4 font-display text-3xl font-bold">{t("cct.co.title")}</h1>

      {/*
        THE ORDER OF EVENTS, BEFORE THE FORM.

        Nothing is charged when this page is submitted: the restaurant first
        confirms the dishes (and quotes delivery), then the customer pays the
        food online, and the delivery fee goes to the rider in cash. A button
        that said "Payer" next to a total that excluded delivery read as a
        charge now and a hidden fee later — three short lines fix both.
      */}
      <section aria-labelledby="ck-steps" className="mt-4 rounded-lg border border-info/25 bg-info-light p-4 text-sm text-info">
        <h2 id="ck-steps" className="font-semibold">{t("cct.co.stepsTitle")}</h2>
        <ol className="mt-2 grid gap-1.5 sm:grid-cols-3 sm:gap-3">
          {[t("cct.co.step1"), t("cct.co.step2"), type === "delivery" ? t("cct.co.step3Delivery") : t("cct.co.step3Pickup")].map((step, index) => (
            <li key={index} className="flex gap-2">
              <span className="tnum grid size-5 shrink-0 place-items-center rounded-full bg-info text-[11px] font-bold text-white">{index + 1}</span>
              <span className="leading-snug text-text">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">{t("cct.co.stepsNote")}</p>
      </section>
      <div id="checkout-form-error" tabIndex={-1} className="outline-none">{errors.form && <p role="alert" className="mt-3 rounded-md border border-error/25 bg-error-light p-3 text-sm font-medium text-error">{errors.form}</p>}</div>

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
                <div id="checkout-addresses" tabIndex={-1} className="mt-4 flex flex-col gap-2 outline-none">
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
                    error={errors["ck-name"]}
                    className="sm:col-span-2"
                  >
                    <Input
                      id="ck-name"
                      value={deliveryName}
                      onChange={(e) => setDeliveryName(e.target.value)}
                    />
                  </Field>
                  <Field label={t("cct.co.phone")} htmlFor="ck-phone" required hint={t("cct.co.phoneHint")} error={errors["ck-phone"]}>
                    <Input
                      id="ck-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder={t("cct.co.phonePh")}
                      invalid={Boolean(errors["ck-phone"])}
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
                    error={errors["ck-quartier"]}
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
                    error={errors["ck-address"]}
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
                  {user && (
                    <div className="sm:col-span-2">
                      {typedAddressKnown ? (
                        <p className="text-xs text-text-light">{t("cct.co.addressKnown")}</p>
                      ) : (
                        <Checkbox
                          checked={saveAddress}
                          onChange={(e) => setSaveAddress(e.target.checked)}
                          label={t("cct.co.saveAddress")}
                        />
                      )}
                    </div>
                  )}
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
                <Field label={t("cct.co.name")} htmlFor="ck-pu-name" required error={errors["ck-pu-name"]}>
                  <Input
                    id="ck-pu-name"
                    value={deliveryName}
                    onChange={(e) => setDeliveryName(e.target.value)}
                  />
                </Field>
                <Field label={t("cct.co.phone")} htmlFor="ck-pu-phone" required hint={t("cct.co.phoneHint")} error={errors["ck-pu-phone"]}>
                  <Input
                    id="ck-pu-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder={t("cct.co.phonePh")}
                    invalid={Boolean(errors["ck-pu-phone"])}
                    value={deliveryPhone}
                    onChange={(e) => setDeliveryPhone(e.target.value)}
                  />
                </Field>
              </div>
            </section>
          )}

          {/* ── Schedule ───────────────────────────────────────────────── */}
          <section id="ck-schedule" tabIndex={-1} className="rounded-lg border border-border bg-surface p-5">
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

            {caps && !caps.isAcceptingOrders && <p className="mt-3 rounded-md bg-warning-light p-3 text-sm text-warning">{t("cct.err.notAcceptingOrders")}</p>}
            {caps?.isAcceptingOrders && schedule === "asap" && closedForAsap && <div className="mt-3 rounded-md bg-warning-light p-3 text-sm text-warning">
              <p>{t("cct.co.closedNow")}</p>
              {nextSlot && <Button className="mt-2" variant="outline" size="sm" onClick={() => {
                const next = serviceDateAndTime(nextSlot);
                if (!next) return;
                setScheduleDate(next.date); setScheduleTime(next.time); setSchedule("later");
              }}>{t("cct.co.chooseNext", { time: new Intl.DateTimeFormat(t("cct.co.dateLocale"), { timeZone: "Africa/Douala", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(nextSlot) })}</Button>}
            </div>}
            {schedule === "later" && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label={t("cct.co.date")} htmlFor="ck-date" error={errors["ck-date"]}>
                  <Input
                    id="ck-date"
                    type="date"
                    value={scheduleDate}
                    min={todayInDisplayTz()}
                    max={lastBookableDate(scheduleMaxDays)}
                    onChange={(e) => setScheduleDate(e.target.value)}
                  />
                </Field>
                <Field label={t("cct.co.time")} htmlFor="ck-time" error={errors["ck-time"]}>
                  <Input
                    id="ck-time"
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                  />
                </Field>
              </div>
            )}
            {schedule === "later" && outsideServiceHours && <p className="mt-3 rounded-md bg-warning-light p-3 text-sm text-warning">{t("cct.err.outsideServiceHours")}</p>}
          </section>

          {/* ── Payment ────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="font-display text-lg font-bold">{t("cct.co.payment")}</h2>
            <p className="mt-1 text-sm text-text-secondary">{t("cct.co.paymentChoice")}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button type="button" aria-pressed={payment === "mobile_money"} onClick={() => setPayment("mobile_money")} className={cn("min-h-28 rounded-md border p-4 text-left transition-colors", payment === "mobile_money" ? "border-primary bg-primary-light" : "border-border hover:border-border-strong")}>
                <span className="flex items-center gap-2 font-semibold"><Smartphone className="size-5 text-primary" aria-hidden />Mobile Money</span>
                <span className="mt-2 block text-xs leading-relaxed text-text-secondary">{t("cct.co.mobileMoneyBody")}</span>
              </button>
              <button id="payment-wallet" type="button" aria-pressed={payment === "wallet"} disabled={!user || !wallet.available || wallet.balance < totals.total} onClick={() => setPayment("wallet")} className={cn("min-h-28 rounded-md border p-4 text-left transition-colors", payment === "wallet" ? "border-primary bg-primary-light" : "border-border hover:border-border-strong", (!user || !wallet.available || wallet.balance < totals.total) && "cursor-not-allowed opacity-55")}>
                <span className="flex items-center justify-between gap-2 font-semibold"><span className="flex items-center gap-2"><WalletCards className="size-5 text-primary" aria-hidden />{t("cct.co.wallet")}</span><span className="tnum text-xs">{formatMoney(wallet.balance)}</span></span>
                <span className="mt-2 block text-xs leading-relaxed text-text-secondary">{!user ? t("cct.co.walletLogin") : !wallet.available ? t("cct.co.walletUnavailable") : wallet.balance < totals.total ? t("cct.co.walletInsufficient", { missing: formatMoney(totals.total - wallet.balance) }) : t("cct.co.walletReady")}</span>
              </button>
            </div>
            {errors["payment-wallet"] && <p role="alert" className="mt-2 text-xs font-medium text-error">{errors["payment-wallet"]}</p>}
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
        <div className="hidden flex-col gap-4 lg:sticky lg:top-24 lg:flex">
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
          {belowMinimum && caps && (
            <p className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs leading-relaxed text-warning">
              {t("cct.co.belowMinHint", {
                amount: formatMoney(caps.minimumOrder - totals.subtotal),
              })}
            </p>
          )}

          <CartSummary showDeliveryFee={type === "delivery"} deliveryFeeDetail={feeDetail}>
            <Button
              size="lg"
              fullWidth
              loading={placing}
              disabled={submitBlocked}
              onClick={submit}
              className="rounded-md"
            >
              {submitLabel ?? t("cct.co.place", { total: formatMoney(totals.total) })}
            </Button>
            <TermsLine />
          </CartSummary>
        </div>
      </div>

      <div className="fixed inset-x-0 z-30 border-t border-border bg-surface/98 px-4 pt-3 shadow-[0_-10px_30px_rgba(0,0,0,0.08)] backdrop-blur-md lg:hidden" style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}>
        <div className="mx-auto max-w-lg">
          {/* The phone summary carries everything the desktop column does —
              lines, fees, the cash-to-rider note and the terms — because a
              phone is where most orders are placed, and the desktop column is
              `hidden lg:flex`. */}
          {summaryOpen && (
            <div className="mb-3 max-h-[55dvh] overflow-y-auto rounded-md bg-surface-2 p-3">
              <p className="font-semibold">{restaurant.restaurantName}</p>
              <ul className="mt-2 grid gap-1.5 text-xs text-text-secondary">
                {lines.map((line) => <li key={line.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{line.quantity} x {line.name}</span><span className="tnum shrink-0">{formatMoney((line.basePrice + line.options.reduce((sum, option) => sum + option.priceDelta, 0)) * line.quantity)}</span></li>)}
              </ul>
              <div className="mt-3">
                <CartSummary showDeliveryFee={type === "delivery"} deliveryFeeDetail={feeDetail} />
              </div>
            </div>
          )}
          {belowMinimum && caps && (
            <p role="status" className="mb-2 rounded-md bg-warning-light px-3 py-2 text-xs leading-snug text-warning">
              {t("cct.co.belowMinHint", { amount: formatMoney(caps.minimumOrder - totals.subtotal) })}
            </p>
          )}
          <div className="flex items-center gap-3 pb-1">
            <button type="button" aria-expanded={summaryOpen} onClick={() => setSummaryOpen((open) => !open)} className="min-w-0 flex-1 text-left">
              <span className="flex items-center gap-1 text-xs font-medium text-text-light">{t("cct.sum.totalOnline")}<ChevronUp className={cn("size-3.5 transition-transform", !summaryOpen && "rotate-180")} aria-hidden /></span>
              <span className="tnum block text-lg font-bold">{formatMoney(totals.total)}</span>
              {type === "delivery" && <span className="block truncate text-[11px] text-text-light">+ {t("cct.sum.delivery")} {t("cct.sum.toConfirm")}</span>}
            </button>
            <Button size="lg" loading={placing} disabled={submitBlocked} onClick={submit} className="min-w-36 px-5">{submitLabel ?? t("cct.co.pay")}</Button>
          </div>
          <div className="pb-3">
            <TermsLine compact />
          </div>
        </div>
      </div>
    </div>
  );
}
