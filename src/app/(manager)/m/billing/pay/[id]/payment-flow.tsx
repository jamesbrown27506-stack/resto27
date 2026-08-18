"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Ban, Check, LoaderCircle, Smartphone } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format/currency";
import { useDates } from "@/lib/format/use-dates";
import { useLocale } from "@/lib/i18n/use-locale";
import { checkInvoicePayment, payInvoice } from "@/lib/data/subscribe-actions";
import type { InvoiceDetail } from "@/lib/data/invoices";

/**
 * Paying an invoice by Mobile Money.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHAT THE BUTTON ACTUALLY DOES
 *
 *  `payInvoice` starts a payment attempt through the platform's one payment
 *  path (lib/payments/collect.ts):
 *
 *    sandbox — the attempt succeeds instantly and the subscription is
 *              activated here and now. No money moves.
 *    live    — CamerPay pushes a charge to the tenant's handset; the attempt
 *              stays `pending` until the tenant approves, and this screen
 *              polls it. The webhook settles it too if the page is closed —
 *              settlement is idempotent, so the two cannot disagree.
 *
 *  The final "paid" state is always produced by the same activation path
 *  (invoice-activation.ts) whether it was reached from this page, from the
 *  admin console, or from CamerPay's callback.
 * ─────────────────────────────────────────────────────────────────────────
 */

type Phase = "idle" | "pending" | "succeeded" | "failed";

const POLL_INTERVAL_MS = 4_000;
const POLL_TRIES = 30; // 2 minutes of waiting on the handset.

