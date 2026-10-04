import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ManagerPage } from "@/components/layout/manager-shell";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { requireCapability } from "@/lib/auth/branch";
import { getBranding } from "@/lib/branding";
import { fetchInvoice } from "@/lib/data/invoices";
import { formatMoney, formatPercent } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/datetime";
import { DICTIONARIES, intlLocale, type Locale, type TranslationKey } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/**
 * One invoice, as a document.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  READ FROM THE DATABASE, SCOPED TO THE BRANCH, NEVER PRERENDERED.
 *
 *  This page used to enumerate the INVOICES fixture in generateStaticParams()
 *  and then look the invoice up in that same fixture, so a real invoice number
 *  404'd while four invented ones rendered. It also pulled the plan's
 *  commission rate from the PLANS fixture, which had different prices from the
 *  ones the tenant is actually charged.
 *
 *  `fetchInvoice` filters on `restaurant_id`, so an id lifted from another
 *  tenant's URL returns null and this renders 404 rather than their invoice.
 *
 *  Reachable while locked (§5 rule 3) — the gate is the ROLE, not the
 *  subscription state.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mbl.doc.heading"] };
}

/**
 * Translate, on the server.
 *
 * A Server Component cannot call useLocale — but it can read the same locale
 * cookie and the same dictionary, which is what `generateMetadata` already
 * does across the manager area. `{name}` interpolation matches `t()` exactly,
 * so a string can move between a server page and a client one untouched.
 */
function translator(locale: Locale) {
  const dict = DICTIONARIES[locale];
  return (key: TranslationKey, vars?: Record<string, string | number>): string => {
    let value = dict[key];
    if (vars) {
      for (const [name, replacement] of Object.entries(vars)) {
        value = value.replaceAll(`{${name}}`, String(replacement));
      }
    }
    return value;
  };
}

