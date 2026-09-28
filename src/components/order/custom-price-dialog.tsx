"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format/currency";
import { useLocale } from "@/lib/i18n/use-locale";
import { isPriceInRange } from "@/lib/menu/custom-price";
import type { OrderItemRow } from "@/lib/data/orders";

/**
 * "Prix confirmé par le restaurant" (0069) — the price of each customizable
 * dish, set while accepting the order.
 *
 * The customer's own words are shown above each field: they are what is
 * being priced. The field starts at the minimum the customer was quoted and
 * refuses anything outside the range (advanceOrder re-checks), so the
 * restaurant can never ask more than the customer agreed to see.
 */
export function CustomPriceDialog({
  items,
  open,
  pending = false,
  onClose,
  onConfirm,
}: {
  items: OrderItemRow[];
  open: boolean;
  pending?: boolean;
  onClose: () => void;
  onConfirm: (prices: Record<string, number>) => void;
}) {
  const { t } = useLocale();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const value = (item: OrderItemRow) => drafts[item.id] ?? String(item.priceMin ?? item.unitPrice);
  const valid = items.every((item) =>
    isPriceInRange(Math.round(Number(value(item))), item.priceMin ?? item.unitPrice, item.priceMax));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("ons.d.dialogTitle")}
      description={t("ons.d.dialogBody")}
      size="md"
      footer={
        <>
          <Button variant="outline" disabled={pending} onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            disabled={pending || !valid}
            loading={pending}
            onClick={() => onConfirm(Object.fromEntries(items.map((item) => [item.id, Math.round(Number(value(item)))])))}
          >
            {t("ons.d.dialogConfirm")}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-4">
        {items.map((item) => {
          const min = item.priceMin ?? item.unitPrice;
          const max = Math.max(min, item.priceMax ?? min);
          const price = Math.round(Number(value(item)));
          const ok = isPriceInRange(price, min, max);
          return (
            <li key={item.id} className="rounded-md border border-border p-3">
              <p className="font-semibold">{item.quantity}× {item.name}</p>
              {item.optionsLabel && <p className="text-xs text-text-secondary">{item.optionsLabel}</p>}
              {item.notes && (
                <p className="mt-1 rounded bg-surface-2 p-2 text-sm italic">« {item.notes} »</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  className="w-36"
                  type="number"
                  inputMode="numeric"
                  min={min}
                  max={max}
                  step={1}
                  suffix="FCFA"
                  invalid={!ok}
                  value={value(item)}
                  aria-label={t("ons.d.unitPriceOf", { name: item.name })}
                  onChange={(e) => setDrafts((current) => ({ ...current, [item.id]: e.target.value }))}
                />
                <span className="tnum text-xs text-text-secondary">
                  {t("ons.d.rangeHint", { min: formatMoney(min), max: formatMoney(max) })}
                </span>
              </div>
              {item.quantity > 1 && ok && (
                <p className="tnum mt-1 text-xs text-text-secondary">
                  {t("ons.d.lineTotal", { amount: formatMoney(price * item.quantity) })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
