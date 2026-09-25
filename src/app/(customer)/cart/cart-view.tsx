"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ShoppingBag, Store } from "lucide-react";
import { getRestaurantOrderCapabilities } from "@/lib/data/checkout-actions";
import { formatMoney } from "@/lib/format/currency";
import { useCart } from "@/components/cart/cart-provider";
import { CartLineRow, CartSummary, LoyaltyRedeem, PromoInput } from "@/components/cart/cart-parts";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * The basket.
 *
 * Reachable SIGNED OUT (§2, §14.3) — a guest can fill it and see a total, and
 * it merges into the account on sign-in. Forcing registration before someone
 * can see what they owe is the single biggest drop-off point in food ordering.
 */
export function CartView({
  balance,
  minRedeem,
  pointValue,
}: {
  balance: number;
  minRedeem: number;
  pointValue: number;
}) {
  const { lines, itemCount, totals } = useCart();
  const { t } = useLocale();

  /*
    THE MINIMUM, SHOWN WHERE THE BASKET IS BUILT.

    The restaurant's delivery minimum was only ever mentioned on the checkout
    screen (and there only on desktop), i.e. after the customer had stopped
    adding dishes. Here it can still change what goes in the basket. One read
    per basket restaurant — the same capabilities the checkout already asks
    for — and nothing at all for an empty basket.
  */
  const cartRestaurantId = lines[0]?.restaurantId ?? null;
  const [caps, setCaps] = useState<{
    restaurantId: string;
    minimumOrder: number;
    acceptsDelivery: boolean;
    minDeliveryFee: number;
    maxDeliveryFee: number;
  } | null>(null);
  useEffect(() => {
    if (!cartRestaurantId) return;
    let alive = true;
    getRestaurantOrderCapabilities(cartRestaurantId)
      .then((c) => {
        if (alive && c) {
          setCaps({
            restaurantId: cartRestaurantId,
            minimumOrder: c.minimumOrder,
            acceptsDelivery: c.acceptsDelivery,
            minDeliveryFee: c.minDeliveryFee,
            maxDeliveryFee: c.maxDeliveryFee,
          });
        }
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [cartRestaurantId]);
  const known = caps && caps.restaurantId === cartRestaurantId ? caps : null;
  const minimum = known?.acceptsDelivery ? known.minimumOrder : 0;
  const feeDetail = known && known.maxDeliveryFee > 0
    ? t("cct.sum.feeBand", { min: formatMoney(known.minDeliveryFee), max: formatMoney(known.maxDeliveryFee) })
    : known && known.minDeliveryFee > 0
      ? t("cct.sum.feeFromBand", { min: formatMoney(known.minDeliveryFee) })
      : null;

  // Every line in a basket belongs to one restaurant — you cannot order from
  // two kitchens in one delivery.
  const restaurant = lines[0];

  return (
    <div className="container-page w-full py-8 lg:py-12">
      <h1 className="font-display text-3xl font-bold">{t("cct.heading")}</h1>

      {lines.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<ShoppingBag />}
            title={t("cct.empty")}
            description={t("cct.emptyBody")}
            action={
              <Link href="/browse" className={buttonClasses()}>
                {t("cct.browse")}
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
          <div className="rounded-lg border border-border bg-surface">
            <div className="flex items-center gap-3 border-b border-border p-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-light text-primary">
                <Store className="size-4.5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate font-display font-bold">{restaurant.restaurantName}</p>
                <p className="text-sm text-text-light">{t("cct.items", { count: itemCount })}</p>
              </div>
              <Link
                href={`/restaurants/${restaurant.restaurantSlug}`}
                className="ml-auto shrink-0 text-sm font-semibold text-primary hover:underline"
              >
                {t("cct.addMore")}
              </Link>
            </div>

            <ul className="divide-y divide-border px-5">
              {lines.map((line) => (
                <CartLineRow key={line.id} line={line} />
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-4 lg:sticky lg:top-24">
            <PromoInput />
            <LoyaltyRedeem balance={balance} minRedeem={minRedeem} pointValue={pointValue} />

            {minimum > 0 && (
              <p
                className={
                  totals.subtotal < minimum
                    ? "rounded-md border border-warning/30 bg-warning-light p-3 text-xs leading-relaxed text-warning"
                    : "text-xs text-text-light"
                }
              >
                {totals.subtotal < minimum
                  ? t("cct.minOrderMissing", {
                      amount: formatMoney(minimum - totals.subtotal),
                      min: formatMoney(minimum),
                    })
                  : t("cct.minOrder", { amount: formatMoney(minimum) })}
              </p>
            )}

            <CartSummary showDeliveryFee={known ? known.acceptsDelivery : true} deliveryFeeDetail={feeDetail}>
              <Link
                href="/checkout"
                className={buttonClasses({ size: "lg", fullWidth: true, className: "rounded-md" })}
              >
                {t("cct.goToCheckout")}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </CartSummary>

            <p className="text-center text-xs text-text-light">
              {t("cct.guestQ")}{" "}
              {/* Back to the checkout after signing in (or signing up — the
                  login page carries `next` on to /register). */}
              <Link href="/login?next=%2Fcheckout" className="font-semibold text-primary hover:underline">
                {t("cct.signIn")}
              </Link>{" "}
              — {t("cct.guestKept")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}