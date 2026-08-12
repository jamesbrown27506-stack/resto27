"use client";

import Link from "next/link";
import { ArrowRight, ShoppingBag, Store } from "lucide-react";
import { useCart } from "@/components/cart/cart-provider";
import { CartLineRow, CartSummary, LoyaltyRedeem, PromoInput } from "@/components/cart/cart-parts";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The basket.
 *
 * Reachable SIGNED OUT (§2, §14.3) — a guest can fill it and see a total, and
 * it merges into the account on sign-in. Forcing registration before someone
 * can see what they owe is the single biggest drop-off point in food ordering.
 */
export function CartView({ balance }: { balance: number }) {
  const { lines, itemCount } = useCart();

  // Every line in a basket belongs to one restaurant — you cannot order from
  // two kitchens in one delivery.
  const restaurant = lines[0];

  return (
    <div className="container-page w-full py-8 lg:py-12">
      <h1 className="font-display text-3xl font-bold">Votre panier</h1>

      {lines.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<ShoppingBag />}
            title="Votre panier est vide"
            description="Parcourez les restaurants de votre quartier et composez votre commande."
            action={
              <Link href="/browse" className={buttonClasses()}>
                Voir les restaurants
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
                <p className="text-sm text-text-light">
                  {itemCount} article{itemCount > 1 ? "s" : ""}
                </p>
              </div>
              <Link
                href={`/browse/${restaurant.restaurantSlug}`}
                className="ml-auto shrink-0 text-sm font-semibold text-primary hover:underline"
              >
                Ajouter
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
            <LoyaltyRedeem balance={balance} />

            <CartSummary>
              <Link
                href="/checkout"
                className={buttonClasses({ size: "lg", fullWidth: true, className: "rounded-md" })}
              >
                Passer commande
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </CartSummary>

            <p className="text-center text-xs text-text-light">
              Pas encore inscrit ?{" "}
              <Link href="/login" className="font-semibold text-primary hover:underline">
                Connectez-vous
              </Link>{" "}
              — votre panier est conservé.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}