"use client";

import { useState } from "react";
import { Bike, Info, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { formatMoney, parseMoney } from "@/lib/format/currency";
import { useLocale } from "@/lib/i18n/use-locale";

/** Common quartier fees, offered as one tap rather than typing. */
const PRESETS = [1000, 1500, 2000, 2500, 3000];

/** Everything the dialog needs — deliberately not the whole order. */
export interface FeeTarget {
  reference: string;
  total: number;
  deliveryQuartier: string | null;
  deliveryAddress: string | null;
  deliveryLandmark?: string | null;
}

/**
 * The delivery-fee prompt shown when a manager confirms a delivery order.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE FEE IS QUOTED, NOT CALCULATED (§4).
 *
 *  Orders are placed with delivery_fee = 0. The restaurant enters the fee at
 *  confirmation based on where the customer actually is, and
 *  delivery_fee_set_at is stamped. This reflects how delivery works in Douala:
 *  the price depends on the quartier and the courier's judgement, and no
 *  distance formula gets it right.
 *
 *  The consequence — the customer committed to a total they had not yet seen —
 *  is a real product risk and is intentional, not an oversight. This dialog
 *  therefore shows the customer's address and the new total prominently: the
 *  person setting the number should see what they are asking someone to pay.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function DeliveryFeeDialog({
  order,
  open,
  pending = false,
  onClose,
  onConfirm,
}: {
  order: FeeTarget | null;
  open: boolean;
  pending?: boolean;
  onClose: () => void;
  onConfirm: (fee: number) => void;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState("");

  if (!order) return null;

  const fee = parseMoney(value) ?? 0;
  const newTotal = order.total + fee;
  const invalid = value !== "" && parseMoney(value) === null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("fee.title")}
      description={t("fee.order", { ref: order.reference })}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            <span>{t("common.cancel")}</span>
          </Button>
          <Button
            disabled={invalid || value === "" || pending}
            loading={pending}
            onClick={() => {
              onConfirm(fee);
              setValue("");
            }}
          >
            <span>{t("fee.confirm")}</span>
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="rounded-md border border-border bg-surface-2 p-3.5">
          <p className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="font-medium">{order.deliveryQuartier ?? "—"}</span>
              {order.deliveryAddress && (
                <span className="block text-text-secondary">{order.deliveryAddress}</span>
              )}
              {order.deliveryLandmark && (
                <span className="block text-text-light">{order.deliveryLandmark}</span>
              )}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setValue(String(preset))}
              className={`tnum rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                fee === preset && value !== ""
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-border hover:border-primary hover:text-primary"
              }`}
            >
              {formatMoney(preset, { showSymbol: false })}
            </button>
          ))}
        </div>

        <Field label={t("fee.amount")} htmlFor="fee" required>
          <Input
            id="fee"
            inputMode="numeric"
            icon={<Bike />}
            suffix="FCFA"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            invalid={invalid}
            placeholder="1 500"
            autoFocus
          />
        </Field>

        <p className="flex items-baseline justify-between rounded-md bg-primary-light px-4 py-3">
          <span className="text-sm font-medium">{t("fee.newTotal")}</span>
          <span className="tnum font-display text-xl font-bold text-primary">
            {formatMoney(newTotal)}
          </span>
        </p>

        <p className="flex items-start gap-2 text-xs leading-relaxed text-text-light">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{t("fee.hint")}</span>
        </p>
      </div>
    </Dialog>
  );
}
