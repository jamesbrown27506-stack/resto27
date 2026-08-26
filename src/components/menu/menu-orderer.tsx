"use client";

/*
  DIETARY TAGS AND ALLERGENS ARE NO LONGER SHOWN, ANYWHERE.

  They were a straight import of a European menu convention. In Cameroon
  they are not what anyone reads a menu for — the labels went untouched by
  restaurants and unread by customers, while taking the most valuable strip
  of every dish row and every picker: the line directly under the name.

  The COLUMNS stay (`menu_items.dietary_tags`, `menu_items.allergens`), and
  so does lib/menu/tags. Nothing is dropped and nothing is migrated, so any
  restaurant that filled them in keeps its data and this is reversible by
  putting the markup back. What is gone is the UI.
*/
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Plus, ShoppingBag, SlidersHorizontal } from "lucide-react";
import { ModifierSheet } from "@/components/menu/modifier-sheet";
import { useCart } from "@/components/cart/cart-provider";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { formatMoney } from "@/lib/format/currency";
import { UNCATEGORIZED_SECTION_ID } from "@/lib/menu/constants";
import type { MenuItem } from "@/lib/data/manager";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";

/** How long the bar names the dish before decaying back to the total. */
const ADDED_DECAY_MS = 4_000;

interface MenuGroup {
  category: { id: string; name: string };
  items: MenuItem[];
}

