import { faqJsonLd, jsonLdString, publicMetadata } from "@/lib/seo";
import { absolutePublicUrl } from "@/lib/seo-config";
import { breadcrumbJsonLd } from "@/lib/breadcrumbs";
import { getLocale as seoLocale } from "@/lib/i18n/locale-server";
import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { Faq } from "@/components/marketing/faq";
import { PricingGrid } from "@/components/marketing/pricing-grid";
import { CtaBanner, SectionHeader } from "@/components/marketing/sections";
import { SectionTag } from "@/components/ui/badge";
import { formatMoney, formatPercent } from "@/lib/format/currency";
import { formatLimit } from "@/lib/format/subscription";
import { listPublicPlans, type PublicPlan } from "@/lib/data/plans";
import { getHeaderUser } from "@/lib/auth/header-user";
import { getTranslator } from "@/lib/i18n/locale-server";
import { planCtaHref } from "@/lib/nav";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

const baseMetadata: Metadata = {
  title: "Tarifs et commissions pour les restaurants",
  description:
    "Trois formules d'abonnement pour les restaurants au Cameroun, payables par MTN Mobile Money ou Orange Money. Sans engagement.",
  alternates: { canonical: "/pricing" },
};

function planRows(t: (key: TranslationKey, vars?: Record<string, string | number>) => string) {
  return [
    {
      label: t("mk.pricing.row.monthly"),
      get: (p: PublicPlan) =>
        p.monthlyPrice === 0 ? t("mk.pricing.row.free") : formatMoney(p.monthlyPrice),
    },
    {
      label: t("mk.pricing.row.trial"),
      get: (p: PublicPlan) =>
        p.trialDays
          ? t("mk.pricing.row.trialDays", { days: p.trialDays })
          : p.monthlyPrice === 0
            ? "—"
            : false,
    },
    { label: t("mk.pricing.row.dishes"), get: (p: PublicPlan) => formatLimit(p.menuItemLimit) },
    { label: t("mk.pricing.row.tables"), get: (p: PublicPlan) => formatLimit(p.tableLimit) },
    {
      label: t("mk.pricing.row.promotions"),
      get: (p: PublicPlan) => formatLimit(p.promotionLimit),
    },
    { label: t("mk.pricing.row.commission"), get: (p: PublicPlan) => formatPercent(p.commissionRate) },
    { label: t("mk.pricing.row.staff"), get: (p: PublicPlan) => p.staffManagement },
    { label: t("mk.pricing.row.analytics"), get: (p: PublicPlan) => p.analytics },
    { label: t("mk.pricing.row.kitchen"), get: () => true },
    { label: t("mk.pricing.row.dineIn"), get: () => true },
    { label: t("mk.pricing.row.reservations"), get: () => true },
    { label: t("mk.pricing.row.momo"), get: () => true },
    { label: t("mk.pricing.row.loyalty"), get: () => true },
  ];
}

function faqItems(t: (key: TranslationKey, vars?: Record<string, string | number>) => string) {
  return [1, 2, 3, 4, 5].map((n) => ({
    question: t(`mk.pricing.faq.q${n}` as TranslationKey),
    answer: t(`mk.pricing.faq.a${n}` as TranslationKey),
  }));
}

export default async function PricingPage() {
  const t = await getTranslator();
  const [plans, user, locale] = await Promise.all([listPublicPlans(), getHeaderUser(), seoLocale()]);
  const rows = planRows(t);
  const area = user?.area ?? null;

  /*
    The subscription plans are a real, priced product and shipped with no
    structured data. Each plan becomes an `Offer` under one `Product`, priced
    in XAF — the currency the plans are actually billed in.

    Deliberately NOT `aggregateRating`: nobody rates a subscription tier here,
    and inventing one would be exactly the kind of unearned rich-result markup
    that gets a site's structured data distrusted wholesale.
  */
  const pricingJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": absolutePublicUrl("/pricing", locale) + "#plans",
    name: t("mk.pricing.title"),
    description: t("mk.pricing.subtitle"),
    brand: { "@id": absolutePublicUrl("/") + "#organization" },
    offers: plans.map(plan => ({
      "@type": "Offer",
      name: plan.name,
      price: plan.monthlyPrice,
      priceCurrency: "XAF",
      url: absolutePublicUrl("/pricing", locale),
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: plan.monthlyPrice,
        priceCurrency: "XAF",
        billingIncrement: 1,
        unitCode: "MON",
      },
    })),
  };

  const crumbs = breadcrumbJsonLd(
    [
      { name: locale === "fr" ? "Accueil" : "Home", path: "/" },
      { name: t("mk.pricing.tag"), path: "/pricing" },
    ],
    locale,
  );

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(pricingJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(crumbs) }} />
      {/* The FAQ below is visible; this tells answer engines which answer is whose. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(faqJsonLd(faqItems(t))) }} />
      <section className="container-page py-14 text-center lg:py-20">
        <SectionTag>{t("mk.pricing.tag")}</SectionTag>
        <h1 className="mx-auto mt-4 max-w-2xl font-display text-4xl font-bold sm:text-5xl">
          {t("mk.pricing.title")}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-text-secondary">
          {t("mk.pricing.subtitle")}
        </p>
      </section>

      <section className="container-page pb-16">
        {/*
          Rendered from the plan rows, never hardcoded (§14.1). The limits
          advertised here are the same values the app enforces.
        */}
        <PricingGrid plans={plans} userArea={area} />
      </section>

      <section className="bg-surface-2 py-16">
        <div className="container-page">
          <SectionHeader title={t("mk.pricing.compare")} />

          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("mk.pricing.compare")}</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-5 py-4 text-left text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
                    {t("mk.pricing.feature")}
                  </th>
                  {plans.map((p) => (
                    <th
                      key={p.id}
                      scope="col"
                      className="px-5 py-4 text-center font-display text-base font-bold whitespace-nowrap"
                    >
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="px-5 py-3.5 text-left font-medium">
                      {row.label}
                    </th>
                    {plans.map((p) => {
                      const value = row.get(p);
                      return (
                        <td key={p.id} className="px-5 py-3.5 text-center">
                          {typeof value === "boolean" ? (
                            value ? (
                              <Check
                                className="mx-auto size-4 text-primary"
                                aria-label={t("mk.pricing.included")}
                              />
                            ) : (
                              <Minus
                                className="mx-auto size-4 text-text-light"
                                aria-label={t("mk.pricing.notIncluded")}
                              />
                            )
                          ) : (
                            <span className="tnum font-semibold">{value}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-5 text-center text-sm text-text-secondary">
            {t("mk.pricing.need")}{" "}
            <Link href="/contact" className="font-semibold text-primary underline underline-offset-4">
              {t("mk.pricing.talk")}
            </Link>
          </p>
        </div>
      </section>

      <section className="container-page py-16">
        <SectionHeader title={t("mk.pricing.faqTitle")} />
        <Faq items={faqItems(t)} />
      </section>

      <CtaBanner
        title={t("mk.pricing.cta.title")}
        description={t("mk.pricing.cta.body")}
        primary={{ href: planCtaHref(area), label: t("mk.pricing.cta.primary") }}
        secondary={{ href: "/contact", label: t("mk.pricing.cta.secondary") }}
      />
    </>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const fr = await seoLocale() === "fr";
  return publicMetadata("/pricing", fr ? String(baseMetadata.title) : "Restaurant plans and pricing", fr ? String(baseMetadata.description) : "Explore Resto237 plans for restaurant menus, orders and reservations.");
}
