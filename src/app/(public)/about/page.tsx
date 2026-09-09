import { publicMetadata } from "@/lib/seo";
import { absolutePublicUrl } from "@/lib/seo-config";
import { getLocale as seoLocale, getTranslator } from "@/lib/i18n/locale-server";
import { jsonLdString } from "@/lib/seo";
import type { Metadata } from "next";
import Link from "@/components/layout/public-link";
import { Card, CardBody } from "@/components/ui/card";
import { SectionTag } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { getBranding } from "@/lib/branding";
import { planCtaHref } from "@/lib/nav";
import { getHeaderUser } from "@/lib/auth/header-user";

/**
 * /about — the page that says who is behind the marketplace.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY IT EXISTS.
 *
 *  There was no About page anywhere on the site. For a marketplace that takes
 *  orders and handles money, that is a trust gap before it is an SEO one: a
 *  visitor deciding whether to hand over an address and a phone number had
 *  nothing telling them what this business is, where it operates, or who is
 *  responsible when something goes wrong. Search engines and AI assistants
 *  had the same problem from the other side — "c'est quoi Resto237" was
 *  answerable only from a meta description.
 *
 *  It also fixes a scope claim. Titles and hero copy said "au Cameroun" while
 *  every restaurant on the platform is in Douala, so both readers and language
 *  models were being told the coverage is national. This page states the real
 *  footprint and says plainly that other cities follow when restaurants there
 *  sign up.
 * ─────────────────────────────────────────────────────────────────────────
 */

const baseMetadata: Metadata = {
  title: "À propos de Resto237",
  description:
    "Resto237 est une place de marché pour commander un repas et réserver une table à Douala. Comment ça marche, où nous opérons et comment nous vérifions les restaurants.",
  alternates: { canonical: "/about" },
};

export default async function AboutPage() {
  const [t, brand, user, locale] = await Promise.all([
    getTranslator(),
    getBranding(),
    getHeaderUser(),
    seoLocale(),
  ]);

  const pageUrl = absolutePublicUrl("/about", locale);

  /**
   * `AboutPage` pointing back at the Organization node the homepage defines,
   * so the two describe one entity rather than two. `description` here is the
   * plain-language answer to "what is Resto237", which the Organization node
   * previously had no field for at all.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": pageUrl + "#about",
    url: pageUrl,
    name: t("mk.about.title"),
    description: t("mk.about.subtitle"),
    mainEntity: { "@id": absolutePublicUrl("/") + "#organization" },
  };

  const steps = [t("mk.about.how.s1"), t("mk.about.how.s2"), t("mk.about.how.s3")];

  const sections: { title: string; paragraphs: string[] }[] = [
    { title: t("mk.about.what.title"), paragraphs: [t("mk.about.what.p1"), t("mk.about.what.p2")] },
    { title: t("mk.about.coverage.title"), paragraphs: [t("mk.about.coverage.p1"), t("mk.about.coverage.p2")] },
    { title: t("mk.about.payment.title"), paragraphs: [t("mk.about.payment.p1")] },
    { title: t("mk.about.trust.title"), paragraphs: [t("mk.about.trust.p1")] },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
      />

      <div className="container-page py-14 lg:py-20">
        <header className="max-w-2xl">
          <SectionTag>{t("mk.about.tag")}</SectionTag>
          <h1 className="mt-4 font-display text-4xl font-bold sm:text-5xl">
            {t("mk.about.title")}
          </h1>
          <p className="mt-4 text-lg text-text-secondary">{t("mk.about.subtitle")}</p>
        </header>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-10">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="font-display text-2xl font-bold">{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mt-3 max-w-2xl leading-relaxed text-text-secondary">
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}

            <section>
              <h2 className="font-display text-2xl font-bold">{t("mk.about.how.title")}</h2>
              <ol className="mt-4 max-w-2xl space-y-4">
                {steps.map((step, index) => (
                  <li key={step} className="flex gap-4">
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-light font-bold text-primary"
                    >
                      {index + 1}
                    </span>
                    <span className="leading-relaxed text-text-secondary">{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside className="flex flex-col gap-5">
            <Card>
              <CardBody className="space-y-3">
                <h2 className="font-display text-lg font-bold">{t("mk.about.owner.title")}</h2>
                <p className="text-sm text-text-secondary">{t("mk.about.owner.p1")}</p>
                <Link href={planCtaHref(user?.area ?? null)} className={buttonClasses({ className: "w-full" })}>
                  {t("mk.about.owner.cta")}
                </Link>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="space-y-3">
                <h2 className="font-display text-lg font-bold">{brand.name}</h2>
                {brand.supportAddress && (
                  <p className="text-sm text-text-secondary">{brand.supportAddress}</p>
                )}
                <Link
                  href="/contact"
                  className={buttonClasses({ variant: "secondary", className: "w-full" })}
                >
                  {t("mk.about.contact.cta")}
                </Link>
              </CardBody>
            </Card>
          </aside>
        </div>
      </div>
    </>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const fr = (await seoLocale()) === "fr";
  return publicMetadata(
    "/about",
    fr ? String(baseMetadata.title) : "About Resto237",
    fr
      ? String(baseMetadata.description)
      : "Resto237 is a marketplace for ordering food and booking a table in Douala. How it works, where we operate and how we verify restaurants.",
  );
}
