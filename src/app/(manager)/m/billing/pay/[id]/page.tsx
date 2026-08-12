import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ManagerPage } from "@/components/layout/manager-shell";
import { PaymentFlow } from "./payment-flow";
import { buttonClasses } from "@/components/ui/button";
import { requireCapability } from "@/lib/auth/branch";
import { fetchInvoice, fetchPaymentsEnabled } from "@/lib/data/invoices";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/**
 * Pay an invoice.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS PAGE MUST STAY REACHABLE WHILE THE TENANT IS LOCKED (§5, rule 3).
 *  `requireCapability` gates on the ROLE, never on the subscription state —
 *  a locked tenant sent to a 404 by the screen that takes their money will
 *  not be paying anyone.
 *
 *  IT ALSO MUST NOT BE PRERENDERED. It used to call generateStaticParams()
 *  over the INVOICES fixture and then look the invoice up in that same
 *  fixture, so every real invoice 404'd: the money path did not work at all.
 *  An invoice is per-tenant, changes the moment it is settled, and cannot be
 *  enumerated at build time.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mbl.payPage.title"] };
}

export default async function PayInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { active } = await requireCapability("billing.manage");
  const locale = await getLocale();

  // Scoped by branch inside fetchInvoice: an id copied from another tenant's
  // URL returns null here, which renders as 404 rather than as their invoice.
  const [invoice, paymentsEnabled] = await Promise.all([
    fetchInvoice(active.restaurantId, id),
    fetchPaymentsEnabled(),
  ]);

  if (!invoice) notFound();

  return (
    <ManagerPage
      titleKey="mbl.payPage.title"
      descriptionKey="mbl.payPage.subtitle"
      action={
        <Link href="/m/billing" className={buttonClasses({ variant: "ghost" })}>
          <ArrowLeft className="size-4" aria-hidden />
          {/* A Server Component cannot call useLocale, so the label is resolved
              from the same locale cookie the rest of the page renders with. */}
          <span>{DICTIONARIES[locale]["mbl.backToBilling"]}</span>
        </Link>
      }
    >
      <PaymentFlow invoice={invoice} canSimulate={!paymentsEnabled} />
    </ManagerPage>
  );
}
