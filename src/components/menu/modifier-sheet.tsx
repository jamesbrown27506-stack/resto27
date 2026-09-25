"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Checkbox, Radio, Textarea } from "@/components/ui/input";
import { QtyStepper } from "@/components/ui/qty-stepper";
import { Sheet } from "@/components/ui/sheet";
import { formatMoney } from "@/lib/format/currency";
import { lineUnitPrice } from "@/lib/orders/totals";
import { useCart, type CartOptionChoice } from "@/components/cart/cart-provider";
import { useLocale } from "@/lib/i18n/use-locale";
import type { MenuItem } from "@/lib/data/manager";

/**
 * The option picker (§3).
 *
 * Options are TWO LEVELS: a group carries min/max/required, and each option
 * inside carries a price delta. A required single-select group renders as
 * radios; a multi-select group renders as checkboxes capped at `maxSelect`.
 *
 * Flattening both into one list of checkboxes cannot express "choose exactly
 * one size", which is how orders reach a kitchen that cannot fill them.
 */
/**
 * Pre-selects the first available option of every required single-choice
 * group, so the primary action is never dead on arrival for a dish whose only
 * required question has an obvious default.
 */
function defaultSelection(item: MenuItem | null): Record<string, string[]> {
  if (!item) return {};

  const initial: Record<string, string[]> = {};
  for (const group of item.optionGroups) {
    if (group.isRequired && group.maxSelect === 1) {
      const first = group.options.find((o) => o.isAvailable);
      initial[group.id] = first ? [first.id] : [];
    } else {
      initial[group.id] = [];
    }
  }
  return initial;
}

