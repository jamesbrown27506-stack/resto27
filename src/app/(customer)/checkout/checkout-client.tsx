"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  Banknote,
  Bike,
  Info,
  MapPin,
  Plus,
  ShoppingBag,
} from "lucide-react";
import { useCart } from "@/components/cart/cart-provider";
import { CartSummary } from "@/components/cart/cart-parts";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Radio, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { placeOrder, type CheckoutInput } from "@/lib/data/checkout-actions";
import type { CustomerAddress } from "@/lib/data/customer";
import { formatMoney } from "@/lib/format/currency";
import {
  ORDER_TYPE_LABEL,
  PAYMENT_METHOD_LABEL,
  type OrderType,
  type PaymentMethod,
} from "@/lib/format/order-status";
import type { SessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";

const ORDER_REASONS: Record<string, string> = {
  emptyBasket: "Votre panier est vide.",
  badType: "Type de commande invalide.",
  restaurantUnavailable: "Ce restaurant n'est plus disponible.",
  notAcceptingOrders: "Le restaurant ne prend plus de commandes pour l'instant.",
  noDelivery: "Ce restaurant ne livre pas.",
  noPickup: "Ce restaurant ne propose pas le retrait.",
  itemGone: "Un article du panier n'existe plus.",
  itemSoldOut: "Un article du panier est épuisé.",
  badQuantity: "Quantité invalide.",
  notEnoughStock: "Stock insuffisant pour un article du panier.",
  optionGone: "Une option choisie n'existe plus.",
  optionUnavailable: "Une option choisie n'est plus disponible.",
  optionMismatch: "Une option ne correspond pas à l'article.",
  badPrice: "Prix invalide.",
  belowMinimum: "Le montant minimum de commande n'est pas atteint.",
  promoInvalid: "Ce code promo n'est pas valable pour ce restaurant.",
  promoExpired: "Ce code promo a expiré.",
  promoUsedUp: "Ce code promo a atteint sa limite d'utilisation.",
  promoMinimum: "Montant minimum non atteint pour ce code promo.",
  notEnoughPoints: "Vous n'avez pas assez de points de fidélité.",
  belowMinPoints: "Montant minimal de points non atteint.",
  addressNotFound: "Cette adresse ne vous appartient pas.",
  nameRequired: "Indiquez le nom du destinataire.",
  phoneRequired: "Indiquez un numéro de téléphone.",
  addressRequired: "Indiquez une adresse de livraison.",
  badSchedule: "La date de programmation est invalide.",
  scheduleTooSoon: "Choisissez un horaire à plus d'une minute.",
  scheduleTooFar: "La programmation est limitée à 7 jours.",
  rateLimited: "Trop de commandes passées récemment. Réessayez dans quelques minutes.",
  failed: "La commande n'a pas pu être enregistrée. Réessayez.",
};

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

  const [type, setType] = useState<OrderType>("delivery");
  const [addressId, setAddressId] = useState(addresses.find((a) => a.isDefault)?.id ?? "");
  const [newAddress, setNewAddress] = useState(addresses.length === 0);
  const [deliveryName, setDeliveryName] = useState(user?.name ?? "");
  const [deliveryPhone, setDeliveryPhone] = useState(user?.phone ?? "");
  const [deliveryQuartier, setDeliveryQuartier] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryLandmark, setDeliveryLandmark] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("cash_on_delivery");
  const [schedule, setSchedule] = useState("asap");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);

  if (lines.length === 0) {
    return (
      <div className="container-page w-full py-16">
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<ShoppingBag />}
            title="Votre panier est vide"
            description="Ajoutez des articles avant de passer commande."
            action={
              <Link href="/browse" className={buttonClasses()}>
                Voir les restaurants
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
      toast("Choisissez une date et une heure pour la programmation.", "error");
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
    };

    const result = await placeOrder(input);
    setPlacing(false);

    if (result.ok) {
      clear();
      toast("Commande envoyée au restaurant.", "success");
      router.push(`/orders/${result.orderId}`);
    } else {
      toast(ORDER_REASONS[result.reason] ?? "La commande a échoué.", "error");
    }
  }

  return (
    <div className="container-page w-full py-8 lg:py-12">
      <Link
        href="/cart"
        className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Retour au panier
      </Link>

      <h1 className="mt-4 font-display text-3xl font-bold">Finaliser la commande</h1>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          {/* ── Order type ─────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="font-display text-lg font-bold">Mode de retrait</h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["delivery", "pickup"] as OrderType[]).map((value) => {
                const Icon = value === "delivery" ? Bike : ShoppingBag;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={type === value}
                    onClick={() => setType(value)}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-md border p-4 transition-colors",
                      type === value
                        ? "border-primary bg-primary-light text-primary"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    <span className="text-sm font-semibold">{ORDER_TYPE_LABEL[value]}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Address ────────────────────────────────────────────────── */}
          {type === "delivery" && (
            <section className="rounded-lg border border-border bg-surface p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold">Adresse de livraison</h2>
                <Button variant="ghost" size="sm" onClick={() => setNewAddress((v) => !v)}>
                  <Plus className="size-3.5" aria-hidden />
                  Nouvelle adresse
                </Button>
              </div>

              {!newAddress ? (
                <div className="mt-4 flex flex-col gap-2">
                  {addresses.length === 0 ? (
                    <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-text-secondary">
                      Aucune adresse enregistrée — utilisez « Nouvelle adresse » ci-dessus.
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
                                Par défaut
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
                  <Field label="Nom du destinataire" htmlFor="ck-name" required className="sm:col-span-2">
                    <Input
                      id="ck-name"
                      value={deliveryName}
                      onChange={(e) => setDeliveryName(e.target.value)}
                    />
                  </Field>
                  <Field label="Téléphone" htmlFor="ck-phone" required>
                    <Input
                      id="ck-phone"
                      type="tel"
                      value={deliveryPhone}
                      onChange={(e) => setDeliveryPhone(e.target.value)}
                    />
                  </Field>
                  <Field label="Quartier" htmlFor="ck-quartier" required>
                    <Select
                      id="ck-quartier"
                      value={deliveryQuartier}
                      onChange={(e) => setDeliveryQuartier(e.target.value)}
                    >
                      <option value="" disabled>
                        Choisir un quartier
                      </option>
                      {quartiers.map((q) => (
                        <option key={q} value={q}>
                          {q}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Adresse" htmlFor="ck-address" required className="sm:col-span-2">
                    <Input
                      id="ck-address"
                      icon={<MapPin />}
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder="Rue, immeuble, étage"
                    />
                  </Field>
                  <Field
                    label="Point de repère"
                    htmlFor="ck-landmark"
                    hint="Ce qui aide vraiment le livreur à vous trouver."
                    className="sm:col-span-2"
                  >
                    <Input
                      id="ck-landmark"
                      value={deliveryLandmark}
                      onChange={(e) => setDeliveryLandmark(e.target.value)}
                      placeholder="En face de la pharmacie du Golfe"
                    />
                  </Field>
                </div>
              )}

              {/*
                §14.3 — the fee is quoted on confirmation, not now. Saying so
                here, before the total, is what stops it reading as a surprise
                charge later.
              */}
              <p className="mt-4 flex items-start gap-2.5 rounded-md border border-info/25 bg-info-light p-3 text-sm text-info">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Les frais de livraison sont fixés par le restaurant lorsqu&apos;il confirme votre
                  commande, en fonction de votre quartier. Ils vous seront communiqués à ce
                  moment-là.
                </span>
              </p>
            </section>
          )}

          {/* ── Pickup contact ────────────────────────────────────────── */}
          {type === "pickup" && (
            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="font-display text-lg font-bold">Vos coordonnées</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Le restaurant les utilise pour vous joindre au moment du retrait.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Nom" htmlFor="ck-pu-name" required>
                  <Input
                    id="ck-pu-name"
                    value={deliveryName}
                    onChange={(e) => setDeliveryName(e.target.value)}
                  />
                </Field>
                <Field label="Téléphone" htmlFor="ck-pu-phone" required>
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
            <h2 className="font-display text-lg font-bold">Quand ?</h2>
            <div className="mt-4 flex flex-col gap-2">
              <Radio
                name="schedule"
                checked={schedule === "asap"}
                onChange={() => setSchedule("asap")}
                label="Dès que possible"
                description="Le restaurant confirme dès réception de la commande"
              />
              <Radio
                name="schedule"
                checked={schedule === "later"}
                onChange={() => setSchedule("later")}
                label="Programmer"
                description="Choisir une heure de retrait ou de livraison"
              />
            </div>

            {schedule === "later" && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Date" htmlFor="ck-date">
                  <Input
                    id="ck-date"
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                  />
                </Field>
                <Field label="Heure" htmlFor="ck-time">
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
            <h2 className="font-display text-lg font-bold">Paiement</h2>
            <div className="mt-4 flex flex-col gap-2">
              {(["cash_on_delivery", "pay_at_restaurant"] as PaymentMethod[]).map((m) => (
                <Radio
                  key={m}
                  name="payment"
                  checked={payment === m}
                  onChange={() => setPayment(m)}
                  label={PAYMENT_METHOD_LABEL[m]}
                  description={
                    m === "cash_on_delivery"
                      ? "Réglez le livreur à la remise de la commande."
                      : "Réglez sur place au moment du retrait."
                  }
                />
              ))}
            </div>
            <p className="mt-3 flex items-center gap-2 text-xs text-text-light">
              <Banknote className="size-3.5" aria-hidden />
              Le paiement en ligne des commandes arrive bientôt.
            </p>
          </section>

          {/* ── Notes ─────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="font-display text-lg font-bold">Instructions</h2>
            <Textarea
              className="mt-4"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Sonner à l'interphone, appartement 3B…"
              aria-label="Instructions pour la commande"
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

          <CartSummary showDeliveryFee={type === "delivery"}>
            <Button
              size="lg"
              fullWidth
              loading={placing}
              onClick={submit}
              className="rounded-md"
            >
              Commander · {formatMoney(totals.total)}
            </Button>
            <p className="mt-3 text-center text-xs leading-relaxed text-text-light">
              En commandant, vous acceptez nos{" "}
              <Link href="/terms" className="font-medium text-primary hover:underline">
                conditions d&apos;utilisation
              </Link>
              .
            </p>
          </CartSummary>
        </div>
      </div>
    </div>
  );
}