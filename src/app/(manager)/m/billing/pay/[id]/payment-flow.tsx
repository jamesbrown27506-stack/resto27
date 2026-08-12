"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, ArrowLeft, Ban, Check, FlaskConical, Wallet } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format/currency";
import { useDates } from "@/lib/format/use-dates";
import { simulatePayment } from "@/lib/data/subscribe-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { InvoiceDetail } from "@/lib/data/invoices";

/**
 * Settling an invoice.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  IT SAYS WHAT IT ACTUALLY DOES.
 *
 *  This screen used to ask for a phone number, offer MTN and Orange, then
 *  spin for ninety seconds against nothing — a form that could not take money
 *  pretending a prompt had been pushed to a handset. Mobile money is parked by
 *  an explicit decision, so the honest screen is the one that says a test
 *  payment is being recorded and shows the same amount either way.
 *
 *  The button calls `simulatePayment`, which records a real payment_attempt
 *  and then hands off to `activateFromInvoice` — THE SINGLE IDEMPOTENT
 *  ACTIVATION PATH (§6). The future provider webhook calls that same function.
 *  Nothing on this page marks an invoice paid by itself, and nothing here may
 *  ever start doing so: two activation paths disagree, and the disagreement is
 *  money.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function PaymentFlow({
  invoice,
  canSimulate,
}: {
  invoice: InvoiceDetail;
  /** False once a real provider is live — the simulator then refuses to run. */
  canSimulate: boolean;
}) {
  const { t } = useLocale();
  const dates = useDates();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Whether THIS visit settled the invoice, kept apart from the status the
  // page was rendered with. Mirroring the prop into state would freeze it at
  // its first value and never follow the server again.
  const [settled, setSettled] = useState(false);

  function pay() {
    startTransition(async () => {
      const result = await simulatePayment(invoice.id);
      if (!result.ok) return toast(result.error, "error");

      setSettled(true);
      toast(t("mbl.toast.paid"), "success");
      // The shell's subscription banner and the invoice list both read the
      // server; refreshing is what stops them contradicting this screen.
      router.refresh();
    });
  }

  const backLink = (
    <Link href="/m/billing" className={buttonClasses({ variant: "outline" })}>
      <ArrowLeft className="size-4" aria-hidden />
      <span>{t("mbl.backToBilling")}</span>
    </Link>
  );

  /* ── Settled, just now ─────────────────────────────────────────────── */
  if (settled) {
    return (
      <Card className="mx-auto max-w-md border-success/30">
        <CardBody className="py-10 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-success text-white">
            <Check className="size-7" aria-hidden />
          </span>
          <h2 className="mt-4 font-display text-2xl font-bold">
            <span>{t("mbl.payPage.done.title")}</span>
          </h2>
          <p className="tnum mt-2 text-text-secondary">
            <span>{formatMoney(invoice.amount, { currency: invoice.currency })}</span>
            <span> · </span>
            <span className="font-mono">{invoice.number}</span>
          </p>
          <p className="mx-auto mt-3 max-w-xs text-sm text-text-secondary">
            <span>{t("mbl.payPage.done.body")}</span>
          </p>
          <div className="mt-6 flex justify-center">{backLink}</div>
        </CardBody>
      </Card>
    );
  }

  /* ── Already settled before this visit ─────────────────────────────── */
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

  /* ── To settle ─────────────────────────────────────────────────────── */
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

        {canSimulate ? (
          <>
            <p className="mt-5 flex items-start gap-2 rounded-md border border-info/30 bg-info-light p-3 text-xs leading-relaxed text-info">
              <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-bold">{t("mbl.sim.title")}</span>
                {" — "}
                <span>{t("mbl.sim.body")}</span>
              </span>
            </p>

            <Button
              size="lg"
              fullWidth
              className="mt-6 rounded-md"
              loading={pending}
              disabled={pending}
              onClick={pay}
            >
              <Wallet className="size-4" aria-hidden />
              <span>{t("mbl.payPage.cta")}</span>
            </Button>
          </>
        ) : (
          /* Real payments are on, so the simulator would be refused server-side.
             Showing the button anyway would be a button that only ever fails. */
          <p className="mt-5 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-light p-3 text-xs leading-relaxed text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              <span className="font-bold">{t("mbl.sim.off.title")}</span>
              {" — "}
              <span>{t("mbl.sim.off.body")}</span>
            </span>
          </p>
        )}

        <div className="mt-4 flex justify-center">{backLink}</div>
      </CardBody>
    </Card>
  );
}
