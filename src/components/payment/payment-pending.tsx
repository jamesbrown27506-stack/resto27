"use client";

import { Copy, LoaderCircle, PhoneCall, Radio, ShieldCheck, Smartphone } from "lucide-react";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";

export interface PaymentPendingViewProps {
  body: string;
  hint: string;
  amountLabel: string;
  amount: string;
  referenceLabel: string;
  reference: string;
  phoneLabel: string;
  phone: string;
  gatewayLabel: string;
  /** True while the collection request itself is still being sent. */
  requesting?: boolean;
  instruction?: PaymentInstruction | null;
}

/**
 * The shared, screen-sized state for every CamerPay collection that is waiting
 * on a Mobile Money PIN. It deliberately contains the transaction facts so a
 * user never wonders whether a spinner belongs to the payment they just made.
 */
export function PaymentPendingView({
  body,
  hint,
  amountLabel,
  amount,
  referenceLabel,
  reference,
  phoneLabel,
  phone,
  gatewayLabel,
  requesting = false,
  instruction,
}: PaymentPendingViewProps) {
  return (
    <div role="status" aria-live="polite" className="text-center">
      <div className="relative mx-auto grid size-20 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-info/10" aria-hidden />
        <span className="relative grid size-16 place-items-center rounded-full bg-info-light text-info">
          {requesting ? (
            <Radio className="size-7 animate-pulse" aria-hidden />
          ) : (
            <LoaderCircle className="size-7 animate-spin" aria-hidden />
          )}
        </span>
      </div>

      <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-text-secondary">{body}</p>

      <dl className="mx-auto mt-5 grid max-w-sm gap-2 rounded-lg border border-border bg-surface-2 p-4 text-left text-sm">
        <div className="flex min-w-0 items-center justify-between gap-4">
          <dt className="shrink-0 text-text-light">{amountLabel}</dt>
          <dd className="tnum min-w-0 text-right font-bold text-primary">{amount}</dd>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-4">
          <dt className="shrink-0 text-text-light">{referenceLabel}</dt>
          <dd className="min-w-0 truncate text-right font-mono font-semibold">{reference}</dd>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-4">
          <dt className="flex shrink-0 items-center gap-1.5 text-text-light">
            <Smartphone className="size-3.5" aria-hidden />
            {phoneLabel}
          </dt>
          <dd className="tnum min-w-0 truncate text-right font-semibold">{phone}</dd>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-4 border-t border-border pt-2">
          <dt className="flex shrink-0 items-center gap-1.5 text-text-light">
            <ShieldCheck className="size-3.5" aria-hidden />
            {gatewayLabel}
          </dt>
          <dd className="font-semibold">CamerPay</dd>
        </div>
      </dl>

      {instruction && (
        <div className="mx-auto mt-4 max-w-sm rounded-lg border border-warning/35 bg-warning-light p-4 text-left">
          <p className="font-semibold text-warning">Action Orange requise / Orange action required</p>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">{instruction.message}</p>
          {instruction.code && (
            <>
              <code className="mt-3 block break-all rounded bg-surface px-3 py-2 text-sm font-bold">
                {instruction.code}
              </code>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-semibold"
                  onClick={() => void navigator.clipboard.writeText(instruction.code!)}
                >
                  <Copy className="size-4" aria-hidden />
                  Copier / Copy
                </button>
                <a
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white"
                  href={"tel:" + encodeURIComponent(instruction.code)}
                >
                  <PhoneCall className="size-4" aria-hidden />
                  Téléphone / Phone
                </a>
              </div>
            </>
          )}
        </div>
      )}

      <p className="mx-auto mt-4 max-w-sm text-xs leading-relaxed text-text-light">{hint}</p>
    </div>
  );
}
