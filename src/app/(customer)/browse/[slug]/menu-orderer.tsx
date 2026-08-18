"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, Plus, ShoppingBag } from "lucide-react";
import { ModifierSheet } from "@/components/menu/modifier-sheet";
import { useCart } from "@/components/cart/cart-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/format/currency";
import { splitTags, ALLERGEN_LABEL, DIETARY_TAG_LABEL } from "@/lib/format/tags";
import { UNCATEGORIZED_SECTION_ID } from "@/lib/menu/constants";
import type { MenuItem } from "@/lib/data/manager";
import { useLocale } from "@/lib/i18n/use-locale";
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
  acceptingOrders = true,
}: {
  menu: MenuGroup[];
  restaurant: { id: string; name: string; slug: string };
  /** False when the restaurant paused orders — browse is fine, adding is not. */
  acceptingOrders?: boolean;
}) {
  const { lines, itemCount, totals } = useCart();
  const { t } = useLocale();
  const [active, setActive] = useState<MenuItem | null>(null);
  const [addedVisible, setAddedVisible] = useState(false);

  return (
    <>
      {/* Category jump nav — sticky under the header on long menus. */}
      <nav
        aria-label={t("cbr.categoriesAria")}
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

      {!acceptingOrders && (
        <div
          role="status"
          className="mt-5 flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning-light p-3.5 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("cbr.notAcceptingBanner")}</span>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-10 pb-28">
        {menu.map(({ category, items }) => (
          <section key={category.id} id={`cat-${category.id}`} className="scroll-mt-32">
            <h2 className="font-display text-xl font-bold text-primary">
              {category.id === UNCATEGORIZED_SECTION_ID ? t("cbr.others") : category.name}
            </h2>

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

                const notOrderable = soldOut || !acceptingOrders;

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={notOrderable}
                      onClick={() => setActive(item)}
                      className={cn(
                        "flex w-full items-start gap-4 rounded-lg border border-border bg-surface p-4 text-left transition-all",
                        notOrderable
                          ? "cursor-not-allowed opacity-55"
                          : "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm",
                      )}
                    >
                      {item.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt=""
                          loading="lazy"
                          className="size-20 shrink-0 rounded-md border border-border object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {item.name}
                          {soldOut && (
                            <span className="ml-2 text-xs font-normal text-error">
                              {t("cbr.soldOut")}
                            </span>
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
                              {t("cbr.lowStock", { count: item.stockQuantity ?? 0 })}
                            </Badge>
                          )}
                        </div>

                        <p className="tnum mt-2.5 font-display text-lg font-bold text-primary">
                          {formatMoney(item.price)}
                          {item.optionGroups.length > 0 && (
                            <span className="ml-1.5 text-xs font-normal text-text-light">
                              {t("cbr.plusOptions")}
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
        onAdded={() => setAddedVisible(true)}
      />

      {/* Added-to-basket confirmation. The sheet closing silently after an add
          leaves the customer unsure whether anything happened; this blurs the
          page and shows the running basket with a single obvious next step. */}
      <Dialog
        open={addedVisible}
        onClose={() => setAddedVisible(false)}
        title={t("cbr.addedTitle")}
        description={t("cbr.addedBody")}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setAddedVisible(false)}>
              {t("cbr.addedContinue")}
            </Button>
            <Link
              href="/checkout"
              className={buttonClasses({ className: "rounded-md" })}
              onClick={() => setAddedVisible(false)}
            >
              {t("cbr.addedFinalize")}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success-light text-success">
            <Check className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">
              {t("cbr.addedItems", { count: itemCount })}
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {lines.map((line) => (
                <li key={line.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="tnum font-medium">{line.quantity}×</span>{" "}
                    <span className="text-text-secondary">{line.name}</span>
                  </span>
                  <span className="tnum shrink-0 text-text-light">
                    {formatMoney(
                      (line.basePrice + line.options.reduce((s, o) => s + o.priceDelta, 0)) *
                        line.quantity,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm font-medium text-text-secondary">{t("cbr.addedTotal")}</span>
          <span className="tnum font-display text-lg font-bold text-primary">
            {formatMoney(totals.total)}
          </span>
        </div>
      </Dialog>

      {/* Sticky basket bar — the running total is the thing people check most
          on a long menu, and scrolling back to a header to find it is friction
          at exactly the wrong moment. */}
      {itemCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/97 p-3 backdrop-blur-md">
          <div className="container-page flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="tnum text-sm font-semibold">
                {t(itemCount > 1 ? "cbr.items_other" : "cbr.items_one", { count: itemCount })}
              </p>
              <p className="tnum text-xs text-text-light">
                {formatMoney(totals.total)} · {t("cbr.deliveryToConfirm")}
              </p>
            </div>
            <Link href="/cart" className={buttonClasses({ size: "lg", className: "rounded-md" })}>
              <ShoppingBag className="size-4" aria-hidden />
              {t("cbr.viewCart")}
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