/** The status labels, keyed on the RAW column value. */
const STATUS_KEY: Record<string, TranslationKey> = {
  unpaid: "mbl.status.unpaid",
  paid: "mbl.status.paid",
  void: "mbl.status.void",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  unpaid: "warning",
  paid: "success",
  void: "neutral",
};

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { active } = await requireCapability("billing.manage");

  const [locale, invoice, brand] = await Promise.all([
    getLocale(),
    fetchInvoice(active.restaurantId, id),
    getBranding(),
  ]);

  if (!invoice) notFound();

  const t = translator(locale);

  /**
   * Dates on an English invoice must not read "3 août 2026", so the tag is
   * passed to every formatDate below rather than left to default to French.
   *
   * This used to be inlined here to dodge lib/i18n/use-locale, which is "use
   * client" and would have handed this Server Component a client reference.
   * `intlLocale` now lives in lib/i18n/dictionaries, which carries no
   * directive and is callable from either side — so the duplicate is gone.
   */
  const tag = intlLocale(locale);
  const day = (value: string) => formatDate(value, tag);

  const billedTo =
    invoice.branchLabel && invoice.branchLabel !== "Principal"
      ? `${invoice.restaurantName} — ${invoice.branchLabel}`
      : invoice.restaurantName;

  return (
    <ManagerPage
      // The heading is DATA — an invoice number is not a translatable phrase.
      // The line under it is a sentence, so it is translated here.
      title={invoice.number}
      description={t("mbl.doc.period", {
        from: day(invoice.periodStart),
        to: day(invoice.periodEnd),
      })}
      action={
        <Link href="/m/billing" className={buttonClasses({ variant: "ghost" })}>
          <ArrowLeft className="size-4" aria-hidden />
          <span>{t("mbl.backToBilling")}</span>
        </Link>
      }
    >
      <Card className="mx-auto max-w-2xl">
        <CardBody className="sm:p-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="font-display text-2xl font-bold">{brand.name}</p>
              {/* The platform's own identity, from settings — not a literal.
                  A postal address is not stored anywhere, so none is invented. */}
              <address className="mt-1 text-sm leading-relaxed text-text-secondary not-italic">
                {brand.supportEmail}
              </address>
            </div>

            <div className="min-w-0 sm:text-right">
              <p className="text-[11px] font-bold tracking-[0.1em] text-text-light uppercase">
                <span>{t("mbl.doc.heading")}</span>
              </p>
              <p className="tnum mt-1 font-display text-xl font-bold">{invoice.number}</p>
              <p className="tnum mt-1 text-sm text-text-secondary">
                <span>{t("mbl.doc.issuedOn", { date: day(invoice.issuedAt) })}</span>
              </p>
              <div className="mt-2">
                <Badge tone={STATUS_TONE[invoice.status] ?? "neutral"}>
                  <span>{t(STATUS_KEY[invoice.status] ?? "mbl.status.unpaid")}</span>
                </Badge>
              </div>
            </div>
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <p className="text-[11px] font-bold tracking-[0.1em] text-text-light uppercase">
              <span>{t("mbl.doc.billedTo")}</span>
            </p>
            <p className="mt-1 font-semibold">{billedTo}</p>
          </div>

          <table className="mt-8 w-full text-sm">
            <caption className="sr-only">{t("mbl.doc.caption")}</caption>
            <thead>
              <tr className="border-b border-border">
                <th
                  scope="col"
                  className="pb-3 text-left text-[11px] font-bold tracking-[0.08em] text-text-light uppercase"
                >
                  <span>{t("mbl.doc.description")}</span>
                </th>
                <th
                  scope="col"
                  className="pb-3 text-right text-[11px] font-bold tracking-[0.08em] text-text-light uppercase"
                >
                  <span>{t("mbl.doc.amount")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* A branch top-up (0072) buys extra branches until the period
                  end — one line, no plan month in it. */}
              {invoice.kind === "branches" ? (
                <tr className="border-b border-border">
                  <td className="py-4">
                    <p className="font-medium">
                      <span>{t("mbr.invoice.topUpLine")}</span>
                    </p>
                    <p className="tnum mt-0.5 text-xs text-text-light">
                      <span>
                        {t("mbr.invoice.topUpMeta", {
                          from: day(invoice.periodStart),
                          to: day(invoice.periodEnd),
                          count: invoice.extraBranches,
                        })}
                      </span>
                    </p>
                  </td>
                  <td className="tnum py-4 text-right font-medium">
                    {formatMoney(invoice.amount, { currency: invoice.currency })}
                  </td>
                </tr>
              ) : (
                <>
                  <tr className="border-b border-border">
                    <td className="py-4">
                      <p className="font-medium">
                        <span>
                          {t("mbl.doc.line", { plan: invoice.planName ?? invoice.number })}
                        </span>
                      </p>
                      <p className="tnum mt-0.5 text-xs text-text-light">
                        {/* The commission rate is the one snapshotted on the plan
                            this invoice was raised for, not today's plan. */}
                        <span>
                          {invoice.commissionRate === null
                            ? t("mbl.doc.lineMetaNoRate", {
                                from: day(invoice.periodStart),
                                to: day(invoice.periodEnd),
                              })
                            : t("mbl.doc.lineMeta", {
                                from: day(invoice.periodStart),
                                to: day(invoice.periodEnd),
                                rate: formatPercent(invoice.commissionRate),
                              })}
                        </span>
                      </p>
                    </td>
                    <td className="tnum py-4 text-right font-medium">
                      {formatMoney(invoice.amount - invoice.branchAmount, { currency: invoice.currency })}
                    </td>
                  </tr>
                  {/* Each location beyond what the plan includes (0072). */}
                  {invoice.branchAmount > 0 && invoice.extraBranches > 0 && (
                    <tr className="border-b border-border">
                      <td className="py-4">
                        <p className="font-medium">
                          <span>{t("mbr.invoice.extraLine", { count: invoice.extraBranches })}</span>
                        </p>
                        <p className="tnum mt-0.5 text-xs text-text-light">
                          <span>
                            {t("mbr.invoice.extraMeta", {
                              price: formatMoney(Math.round(invoice.branchAmount / invoice.extraBranches), {
                                currency: invoice.currency,
                              }),
                            })}
                          </span>
                        </p>
                      </td>
                      <td className="tnum py-4 text-right font-medium">
                        {formatMoney(invoice.branchAmount, { currency: invoice.currency })}
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-5 text-right font-display text-lg font-bold">
                  <span>{t("common.total")}</span>
                </td>
                <td className="tnum pt-5 text-right font-display text-2xl font-bold text-primary">
                  {formatMoney(invoice.amount, { currency: invoice.currency })}
                </td>
              </tr>
            </tfoot>
          </table>

          {invoice.paidAt && (
            <p className="tnum mt-6 rounded-md border border-success/25 bg-success-light p-3 text-sm text-success">
              <span>{t("mbl.doc.paidOn", { date: day(invoice.paidAt) })}</span>
            </p>
          )}

          {invoice.status === "unpaid" && (
            <Link
              href={`/m/billing/pay/${invoice.id}`}
              className={buttonClasses({ size: "lg", fullWidth: true, className: "mt-6" })}
            >
              <span>{t("mbl.doc.payCta")}</span>
            </Link>
          )}

          <p className="mt-8 border-t border-border pt-5 text-xs leading-relaxed text-text-light">
            <span>{t("mbl.doc.footnote")}</span>
          </p>
        </CardBody>
      </Card>
    </ManagerPage>
  );
}
