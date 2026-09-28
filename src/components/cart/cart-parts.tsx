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
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

/* ── One basket line ───────────────────────────────────────────────────── */

export function CartLineRow({ line }: { line: CartLine }) {
  const { setQuantity, removeLine } = useCart();
  const { t } = useLocale();
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

        {/* A customizable dish: the price shown is the minimum. */}
        {line.priceToConfirm && (
          <p className="mt-1 text-xs font-semibold text-info">
            {t("ons.d.lineToConfirm", {
              max: formatMoney(
                lineUnitPrice(line.priceMax ?? line.basePrice, line.options.map((o) => o.priceDelta)),
              ),
            })}
          </p>
        )}

        <div className="mt-3 flex items-center gap-4">
          <QtyStepper
            value={line.quantity}
            onChange={(q) => setQuantity(line.id, q)}
            onRemove={() => removeLine(line.id)}
            size="sm"
          />
          <span className="text-xs text-text-light">
            {t("cct.perUnit", { price: formatMoney(unitPrice) })}
          </span>
        </div>
      </div>

      <p className="tnum shrink-0 font-semibold">{formatMoney(unitPrice * line.quantity)}</p>
    </li>
  );
}

/* ── Promo code ────────────────────────────────────────────────────────── */

export function PromoInput() {
  const { promoCode, promoError, promoPending, applyPromo, removePromo } = useCart();
  const { t } = useLocale();
  const [value, setValue] = useState("");

  if (promoCode) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-success/30 bg-success-light p-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-success">
          <Tag className="size-3.5" aria-hidden />
          {t("cct.promo.applied", { code: promoCode ?? "" })}
        </span>
        <button
          type="button"
          onClick={removePromo}
          aria-label={t("cct.promo.remove")}
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
          placeholder={t("cct.promo.placeholder")}
          aria-label={t("cct.promo.label")}
          invalid={Boolean(promoError)}
          className="flex-1"
        />
        {/*
          `promoPending` was already on the cart context and simply not read
          here, so applying a code looked like nothing happened while the
          server validated it — and on a slow connection that is exactly when
          someone taps again.
        */}
        <Button
          type="submit"
          variant="outline"
          loading={promoPending}
          disabled={promoPending || !value.trim()}
        >
          {t("cct.promo.apply")}
        </Button>
      </div>
      {promoError && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-error">
          {t(`cct.promoErr.${promoError}` as TranslationKey)}
        </p>
      )}
    </form>
  );
}

/* ── Loyalty redemption ────────────────────────────────────────────────── */

export function LoyaltyRedeem({
  balance,
  minRedeem,
  pointValue,
}: {
  balance: number;
  /** The platform minimum (settings.loyalty_min_redeem). 0 = no minimum. */
  minRedeem: number;
  /** FCFA per point (settings.loyalty_point_value). */
  pointValue: number;
}) {
  const { loyaltyPointsUsed, setLoyaltyPointsUsed, totals, config } = useCart();
  const { t } = useLocale();

  if (!config.loyaltyEnabled || balance <= 0) return null;

  /*
    ───────────────────────────────────────────────────────────────────────
     WHY THE SLIDER COULD NOT BE MOVED, AND WHY IT SAID NOTHING.

     Three faults compounded into "I can see my points and I cannot use any
     of them", with no explanation anywhere on the screen.

     1. THE MINIMUM WAS INVISIBLE AND UNENFORCED HERE. The platform requires
        `loyalty_min_redeem` points before anything can be spent (100 on the
        live settings). The slider let you pick any amount, and CHECKOUT then
        refused with "below the minimum" — a rule announced only at the point
        of failure, on a different screen.

     2. THE STEP WAS BIGGER THAN THE RANGE. `step={50}` against a balance of
        20 gives a slider whose only reachable value is 0. It rendered, it
        looked interactive, and it could not move. That is the literal
        complaint.

     3. POINTS WERE COMPARED TO FRANCS. `Math.min(balance, netFood +
        serviceCharge)` capped a POINT count with a FRANC amount. It happens
        to be harmless while a point is worth exactly one franc, and silently
        lets a customer burn five times too many the moment an admin sets
        `loyalty_point_value` to 5 — losing the remainder.

     So: convert francs to points before capping, step in whole points, and
     when the balance cannot reach the minimum say so plainly instead of
     rendering a dead control.
    ───────────────────────────────────────────────────────────────────────
  */

  // The order can only absorb so much: points must never pay more than the
  // food itself is worth, or the remainder is burnt for nothing.
  const spendableFrancs = totals.netFood + totals.serviceCharge;
  const affordablePoints = pointValue > 0 ? Math.floor(spendableFrancs / pointValue) : 0;
  const maxRedeemable = Math.max(0, Math.min(balance, affordablePoints));

  // Below the minimum there is nothing to offer, so the row explains itself
  // rather than showing a control that cannot be used.
  if (minRedeem > 0 && balance < minRedeem) {
    return (
      <div className="rounded-md border border-border bg-surface-2 p-3">
        <p className="text-sm font-semibold">{t("cct.loy.title")}</p>
        <p className="tnum mt-1 text-xs leading-relaxed text-text-secondary">
          {t("cct.loy.belowMin", { min: minRedeem, balance, missing: minRedeem - balance })}
        </p>
      </div>
    );
  }

  // The basket is too small to absorb the minimum — a different problem with a
  // different fix (add a dish), and worth saying rather than clamping to zero.
  if (maxRedeemable < Math.max(1, minRedeem)) {
    return (
      <div className="rounded-md border border-border bg-surface-2 p-3">
        <p className="text-sm font-semibold">{t("cct.loy.title")}</p>
        <p className="tnum mt-1 text-xs leading-relaxed text-text-secondary">
          {t("cct.loy.basketTooSmall", { min: minRedeem })}
        </p>
      </div>
    );
  }

  const floor = Math.max(1, minRedeem);
  // A step that cannot divide the range is what produced the immovable
  // slider. Ten points where there is room for it, one where there is not.
  const step = maxRedeemable - floor >= 10 ? 10 : 1;

  /** 0 (spend nothing) or at least the minimum — never a refusable amount. */
  function choose(raw: number) {
    if (raw <= 0) return setLoyaltyPointsUsed(0);
    setLoyaltyPointsUsed(Math.min(maxRedeemable, Math.max(floor, raw)));
  }

  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor="loyalty" className="text-sm font-semibold">
          {t("cct.loy.title")}
        </label>
        <span className="tnum text-xs text-text-light">
          {t("cct.loy.available", { count: balance })}
        </span>
      </div>

      <input
        id="loyalty"
        type="range"
        min={0}
        max={maxRedeemable}
        step={step}
        value={loyaltyPointsUsed}
        onChange={(e) => choose(Number(e.target.value))}
        className="mt-2.5 w-full accent-[var(--primary)]"
      />

      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-text-light">0</span>
        <span className="tnum font-semibold text-primary">
          −{formatMoney(loyaltyPointsUsed * pointValue)}
        </span>
        <span className="tnum text-text-light">{maxRedeemable.toLocaleString("fr-CM")}</span>
      </div>

      {/* Two taps that the slider makes fiddly on a phone: spend the most the
          order allows, or spend none at all. */}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => choose(maxRedeemable)}
          className="tnum rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
        >
          {t("cct.loy.useMax", { points: maxRedeemable })}
        </button>
        {loyaltyPointsUsed > 0 && (
          <button
            type="button"
            onClick={() => choose(0)}
            className="rounded-full border border-transparent px-3 py-1.5 text-xs font-medium text-text-light transition-colors hover:text-text"
          >
            {t("cct.loy.useNone")}
          </button>
        )}
      </div>

      {minRedeem > 0 && (
        <p className="tnum mt-2 text-xs text-text-light">
          {t("cct.loy.minHint", { min: minRedeem })}
        </p>
      )}
    </div>
  );
}