export function ModifierSheet({
  item,
  restaurant,
  open,
  onClose,
  onAdded,
  onAddLine,
}: {
  item: MenuItem | null;
  restaurant: { id: string; name: string; slug: string };
  open: boolean;
  onClose: () => void;
  /**
   * Fired after a successful add, with the dish's name — the basket bar names
   * it back so the confirmation is specific rather than a count ticking over.
   */
  onAdded?: (name: string) => void;
  /**
   * Take the composed line instead of adding it to the delivery basket.
   *
   * The QR table page has its own basket (a dining round, not a checkout),
   * and used to add dishes by silently picking the first option of every
   * required group — the "+" that §3 says produces tickets the kitchen has to
   * chase. Passing this lets it reuse this exact picker; the delivery cart,
   * and its one-restaurant replace prompt, are then left untouched.
   */
  onAddLine?: (line: { menuItemId: string; name: string; unitPrice: number; quantity: number; options: CartOptionChoice[]; notes: string | null }) => void;
}) {
  const { addLine, itemCount, restaurantId: cartRestaurantId } = useCart();
  const { t } = useLocale();
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    defaultSelection(item),
  );
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  // Reset when a different dish is opened. Adjusted during render rather than
  // in an effect, so the sheet never paints one dish's selections over
  // another's for a frame.
  const sessionKey = open && item ? item.id : null;
  const [lastKey, setLastKey] = useState(sessionKey);
  if (lastKey !== sessionKey) {
    setLastKey(sessionKey);
    setSelected(defaultSelection(item));
    setQuantity(1);
    setNotes("");
  }

  const choices = useMemo<CartOptionChoice[]>(() => {
    if (!item) return [];
    return item.optionGroups.flatMap((group) =>
      (selected[group.id] ?? []).flatMap((optionId) => {
        const option = group.options.find((o) => o.id === optionId);
        if (!option) return [];
        return [
          {
            groupId: group.id,
            groupName: group.name,
            optionId: option.id,
            optionName: option.name,
            priceDelta: option.priceDelta,
          },
        ];
      }),
    );
  }, [item, selected]);

  if (!item) return null;

  const unitPrice = lineUnitPrice(item.price, choices.map((c) => c.priceDelta));

  /** Every required group must have at least `minSelect` choices. */
  const unmet = item.optionGroups.filter(
    (g) => g.isRequired && (selected[g.id]?.length ?? 0) < Math.max(1, g.minSelect),
  );
  const canAdd = unmet.length === 0;

  function toggle(groupId: string, optionId: string, single: boolean, max: number) {
    setSelected((current) => {
      const existing = current[groupId] ?? [];
      if (single) return { ...current, [groupId]: [optionId] };

      if (existing.includes(optionId)) {
        return { ...current, [groupId]: existing.filter((id) => id !== optionId) };
      }
      // Silently ignoring a tap past the cap is confusing; the inputs are
      // disabled at the cap instead, so this is a belt-and-braces guard.
      if (existing.length >= max) return current;
      return { ...current, [groupId]: [...existing, optionId] };
    });
  }

  function doAdd() {
    if (onAddLine) {
      onAddLine({
        menuItemId: item!.id,
        name: item!.name,
        unitPrice,
        quantity,
        options: choices,
        notes: notes.trim() || null,
      });
      onClose();
      onAdded?.(item!.name);
      return;
    }
    addLine({
      menuItemId: item!.id,
      name: item!.name,
      basePrice: item!.price,
      quantity,
      options: choices,
      notes: notes.trim() || null,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      restaurantSlug: restaurant.slug,
      prepMinutes: item!.prepMinutes,
    });
    onClose();
    onAdded?.(item!.name);
  }

  function add() {
    // One restaurant per basket. A basket from another kitchen would be wiped
    // by addLine without a word, so ask before the customer loses it.
    if (!onAddLine && itemCount > 0 && cartRestaurantId && cartRestaurantId !== restaurant.id) {
      setConfirmReplace(true);
      return;
    }
    doAdd();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={item.name}
      description={item.description}
      side="bottom"
      footer={
        /*
          `min-w-0` and a shrinkable button, for the reason documented in
          button.tsx: `fullWidth` asks for 100% of the row, and the stepper
          beside it then pushes the pair past the edge of a phone. The label
          also carries a formatted price, which is the longest string in the
          sheet — at 320px it was clipping.
        */
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <QtyStepper value={quantity} onChange={setQuantity} />
          <Button
            size="lg"
            fullWidth
            disabled={!canAdd}
            onClick={add}
            className="min-w-0 rounded-md px-4 sm:px-8"
          >
            <span className="truncate">
              {t("cbr.add", { price: formatMoney(unitPrice * quantity) })}
            </span>
          </Button>
        </div>
      }
    >
      {/*
        THE DISH'S OWN PHOTO, AT THE TOP OF ITS OWN SHEET.

        The picker showed a name, a description and a list of radio buttons —
        no image at all. Which meant the moment of deciding "yes, this one,
        with these options, for this much" happened with nothing to look at,
        having been reached by tapping a photograph. People tapped back out to
        check they had opened the right dish.

        Full-bleed: `-m-5` cancels the Sheet body's own padding so the photo
        runs edge to edge, the way it does on the card that was tapped, then
        `mb-5` restores the gap below it. Rendered only when there IS a photo —
        a grey placeholder here would cost the same space and say nothing.
      */}
      {item.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt=""
          className="-mx-5 -mt-5 mb-5 h-40 w-[calc(100%+2.5rem)] max-w-none object-cover sm:h-52"
        />
      )}

      <div className="flex flex-col gap-6">
        {item.optionGroups.map((group) => {
          const single = group.maxSelect === 1;
          const chosen = selected[group.id] ?? [];
          const atCap = !single && chosen.length >= group.maxSelect;

          return (
            <fieldset key={group.id}>
              <legend className="mb-2 flex w-full items-baseline justify-between gap-3">
                <span className="font-semibold">{group.name}</span>
                <span className="text-xs font-medium text-text-light">
                  {group.isRequired ? t("cbr.required") : t("cbr.optional")}
                  {!single && ` · ${t("cbr.max", { max: group.maxSelect })}`}
                </span>
              </legend>

              <div className="flex flex-col gap-2">
                {group.options.map((option) => {
                  const isChosen = chosen.includes(option.id);
                  const disabled = !option.isAvailable || (atCap && !isChosen);
                  const Control = single ? Radio : Checkbox;

                  return (
                    <Control
                      key={option.id}
                      name={group.id}
                      checked={isChosen}
                      disabled={disabled}
                      onChange={() => toggle(group.id, option.id, single, group.maxSelect)}
                      label={option.name}
                      description={
                        !option.isAvailable ? t("cbr.optionUnavailable") : undefined
                      }
                      trailing={
                        option.priceDelta !== 0
                          ? formatMoney(option.priceDelta, { signed: true })
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        <div>
          <label htmlFor="line-notes" className="mb-2 block font-semibold">
            {t("cbr.instructions")}{" "}
            <span className="text-xs font-normal text-text-light">
              {t("cbr.instructionsOptional")}
            </span>
          </label>
          <Textarea
            id="line-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("cbr.instructionsPh")}
          />
        </div>        {!canAdd && (
          <p role="status" className="text-sm font-medium text-warning">
            {t("cbr.chooseRequired", { groups: unmet.map((g) => g.name).join(", ") })}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmReplace}
        onClose={() => setConfirmReplace(false)}
        onConfirm={() => {
          setConfirmReplace(false);
          doAdd();
        }}
        title={t("cbr.replaceTitle")}
        message={t("cbr.replaceBody")}
        confirmLabel={t("cbr.replaceConfirm")}
        cancelLabel={t("cbr.cancel")}
      />
    </Sheet>
  );
}
