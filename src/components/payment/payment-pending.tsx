"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, LoaderCircle, PhoneCall, Radio, ShieldCheck, Smartphone } from "lucide-react";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";
import { useLocale } from "@/lib/i18n/use-locale";
import { isAppleMobile } from "@/lib/device/ios";

const noSubscribe = () => () => {};

/**
 * iPhone/iPad, read once on the client. `false` on the server and during
 * hydration, so both renders agree; the browser then answers truthfully.
 */
function useAppleMobile(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => isAppleMobile(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    () => false,
  );
}

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
  const { t } = useLocale();
  // iOS blocks `*` and `#` in tel: links, so "Ouvrir le téléphone" would dial
  // a mangled code there. Copy-and-paste is the path that works on iPhone.
  const appleMobile = useAppleMobile();
  const [copied, setCopied] = useState(false);
  const steps = [t("sui.pay.step1"), t("sui.pay.step2"), t("sui.pay.step3"), t("sui.pay.step4")];

  function copyCode(code: string) {
    void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => setCopied(false));
  }
  return (
    <div role="status" aria-live="polite" className="mx-auto flex w-full min-w-0 max-w-sm flex-col items-center overflow-x-hidden text-center">
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

      <dl className="mt-5 grid w-full min-w-0 gap-3 rounded-lg border border-border bg-surface-2 p-4 text-left text-sm">
        <div className="grid w-full min-w-0 grid-cols-2 items-center gap-3">
          <dt className="min-w-0 text-left leading-snug text-text-light">{amountLabel}</dt>
          <dd className="tnum min-w-0 text-right font-bold text-primary">{amount}</dd>
        </div>
        <div className="grid w-full min-w-0 grid-cols-2 items-center gap-3">
          <dt className="min-w-0 text-left leading-snug text-text-light">{referenceLabel}</dt>
          <dd className="min-w-0 break-all text-right font-mono font-semibold">{reference}</dd>
        </div>
        <div className="grid w-full min-w-0 grid-cols-2 items-center gap-3">
          <dt className="flex min-w-0 items-center gap-1.5 text-left leading-snug text-text-light">
            <Smartphone className="size-3.5" aria-hidden />
            {phoneLabel}
          </dt>
          <dd className="tnum min-w-0 break-all text-right font-semibold">{phone}</dd>
        </div>
        <div className="grid w-full min-w-0 grid-cols-2 items-center gap-3 border-t border-border pt-3">
          <dt className="flex min-w-0 items-center gap-1.5 text-left leading-snug text-text-light">
            <ShieldCheck className="size-3.5" aria-hidden />
            {gatewayLabel}
          </dt>
          {/* The gateway (CamerPay or SasPay) is a platform setting; the
              customer only needs to recognise their own operator. */}
          <dd className="min-w-0 break-words text-right font-semibold">MTN MoMo · Orange Money</dd>
        </div>
      </dl>

      {/*
        A HOSTED PAYMENT PAGE (SasPay, usually Orange Money): no prompt reaches
        the phone, so nothing is charged until the customer opens this page.
        A new tab, so this screen keeps checking and turns green by itself.
      */}
      {instruction?.url && (
        <div className="mt-4 w-full min-w-0 rounded-lg border border-info/35 bg-info-light p-4 text-left">
          <p className="font-semibold text-info">{t("sui.pay.pageTitle")}</p>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">{instruction.message}</p>
          <a
            href={instruction.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-center text-sm font-semibold text-white"
          >
            {t("sui.pay.openPage")}
          </a>
          <p className="mt-2 text-xs leading-relaxed text-text-secondary">{t("sui.pay.pageHint")}</p>
        </div>
      )}

      {instruction && !instruction.url && (
        <div className="mt-4 w-full min-w-0 rounded-lg border border-warning/35 bg-warning-light p-4 text-left">
          <p className="font-semibold text-warning">{t("sui.pay.orangeTitle")}</p>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">{instruction.message}</p>
          {instruction.code && (
            <>
              <code className="mt-3 block break-all rounded bg-surface px-3 py-2 text-sm font-bold">
                {instruction.code}
              </code>
              <ol className="mt-3 grid gap-1.5 text-xs leading-relaxed text-text-secondary">
                {steps.map((step, index) => (
                  <li key={step} className="flex gap-2"><span className="tnum font-bold text-warning">{index + 1}.</span><span>{step}</span></li>
                ))}
              </ol>
              <div className={appleMobile ? "mt-3 grid grid-cols-1 gap-2" : "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"}>
                <button
                  type="button"
                  className="inline-flex min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-center text-sm leading-tight font-semibold"
                  onClick={() => copyCode(instruction.code!)}
                >
                  {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                  {copied ? t("sui.pay.copied") : t("sui.pay.copy")}
                </button>
                {!appleMobile && (
                  <a
                    className="inline-flex min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 text-center text-sm leading-tight font-semibold text-white"
                    href={"tel:" + encodeURIComponent(instruction.code)}
                  >
                    <PhoneCall className="size-4" aria-hidden />
                    {t("sui.pay.openPhone")}
                  </a>
                )}
              </div>
              {appleMobile && (
                <p className="mt-2 text-xs leading-relaxed text-text-secondary">{t("sui.pay.iosHint")}</p>
              )}
            </>
          )}
        </div>
      )}

      <p className="mt-4 w-full text-xs leading-relaxed text-text-light">{hint}</p>
    </div>
  );
}