/**
 * Orderable menu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE RULE USED TO BE "EVERY ITEM OPENS THE SHEET". IT IS NARROWER NOW.
 *
 *  The reasoning behind the old rule is still right, and still enforced: a
 *  dish with a required option group (§3) cannot be added without asking,
 *  because a "+" that silently picks defaults produces tickets the kitchen
 *  has to chase.
 *
 *  But that argument is about dishes that HAVE options, and it was being
 *  applied to every dish on the card. A dish with no option groups has no
 *  default to pick silently — there is nothing to ask — so opening a sheet
 *  for it only to press one button was pure friction, ten times over for a
 *  ten-dish order.
 *
 *  So the "+" adds where there is nothing to ask, and opens the sheet where
 *  there is. Tapping the row body still opens the sheet for every dish, so
 *  quantity, notes and the photograph stay one tap away either way.
 * ─────────────────────────────────────────────────────────────────────────
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
  const { addLine, itemCount, totals, restaurantId: cartRestaurantId } = useCart();
  const { t } = useLocale();
  const [active, setActive] = useState<MenuItem | null>(null);
  /*
    ─────────────────────────────────────────────────────────────────────────
     THE CONFIRMATION IS THE BASKET BAR, NOT A MODAL.

     Adding a dish used to open a blocking dialog with "Keep browsing" and
     "Finalize order". Ordering ten things therefore meant dismissing ten
     modals, and the second button was a trap on every one of them — the
     journey the customer is actually on is "add, add, add", and the dialog
     interrupted it each time to offer to end it.

     Everything the dialog said, the sticky bar below already says and keeps
     saying: how many items, how much, and one way to the basket. So the
     dialog is gone and the bar grows a second, temporary state instead —
     for a few seconds it names the dish that just landed, then decays back
     to the standing count and total. One surface, two states, nothing to
     dismiss.

     Holding the NAME rather than a boolean is what makes the confirmation
     specific: "Ajouté : Poulet DG" answers "did that register?" in a way a
     count ticking 3 -> 4 at the bottom edge of a phone does not.
    ─────────────────────────────────────────────────────────────────────────
  */
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const decayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Name the dish for a few seconds, then fall back to the standing total. */
  const announceAdded = useCallback((name: string) => {
    setJustAdded(name);
    if (decayRef.current) clearTimeout(decayRef.current);
    decayRef.current = setTimeout(() => setJustAdded(null), ADDED_DECAY_MS);
  }, []);

  // A pending decay must not fire into an unmounted component, and adding a
  // second dish restarts the clock rather than stacking two timers.
  useEffect(() => () => {
    if (decayRef.current) clearTimeout(decayRef.current);
  }, []);

  /**
   * Add an option-less dish straight to the basket.
   *
   * Guards the same thing the sheet guards: one restaurant per basket. A
   * basket from another kitchen is wiped by `addLine` without a word, so a
   * one-tap add that crosses restaurants must go through the sheet's
   * confirmation instead of quietly discarding what is already there.
   */
  const quickAdd = useCallback(
    (item: MenuItem) => {
      if (itemCount > 0 && cartRestaurantId && cartRestaurantId !== restaurant.id) {
        setActive(item);
        return;
      }
      addLine({
        menuItemId: item.id,
        name: item.name,
        basePrice: item.price,
        quantity: 1,
        options: [],
        notes: null,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        restaurantSlug: restaurant.slug,
        prepMinutes: item.prepMinutes,
      });
      announceAdded(item.name);
    },
    [addLine, announceAdded, cartRestaurantId, itemCount, restaurant],
  );

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
                const notOrderable = soldOut || !acceptingOrders;
                /*
                  ONE TAP ONLY WHERE THERE IS NOTHING TO ASK.

                  The rule the file header lays out: a dish with a required
                  option group cannot be added without asking, because a "+"
                  that silently picks defaults produces tickets the kitchen
                  has to chase. A dish with NO option groups has no default to
                  pick silently, so that reasoning simply does not reach it —
                  and making those ten dishes ten sheet-openings was the
                  friction being reported.
                */
                const quickAddable = item.optionGroups.length === 0;

                return (
                  <li key={item.id} className="relative">
                    <button
                      type="button"
                      disabled={notOrderable}
                      onClick={() => setActive(item)}
                      className={cn(
                        "flex w-full items-start gap-4 rounded-lg border border-border bg-surface p-4 pr-16 text-left transition-all",
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

                        {/* Diet and allergen badges used to live here — see
                            the note at the top of this file. Low stock stays:
                            it changes whether you can order the dish. */}
                        {lowStock && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge tone="warning">
                              {t("cbr.lowStock", { count: item.stockQuantity ?? 0 })}
                            </Badge>
                          </div>
                        )}

                        <p className="tnum mt-2.5 font-display text-lg font-bold text-primary">
                          {formatMoney(item.price)}
                          {item.optionGroups.length > 0 && (
                            <span className="ml-1.5 text-xs font-normal text-text-light">
                              {t("cbr.plusOptions")}
                            </span>
                          )}
                        </p>
                      </div>

                    </button>

                    {/*
                      THE "+" IS ITS OWN CONTROL, AND IT DOES A DIFFERENT
                      THING PER DISH.

                      A dish with no option groups is added in one tap. A dish
                      WITH them opens the sheet, because there is a required
                      question to answer — see the note at the top of the file
                      for why that distinction is the whole rule.

                      Different icon for a different outcome: a plus adds, the
                      sliders open a picker. It reinforces the "+ options"
                      suffix the price line already carries, and it is why
                      this cannot be the same element as the row body — a
                      button inside a button is invalid, and the two
                      genuinely do different things now.
                    */}
                    {!notOrderable && (
                      <button
                        type="button"
                        onClick={() =>
                          quickAddable ? quickAdd(item) : setActive(item)
                        }
                        aria-label={t(quickAddable ? "cbr.quickAdd" : "cbr.chooseOptions", {
                          name: item.name,
                        })}
                        className="absolute top-4 right-4 grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-fg transition-transform hover:scale-105 active:scale-95"
                      >
                        {quickAddable ? (
                          <Plus className="size-4" aria-hidden />
                        ) : (
                          <SlidersHorizontal className="size-4" aria-hidden />
                        )}
                      </button>
                    )}
                    {notOrderable && (
                      <span
                        aria-hidden
                        className="absolute top-4 right-4 grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-text-light"
                      >
                        <Plus className="size-4" />
                      </span>
                    )}
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
        onAdded={(name) => announceAdded(name)}
      />

      {/*
        ─────────────────────────────────────────────────────────────────────
         THE STICKY BASKET BAR — AND IT WAS INVISIBLE ON A PHONE.

         `z-30` at `bottom-0`, underneath a mobile tab bar that is `z-40` at
         `bottom-0`, opaque, and sixty-four pixels tall. Below `lg` the bar
         this whole feature depends on was simply behind it, which is almost
         certainly why a blocking modal was reached for in the first place:
         with no visible running total, something had to confirm the add.

         So it now sits ABOVE the tab bar on small screens and returns to the
         bottom edge at `lg`, where there is no tab bar to clear. The offset is
         the tab bar's own geometry — 4rem of row plus the gesture inset it
         pads itself with — kept in one expression here rather than as a magic
         number.
        ─────────────────────────────────────────────────────────────────────
      */}
      {itemCount > 0 && (
        <div
          className="fixed inset-x-0 z-30 border-t border-border bg-surface/97 p-3 backdrop-blur-md lg:bottom-0"
          style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="container-page flex items-center gap-4">
            <div className="min-w-0 flex-1">
              {/*
                `aria-live="polite"` because the whole point is a confirmation
                nobody has to look for. A sighted customer sees the bar change;
                a screen reader is told, without the focus theft a dialog
                commits. `atomic` so the dish name and the total are read as
                one sentence rather than two fragments.
              */}
              <div aria-live="polite" aria-atomic="true">
                {justAdded ? (
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
                    <Check className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{t("cbr.addedOne", { name: justAdded })}</span>
                  </p>
                ) : (
                  <p className="tnum text-sm font-semibold">
                    {t(itemCount > 1 ? "cbr.items_other" : "cbr.items_one", { count: itemCount })}
                  </p>
                )}
                <p className="tnum text-xs text-text-light">
                  {justAdded
                    ? `${t(itemCount > 1 ? "cbr.items_other" : "cbr.items_one", { count: itemCount })} · ${formatMoney(totals.total)}`
                    : `${formatMoney(totals.total)} · ${t("cbr.deliveryToConfirm")}`}
                </p>
              </div>
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
