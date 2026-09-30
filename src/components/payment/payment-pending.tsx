"use client";

import { useState, useSyncExternalStore, type MouseEvent } from "react";
import { Check, Copy, LoaderCircle, PhoneCall, Radio, ShieldCheck, Smartphone } from "lucide-react";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";
import { useLocale } from "@/lib/i18n/use-locale";
import { isAppleMobile } from "@/lib/device/ios";
import { dialUssd } from "@/lib/capacitor/ussd";
import { nativePlatform } from "@/lib/capacitor/platform";

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
  /*
    Orange since 2026-09: no prompt is pushed, the customer dials the code and
    Orange then shows a merchant name to confirm. The box below says so in our
    own words — CamerPay's sentence is written for the merchant ("veuillez
    inviter le client à…") and is not shown.
  */
  const dial = Boolean(instruction?.customerInitiated && instruction.code);
  const steps = dial
    ? [
        t(appleMobile ? "sui.pay.dialStep1Copy" : "sui.pay.dialStep1"),
        t("sui.pay.dialStep2"),
        t("sui.pay.dialStep3"),
        t("sui.pay.dialStep4"),
      ]
    : [t("sui.pay.step1"), t("sui.pay.step2"), t("sui.pay.step3"), t("sui.pay.step4")];

  /**
   * In the Android app the code is dialled straight away (UssdDialerPlugin);
   * everywhere else the link opens the dialler with the code typed in. A
   * false answer means "not handled natively" and the href takes over.
   */
  function launchCall(event: MouseEvent<HTMLAnchorElement>, code: string) {
    // A browser follows the link as it always did.
    if (nativePlatform() !== "android") return;
    const href = event.currentTarget.href;
    event.preventDefault();
    void dialUssd(code).then((handled) => {
      if (!handled) window.location.href = href;
    });
  }

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

      <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-text-secondary">
        {instruction?.received ? t("sui.pay.dialReceivedBody") : dial ? t("sui.pay.dialPendingBody") : body}
      </p>

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

      {instruction?.received && (
        <div className="mt-4 w-full min-w-0 rounded-lg border border-success/35 bg-success-light p-4 text-left">
          <p className="flex items-center gap-2 font-semibold text-success">
            <Check className="size-4" aria-hidden />
            {t("sui.pay.dialReceivedTitle")}
          </p>
        </div>
      )}

      {instruction && !instruction.url && !instruction.received && (
        <div className="mt-4 w-full min-w-0 rounded-lg border border-warning/35 bg-warning-light p-4 text-left">
          <p className="font-semibold text-warning">{t(dial ? "sui.pay.dialTitle" : "sui.pay.orangeTitle")}</p>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            {dial ? t("sui.pay.dialBody", { phone }) : instruction.message}
          </p>
          {instruction.code && (
            <>
              <code className="mt-3 block break-all rounded bg-surface px-3 py-2 text-center text-base font-bold tracking-wide">
                {instruction.code}
              </code>
              {dial && instruction.merchantName && (
                <div className="mt-3 rounded border border-border bg-surface px-3 py-2">
                  <p className="flex items-center gap-1.5 text-xs text-text-light">
                    <ShieldCheck className="size-3.5" aria-hidden />
                    {t("sui.pay.dialName")}
                  </p>
                  <p className="mt-0.5 break-words text-sm font-bold">{instruction.merchantName}</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-secondary">{t("sui.pay.dialNameHint")}</p>
                </div>
              )}
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
                    onClick={(event) => launchCall(event, instruction.code!)}
                  >
                    <PhoneCall className="size-4" aria-hidden />
                    {t(dial ? "sui.pay.dialCall" : "sui.pay.openPhone")}
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
