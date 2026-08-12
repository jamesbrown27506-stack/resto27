"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, ShoppingBag } from "lucide-react";
import { ModifierSheet } from "@/components/menu/modifier-sheet";
import { useCart } from "@/components/cart/cart-provider";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { formatMoney } from "@/lib/format/currency";
import { splitTags, ALLERGEN_LABEL, DIETARY_TAG_LABEL } from "@/lib/format/tags";
import type { MenuItem } from "@/lib/data/manager";
import { cn } from "@/lib/utils";

interface MenuGroup {
  category: { id: string; name: string };
  items: MenuItem[];
}

/**
 * Orderable menu.
 *
 * Every item opens the modifier sheet rather than adding directly, because a
 * dish with a required option group (§3) cannot be added without asking. A "+"
 * that silently picks defaults produces tickets the kitchen has to chase.
 */
export function MenuOrderer({
  menu,
  restaurant,
}: {
  menu: MenuGroup[];
  restaurant: { id: string; name: string; slug: string };
}) {
  const { itemCount, totals } = useCart();
  const [active, setActive] = useState<MenuItem | null>(null);

  return (
    <>
      {/* Category jump nav — sticky under the header on long menus. */}
      <nav
        aria-label="Catégories"
        className="no-scrollbar sticky top-16 z-20 -mx-6 flex gap-2 overflow-x-auto border-b border-border bg-bg/95 px-6 py-3 backdrop-blur-md"
      >
        {menu.map(({ category }) => (
          <a
            key={category.id}
            href={`#cat-${category.id}`}
            className="shrink-0 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-text-secondary transition-colors hover:border-primary hover:text-primary"
          >
            {category.name}
          </a>
        ))}
      </nav>

      <div className="mt-8 flex flex-col gap-10 pb-28">
        {menu.map(({ category, items }) => (
          <section key={category.id} id={`cat-${category.id}`} className="scroll-mt-32">
            <h2 className="font-display text-xl font-bold text-primary">{category.name}</h2>

            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {items.map((item) => {
                const soldOut =
                  !item.isAvailable || (item.trackStock && item.stockQuantity === 0);
                const lowStock =
                  item.trackStock &&
                  item.stockQuantity !== null &&
                  item.lowStockThreshold !== null &&
                  item.stockQuantity > 0 &&
                  item.stockQuantity <= item.lowStockThreshold;
                const tags = splitTags(item.dietaryTags);
                const allergens = splitTags(item.allergens);

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={soldOut}
                      onClick={() => setActive(item)}
                      className={cn(
                        "flex w-full items-start gap-4 rounded-lg border border-border bg-surface p-4 text-left transition-all",
                        soldOut
                          ? "cursor-not-allowed opacity-55"
                          : "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {item.name}
                          {soldOut && (
                            <span className="ml-2 text-xs font-normal text-error">Épuisé</span>
                          )}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-text-secondary">
                          {item.description}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {tags.map((t) => (
                            <Badge key={t} tone="success">
                              {DIETARY_TAG_LABEL[t] ?? t}
                            </Badge>
                          ))}
                          {allergens.map((a) => (
                            <Badge key={a} tone="warning">
                              {ALLERGEN_LABEL[a] ?? a}
                            </Badge>
                          ))}
                          {lowStock && (
                            <Badge tone="warning">
                              Plus que {item.stockQuantity}
                            </Badge>
                          )}
                        </div>

                        <p className="tnum mt-2.5 font-display text-lg font-bold text-primary">
                          {formatMoney(item.price)}
                          {item.optionGroups.length > 0 && (
                            <span className="ml-1.5 text-xs font-normal text-text-light">
                              + options
                            </span>
                          )}
                        </p>
                      </div>

                      <span
                        aria-hidden
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-full",
                          soldOut ? "bg-surface-2 text-text-light" : "bg-primary text-primary-fg",
                        )}
                      >
                        <Plus className="size-4" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <ModifierSheet
        item={active}
        restaurant={restaurant}
        open={active !== null}
        onClose={() => setActive(null)}
      />

      {/* Sticky basket bar — the running total is the thing people check most
          on a long menu, and scrolling back to a header to find it is friction
          at exactly the wrong moment. */}
      {itemCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/97 p-3 backdrop-blur-md">
          <div className="container-page flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="tnum text-sm font-semibold">
                {itemCount} article{itemCount > 1 ? "s" : ""}
              </p>
              <p className="tnum text-xs text-text-light">
                {formatMoney(totals.total)} · livraison à confirmer
              </p>
            </div>
            <Link href="/cart" className={buttonClasses({ size: "lg", className: "rounded-md" })}>
              <ShoppingBag className="size-4" aria-hidden />
              Voir le panier
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