export function PaymentFlow({ invoice, mode }: { invoice: InvoiceDetail; mode: "sandbox" | "live" }) {
  const { t } = useLocale();
  const dates = useDates();
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const backLink = (
    <Link href="/m/billing" className={buttonClasses({ variant: "outline" })}>
      <ArrowLeft className="size-4" aria-hidden />
      <span>{t("mbl.backToBilling")}</span>
    </Link>
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  async function submit() {
    if (!phone.trim()) {
      setError(t("mbl.checkout.phoneRequired"));
      return;
    }
    setBusy(true);
    setError(null);

    const started = await payInvoice({ invoiceId: invoice.id, phone: phone.trim() });

    if (!started.ok) {
      setBusy(false);
      setError(started.error ?? t("mbl.checkout.failedGeneric"));
      return;
    }

    if (started.status === "succeeded") {
      setBusy(false);
      setPhase("succeeded");
      return;
    }

    if (started.status === "pending" && started.attemptId) {
      setBusy(false);
      setPhase("pending");
      let tries = 0;
      pollRef.current = setInterval(async () => {
        tries += 1;
        const result = await checkInvoicePayment(started.attemptId!);
        if (result.status === "succeeded") {
          stopPolling();
          setPhase("succeeded");
        } else if (result.status === "failed" || tries >= POLL_TRIES) {
          stopPolling();
          setPhase("failed");
        }
      }, POLL_INTERVAL_MS);
      return;
    }

    setBusy(false);
    setError(t("mbl.checkout.failedGeneric"));
  }

  /* ── Already settled ───────────────────────────────────────────────── */
  if (invoice.status === "paid") {
    return (
      <Card className="mx-auto max-w-md border-success/30">
        <CardBody className="py-10 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-success-light text-success">
            <Check className="size-7" aria-hidden />
          </span>
          <h2 className="mt-4 font-display text-2xl font-bold">
            <span>{t("mbl.payPage.already.title")}</span>
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-text-secondary">
            <span>{t("mbl.payPage.already.body")}</span>
          </p>
          {invoice.paidAt && (
            <p className="tnum mt-2 text-sm text-text-light">
              <span>{t("mbl.inv.paidOn", { date: dates.date(invoice.paidAt) })}</span>
            </p>
          )}
          <div className="mt-6 flex justify-center">{backLink}</div>
        </CardBody>
      </Card>
    );
  }

  /* ── Cancelled ─────────────────────────────────────────────────────── */
  if (invoice.status === "void") {
    return (
      <Card className="mx-auto max-w-md border-border">
        <CardBody className="py-10 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-surface-2 text-text-light">
            <Ban className="size-7" aria-hidden />
          </span>
          <h2 className="mt-4 font-display text-2xl font-bold">
            <span>{t("mbl.payPage.void.title")}</span>
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">
            <span>{t("mbl.payPage.void.body")}</span>
          </p>
          <div className="mt-6 flex justify-center">{backLink}</div>
        </CardBody>
      </Card>
    );
  }

  /* ── Success ───────────────────────────────────────────────────────── */
  if (phase === "succeeded") {
    return (
      <Card className="mx-auto max-w-md border-success/30">
        <CardBody className="py-10 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-success-light text-success">
            <Check className="size-7" aria-hidden />
          </span>
          <h2 className="mt-4 font-display text-2xl font-bold">
            <span>{t("mbl.checkout.done.title")}</span>
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-text-secondary">
            {t("mbl.checkout.done.body", {
              amount: formatMoney(invoice.amount, { currency: invoice.currency }),
            })}
          </p>
          <div className="mt-6 flex justify-center">{backLink}</div>
        </CardBody>
      </Card>
    );
  }

  /* ── Failed ────────────────────────────────────────────────────────── */
  if (phase === "failed") {
    return (
      <Card className="mx-auto max-w-md border-error/30">
        <CardBody className="py-10 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-error-light text-error">
            <Ban className="size-7" aria-hidden />
          </span>
          <h2 className="mt-4 font-display text-2xl font-bold">
            <span>{t("mbl.checkout.failed.title")}</span>
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-text-secondary">
            {t("mbl.checkout.failed.body")}
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <Button onClick={() => setPhase("idle")}>{t("mbl.checkout.retry")}</Button>
            {backLink}
          </div>
        </CardBody>
      </Card>
    );
  }

  /* ── To pay ────────────────────────────────────────────────────────── */
  if (phase === "pending") {
    return (
      <Card className="mx-auto max-w-md">
        <CardBody className="py-10 text-center">
          <span className="mx-auto grid size-14 animate-pulse place-items-center rounded-full bg-info-light text-info">
            <LoaderCircle className="size-7 animate-spin" aria-hidden />
          </span>
          <h2 className="mt-4 font-display text-2xl font-bold">
            <span>{t("mbl.checkout.pending.title")}</span>
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-text-secondary">
            {t("mbl.checkout.pending.body", {
              amount: formatMoney(invoice.amount, { currency: invoice.currency }),
              phone,
            })}
          </p>
          <p className="mx-auto mt-4 max-w-xs text-xs text-text-light">
            {t("mbl.checkout.pending.hint")}
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardBody className="sm:p-7">
        <div className="rounded-md border border-border bg-surface-2 p-4">
          <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
            <span>{t("mbl.payPage.amountDue")}</span>
          </p>
          <p className="tnum mt-1 font-display text-3xl font-bold text-primary">
            <span>{formatMoney(invoice.amount, { currency: invoice.currency })}</span>
          </p>
        </div>

        {/* Label above value, stacked — never a two-column row that pushes the
            value off a narrow screen. */}
        <dl className="mt-5 flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <dt className="text-text-light">
              <span>{t("mbl.payPage.invoiceLabel")}</span>
            </dt>
            <dd className="tnum font-mono font-semibold">{invoice.number}</dd>
          </div>

          {invoice.planName && (
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <dt className="text-text-light">
                <span>{t("mbl.payPage.planLabel")}</span>
              </dt>
              <dd className="font-semibold">{invoice.planName}</dd>
            </div>
          )}

          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <dt className="text-text-light">
              <span>{t("mbl.payPage.periodLabel")}</span>
            </dt>
            <dd className="tnum text-text-secondary">
              {t("mbl.inv.period", {
                from: dates.dateShort(invoice.periodStart),
                to: dates.dateShort(invoice.periodEnd),
              })}
            </dd>
          </div>
        </dl>

        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field
            label={t("mbl.checkout.phoneLabel")}
            htmlFor="pay-phone"
            hint={t("mbl.checkout.phoneHint")}
          >
            <Input
              id="pay-phone"
              icon={<Smartphone className="size-4" aria-hidden />}
              inputMode="tel"
              autoComplete="tel"
              placeholder={t("mbl.checkout.phonePlaceholder")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              invalid={error !== null}
            />
          </Field>

          {error && <p className="text-sm font-medium text-error">{error}</p>}

          <Button type="submit" size="lg" fullWidth disabled={busy}>
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <Smartphone className="size-4" aria-hidden />
            )}
            <span>{t("mbl.checkout.pay", { amount: formatMoney(invoice.amount, { currency: invoice.currency }) })}</span>
          </Button>

          {mode === "sandbox" && (
            <p className="text-center text-xs text-text-light">{t("mbl.checkout.sandboxNote")}</p>
          )}
        </form>

        <div className="mt-4 flex justify-center">{backLink}</div>
      </CardBody>
    </Card>
  );
}