"use client";

import { useState } from "react";
import { Info, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QtyStepper } from "@/components/ui/qty-stepper";
import { formatMoney } from "@/lib/format/currency";
import { lineUnitPrice } from "@/lib/orders/totals";
// Aliased, not relative — every other consumer imports it as
// "@/components/cart/cart-provider", and a module reached by two different
// specifiers is a module that can end up instantiated twice under Fast
// Refresh. Two instances means two CartContexts, and the consumer reading the
// one the provider did not fill throws "useCart must be used inside
// <CartProvider>" on a tree that is, in fact, inside one.
import { useCart, type CartLine } from "@/components/cart/cart-provider";
import { cn } from "@/lib/utils";

/* ── One basket line ───────────────────────────────────────────────────── */

export function CartLineRow({ line }: { line: CartLine }) {
  const { setQuantity, removeLine } = useCart();
  const unitPrice = lineUnitPrice(line.basePrice, line.options.map((o) => o.priceDelta));

  return (
    <li className="flex items-start gap-4 py-5">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{line.name}</p>

        {/* The human-readable snapshot — this exact string is copied onto
            order_items.options_label when the order is placed (§3). */}
        {line.options.length > 0 && (
          <p className="mt-0.5 text-sm text-text-secondary">
            {line.options.map((o) => o.optionName).join(" · ")}
          </p>
        )}

        {line.notes && (
          <p className="mt-1 text-xs text-text-light italic">« {line.notes} »</p>
        )}

        <div className="mt-3 flex items-center gap-4">
          <QtyStepper
            value={line.quantity}
            onChange={(q) => setQuantity(line.id, q)}
            onRemove={() => removeLine(line.id)}
            size="sm"
          />
          <span className="text-xs text-text-light">{formatMoney(unitPrice)} / unité</span>
        </div>
      </div>

      <p className="tnum shrink-0 font-semibold">{formatMoney(unitPrice * line.quantity)}</p>
    </li>
  );
}

/* ── Promo code ────────────────────────────────────────────────────────── */

export function PromoInput() {
  const { promoCode, promoError, applyPromo, removePromo } = useCart();
  const [value, setValue] = useState("");

  if (promoCode) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-success/30 bg-success-light p-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-success">
          <Tag className="size-3.5" aria-hidden />
          {promoCode} appliqué
        </span>
        <button
          type="button"
          onClick={removePromo}
          aria-label="Retirer le code promo"
          className="rounded p-1 text-success/70 transition-colors hover:text-success"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        applyPromo(value);
      }}
    >
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder="Code promo"
          aria-label="Code promo"
          invalid={Boolean(promoError)}
          className="flex-1"
        />
        <Button type="submit" variant="outline" disabled={!value.trim()}>
          Appliquer
        </Button>
      </div>
      {promoError && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-error">
          {promoError}
        </p>
      )}
    </form>
  );
}

/* ── Loyalty redemption ────────────────────────────────────────────────── */

export function LoyaltyRedeem({ balance }: { balance: number }) {
  const { loyaltyPointsUsed, setLoyaltyPointsUsed, totals, config } = useCart();

  if (!config.loyaltyEnabled || balance <= 0) return null;

  // Never let a redemption exceed what the food actually costs — otherwise the
  // customer burns points to produce a zero total and loses the remainder.
  const maxRedeemable = Math.min(balance, totals.netFood + totals.serviceCharge);

  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="loyalty" className="text-sm font-semibold">
          Utiliser mes points
        </label>
        <span className="tnum text-xs text-text-light">
          {balance.toLocaleString("fr-CM")} disponibles
        </span>
      </div>

      <input
        id="loyalty"
        type="range"
        min={0}
        max={maxRedeemable}
        step={50}
        value={loyaltyPointsUsed}
        onChange={(e) => setLoyaltyPointsUsed(Number(e.target.value))}
        className="mt-2.5 w-full accent-[var(--primary)]"
      />

      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-text-light">0</span>
        <span className="tnum font-semibold text-primary">
          −{formatMoney(loyaltyPointsUsed * config.pointValue)}
        </span>
        <span className="tnum text-text-light">{maxRedeemable.toLocaleString("fr-CM")}</span>
      </div>
    </div>
  );
}

/* ── Totals panel ──────────────────────────────────────────────────────── */

export function CartSummary({
  /** Delivery orders show "à confirmer"; pickup and dine-in show nothing. */
  showDeliveryFee = true,
  children,
}: {
  showDeliveryFee?: boolean;
  children?: React.ReactNode;
}) {
  const { totals, promoCode } = useCart();

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-lg font-bold">Récapitulatif</h2>

      <dl className="mt-4 flex flex-col gap-2.5 text-sm">
        <Row label="Sous-total" value={formatMoney(totals.subtotal)} />

        {totals.discount > 0 && (
          <Row
            label={`Réduction${promoCode ? ` (${promoCode})` : ""}`}
            value={`−${formatMoney(totals.discount)}`}
            tone="success"
          />
        )}

        <Row
          label={`Frais de service (${totals.serviceChargePercent} %)`}
          value={formatMoney(totals.serviceCharge)}
        />

        {showDeliveryFee && (
          <div className="flex items-start justify-between gap-3">
            <dt className="text-text-secondary">Livraison</dt>
            {/*
              §14.3 — NEVER render "0 FCFA" here. The restaurant quotes the fee
              when it confirms, based on the quartier. Showing zero is a promise
              we are about to break; showing "à confirmer" is the truth.
            */}
            <dd className="text-right font-medium text-text-light">à confirmer</dd>
          </div>
        )}

        {totals.loyaltyValue > 0 && (
          <Row
            label="Points de fidélité"
            value={`−${formatMoney(totals.loyaltyValue)}`}
            tone="success"
          />
        )}
      </dl>

      <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border pt-4">
        <span className="font-display text-lg font-bold">Total</span>
        <span translate="no" className="tnum font-display text-2xl font-bold text-primary">
          {formatMoney(totals.total)}
        </span>
      </div>

      {showDeliveryFee && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-surface-2 p-2.5 text-xs leading-relaxed text-text-secondary">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          Les frais de livraison sont fixés par le restaurant à la confirmation, selon votre
          quartier. Ils s&apos;ajouteront à ce total.
        </p>
      )}

      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success";
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-text-secondary">{label}</dt>
      {/*
        translate="no" on every money value.

        Two reasons. Browser translators reformat numbers between locales —
        "12 500 FCFA" can come back with different separators or a relocated
        unit, and a mistranslated price on a checkout screen is a real problem
        rather than a cosmetic one.

        It also keeps these nodes out of the translator's reach entirely, and
        totals are among the most frequently re-rendered text in the app, which
        makes them a prime source of the insertBefore crash.
      */}
      <dd
        translate="no"
        className={cn("tnum text-right font-medium", tone === "success" && "text-success")}
      >
        {value}
      </dd>
    </div>
  );
}