/* ── Totals panel ──────────────────────────────────────────────────────── */

export function CartSummary({
  /** Delivery orders show "à payer au livreur"; pickup and dine-in show nothing. */
  showDeliveryFee = true,
  deliveryFeeDetail,
  children,
}: {
  showDeliveryFee?: boolean;
  /** The restaurant's advertised band, e.g. "1 000 – 3 000 FCFA, en espèces". */
  deliveryFeeDetail?: string | null;
  children?: React.ReactNode;
}) {
  const { totals, promoCode, lines } = useCart();
  const { t } = useLocale();
  // Customizable dishes are counted at their minimum until the restaurant
  // confirms the price (0069) — the total is an estimate until then.
  const estimated = lines.some((line) => line.priceToConfirm);

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-lg font-bold">{t("cct.sum.title")}</h2>
      {estimated && (
        <p className="mt-2 rounded-md border border-info/30 bg-info-light p-2.5 text-xs leading-relaxed text-info">
          {t("ons.d.estimatedTotal")}
        </p>
      )}

      <dl className="mt-4 flex flex-col gap-2.5 text-sm">
        <Row label={t("cct.sum.subtotal")} value={formatMoney(totals.subtotal)} />

        {totals.discount > 0 && (
          <Row
            label={
              promoCode
                ? t("cct.sum.discountCode", { code: promoCode })
                : t("cct.sum.discount")
            }
            value={`−${formatMoney(totals.discount)}`}
            tone="success"
          />
        )}

        <Row
          label={t("cct.sum.service", { percent: totals.serviceChargePercent })}
          value={formatMoney(totals.serviceCharge)}
        />

        {showDeliveryFee && (
          <div className="flex items-start justify-between gap-3">
            <dt className="text-text-secondary">{t("cct.sum.delivery")}</dt>
            {/*
              §14.3 — NEVER render "0 FCFA" here. The restaurant quotes the fee
              when it confirms, based on the quartier. Showing zero is a promise
              we are about to break; showing "à confirmer" is the truth.
            */}
            <dd className="text-right font-medium text-text-light">
              {/* NEW PAYMENT MODEL: the fee goes to the rider in cash and is
                  never part of the online total below — so the row names who
                  is paid, and the band when the restaurant declared one. */}
              {t("cct.sum.toConfirm")}
              {deliveryFeeDetail && (
                <span translate="no" className="tnum block text-xs font-normal">
                  {deliveryFeeDetail}
                </span>
              )}
            </dd>
          </div>
        )}

        {totals.loyaltyValue > 0 && (
          <Row
            label={t("cct.sum.loyalty")}
            value={`−${formatMoney(totals.loyaltyValue)}`}
            tone="success"
          />
        )}
      </dl>

      <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border pt-4">
        <span className="font-display text-lg font-bold">
          {t("cct.sum.totalOnline")}
        </span>
        <span translate="no" className="tnum font-display text-2xl font-bold text-primary">
          {formatMoney(totals.total)}
        </span>
      </div>

      {showDeliveryFee && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-surface-2 p-2.5 text-xs leading-relaxed text-text-secondary">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          {t("cct.sum.feeNote")}
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
