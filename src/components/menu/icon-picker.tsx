"use client";

import { CATEGORY_ICON_GROUPS, NavIcon } from "@/components/layout/icon";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

/**
 * Pick the icon that sits beside a menu category.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS IS A GRID OF PICTURES AND NOT A <select>.
 *
 *  The previous control was a dropdown of eleven raw identifiers —
 *  "UtensilsCrossed", "HandPlatter", "IceCream" — which asked a manager to
 *  turn an English CamelCase noun into a picture in their head. Six of the
 *  eleven were not even in the icon registry, so choosing one saved a name
 *  nothing could draw: the reported "the icons do not show".
 *
 *  A picker for a picture shows the pictures. CATEGORY_ICON_GROUPS is the one
 *  source of what is on offer and every entry in it is typed `IconName`, so
 *  the blank-square failure cannot come back.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Real <button type="button">, one per icon, with aria-pressed — so the whole
 * grid is reachable by Tab, operable by Space, and announced as a set of
 * toggles with a name each rather than sixty unlabelled graphics.
 */
export function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const { t } = useLocale();

  return (
    <div
      role="group"
      aria-label={t("mc.chooseIcon")}
      /* Bounded height, scrolled VERTICALLY only. Five groups unrolled would
         push the Sheet's Save button off the bottom of a phone, and the grid
         wraps rather than overflowing, so nothing here ever scrolls sideways
         to reach an icon. */
      className="max-h-72 overflow-y-auto overscroll-contain rounded-md border border-border bg-surface-2 p-3"
    >
      {CATEGORY_ICON_GROUPS.map((group) => {
        const groupLabel = t(`icons.group.${group.key}` as TranslationKey);

        return (
          <div key={group.key} className="mb-4 last:mb-0">
            <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
              <span>{groupLabel}</span>
            </p>

            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {group.icons.map((name) => {
                const selected = name === value;
                const label = t(`icons.name.${name}` as TranslationKey);

                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={selected}
                    aria-label={label}
                    title={label}
                    onClick={() => onChange(name)}
                    className={cn(
                      // min-h-11 wins over the square ratio on a narrow phone:
                      // the cell may be 38px wide, a thumb still needs 44px.
                      "grid aspect-square min-h-11 place-items-center rounded-md transition-colors",
                      "focus-visible:ring-[3px] focus-visible:ring-primary/30 focus-visible:outline-none",
                      // Selection is a thicker border AND a fill AND a colour
                      // change: colour alone is not a state you can see on a
                      // dim phone screen in a kitchen.
                      selected
                        ? "border-2 border-primary bg-primary-light text-primary"
                        : "border border-border bg-surface text-text-secondary hover:border-primary hover:text-primary",
                    )}
                  >
                    <NavIcon name={name} className="size-5" />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
