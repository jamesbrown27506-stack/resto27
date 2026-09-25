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
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  SINCE SEP 2026 THE FEE IS PAID IN CASH TO THE RIDER (migration 0059).
 *
 *  `orders.total` is exactly what the customer pays ONLINE — the food. The
 *  delivery fee quoted here is collected by the rider at the door. So the
 *  dialog no longer shows a "new total": adding the two made managers tell
 *  customers the wrong online amount. It shows the two amounts side by side
 *  — paid online, cash to the rider — and says plainly which is which.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function DeliveryFeeDialog({
  order,
  open,
  pending = false,
  band,
  onClose,
  onConfirm,
}: {
  order: FeeTarget | null;
  open: boolean;
  pending?: boolean;
  /**
   * What this restaurant advertises (migration 0035). 0 = not declared.
   *
   * The customer read these numbers on the restaurant page and at checkout
   * BEFORE they ordered. The dialog therefore pre-fills the minimum and
   * refuses anything above the maximum — the server refuses it too, but a
   * manager should be stopped by the form rather than by an error after
   * they have already pressed confirm.
   */
  band?: { min: number; max: number };
  onClose: () => void;
  onConfirm: (fee: number) => void;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState("");

  const min = band?.min ?? 0;
  const max = band?.max ?? 0;

  /*
    Pre-fill the advertised minimum when a new order opens the dialog.

    Adjusted during render rather than in an effect — the same pattern the
    modifier sheet and the typed-confirm dialog use — so the field never
    paints empty for a frame and never carries the previous order's number
    into the next one.
  */
  const sessionKey = open && order ? order.reference : null;
  const [lastKey, setLastKey] = useState(sessionKey);
  if (lastKey !== sessionKey) {
    setLastKey(sessionKey);
    setValue(min > 0 ? String(min) : "");
  }

  if (!order) return null;

  const fee = parseMoney(value) ?? 0;
  const malformed = value !== "" && parseMoney(value) === null;
  // Above what the customer was promised. Its own flag, so the message can
  // say WHICH rule was broken rather than just colouring the box red.
  const overCeiling = !malformed && max > 0 && fee > max;
  const invalid = malformed || overCeiling;

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
            <span>{t("mops.fee.confirm")}</span>
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

        {/* The band, said plainly, above the number being chosen. */}
        {(min > 0 || max > 0) && (
          <p className="flex items-start gap-2 rounded-md border border-info/25 bg-info-light p-3 text-xs leading-relaxed text-info">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {max > 0
                ? t("fee.band", {
                    min: formatMoney(min),
                    max: formatMoney(max),
                  })
                : t("fee.bandFrom", { min: formatMoney(min) })}
            </span>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {/* A preset the restaurant has promised never to charge is not a
              choice — offering it only invites the refusal below. */}
          {PRESETS.filter((preset) => max === 0 || preset <= max).map((preset) => (
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

        <Field
          label={t("mops.fee.label")}
          htmlFor="fee"
          required
          error={overCeiling ? t("fee.overMax", { max: formatMoney(max) }) : undefined}
        >
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

        {/* Two amounts, never summed: one is paid online, the other in cash. */}
        <dl className="flex flex-col gap-2 rounded-md bg-primary-light px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm font-medium">{t("mops.fee.online")}</dt>
            <dd className="tnum font-display text-xl font-bold text-primary">{formatMoney(order.total)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-primary/20 pt-2">
            <dt className="text-sm font-medium">{t("mops.fee.cash")}</dt>
            <dd className="tnum font-display text-lg font-bold">{formatMoney(fee)}</dd>
          </div>
        </dl>

        <p className="flex items-start gap-2 text-xs leading-relaxed text-text-secondary">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{t("mops.fee.cashNote")}</span>
        </p>
      </div>
    </Dialog>
  );
}
