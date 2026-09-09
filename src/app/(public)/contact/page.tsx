import { jsonLdString, publicMetadata } from "@/lib/seo";
import { getLocale as seoLocale } from "@/lib/i18n/locale-server";
import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Mail, MapPin, MessageSquare, Phone } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { SectionTag } from "@/components/ui/badge";
import { getTranslator } from "@/lib/i18n/locale-server";
import { getHeaderUser } from "@/lib/auth/header-user";
import { planCtaHref } from "@/lib/nav";
import { ContactForm } from "./contact-form";
import { getBranding } from "@/lib/branding";
import { getSocialLinks } from "@/lib/social-links";
import { SocialIcon } from "@/components/icons/social-icon";
import { formatPhoneDisplay, telHref } from "@/lib/phone";
import { absolutePublicUrl } from "@/lib/seo-config";
import { breadcrumbJsonLd } from "@/lib/breadcrumbs";

const baseMetadata: Metadata = {
  title: "Contact et assistance",
  description:
    "Une question sur une commande, un abonnement ou l'inscription de votre restaurant ? Écrivez-nous, nous répondons sous 24 heures.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const [t, user, brand, socialLinks, locale] = await Promise.all([
    getTranslator(),
    getHeaderUser(),
    getBranding(),
    getSocialLinks(),
    seoLocale(),
  ]);

  /*
    `ContactPage` plus a machine-readable ContactPoint. The NAP was rendered
    as plain text only, so anything reading this page had to scrape the
    address block rather than read a declared contact channel. `mainEntity`
    points back at the homepage Organization so both describe one entity.
  */
  const contactJsonLd = {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    "@id": absolutePublicUrl("/contact", locale) + "#contact",
    url: absolutePublicUrl("/contact", locale),
    name: t("mk.contact.title"),
    description: t("mk.contact.subtitle"),
    mainEntity: {
      "@type": "Organization",
      "@id": absolutePublicUrl("/") + "#organization",
      name: brand.name,
      email: brand.supportEmail,
      ...(telHref(brand.supportPhone) ? { telephone: telHref(brand.supportPhone)!.replace("tel:", "") } : {}),
      contactPoint: [
        {
          "@type": "ContactPoint",
          contactType: "customer service",
          email: brand.supportEmail,
          ...(telHref(brand.supportPhone) ? { telephone: telHref(brand.supportPhone)!.replace("tel:", "") } : {}),
          areaServed: "CM",
          availableLanguage: ["French", "English"],
        },
      ],
      ...(socialLinks.length ? { sameAs: socialLinks.map(link => link.url) } : {}),
    },
  };

  const crumbs = breadcrumbJsonLd(
    [
      { name: locale === "fr" ? "Accueil" : "Home", path: "/" },
      { name: t("mk.contact.title"), path: "/contact" },
    ],
    locale,
  );

  return (
    <div className="container-page py-14 lg:py-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(contactJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(crumbs) }} />
      <header className="max-w-2xl">
        <SectionTag>{t("mk.contact.tag")}</SectionTag>
        <h1 className="mt-4 font-display text-4xl font-bold sm:text-5xl">
          {t("mk.contact.title")}
        </h1>
        <p className="mt-4 text-lg text-text-secondary">{t("mk.contact.subtitle")}</p>
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardBody className="sm:p-8">
            <ContactForm />
          </CardBody>
        </Card>

        <aside className="flex flex-col gap-5">
          <Card>
            <CardBody>
              <h2 className="font-display text-lg font-bold">{t("mk.contact.reach")}</h2>
              <ul className="mt-4 flex flex-col gap-4 text-sm">
                {[
                  {
                    Icon: Mail,
                    label: t("mk.contact.emailLabel"),
                    value: brand.supportEmail,
                    href: `mailto:${brand.supportEmail}`,
                  },
                  ...(brand.supportPhone ? [{
                    Icon: Phone,
                    label: t("mk.contact.phoneLabel"),
                    value: formatPhoneDisplay(brand.supportPhone),
                    href: telHref(brand.supportPhone) ?? undefined,
                  }] : []),
                  ...(brand.supportAddress ? [{
                    Icon: MapPin,
                    label: t("mk.contact.addressLabel"),
                    value: brand.supportAddress,
                  }] : []),
                  { Icon: Clock, label: t("mk.contact.hoursLabel"), value: t("mk.contact.hoursValue") },
                ].map(({ Icon, label, value, href }) => (
                  <li key={label} className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold tracking-wide text-text-light uppercase">
                        {label}
                      </span>
                      {href ? (
                        <a href={href} className="break-words hover:text-primary">
                          {value}
                        </a>
                      ) : (
                        <span className="break-words">{value}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {socialLinks.length > 0 && (
            <Card>
              <CardBody>
                <h2 className="font-display text-lg font-bold">
                  {locale === "fr" ? "Suivez-nous" : "Follow us"}
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  {locale === "fr"
                    ? "Retrouvez nos actualités et nos nouveaux restaurants."
                    : "See our latest updates and newly added restaurants."}
                </p>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {socialLinks.map((link) => (
                    <li key={link.platform}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-2 px-4 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
                      >
                        <SocialIcon platform={link.platform} className="size-4" />
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <Card className="bg-primary-light">
            <CardBody>
              <MessageSquare className="size-5 text-primary" aria-hidden />
              <h2 className="mt-3 font-display text-lg font-bold">{t("mk.contact.ownerTitle")}</h2>
              <p className="mt-1.5 text-sm text-text-secondary">{t("mk.contact.ownerBody")}</p>
              <Link
                href={planCtaHref(user?.area ?? null)}
                className="mt-3 inline-block text-sm font-semibold text-primary underline underline-offset-4"
              >
                {t("mk.contact.ownerCta")}
              </Link>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const fr = await seoLocale() === "fr";
  return publicMetadata("/contact", fr ? String(baseMetadata.title) : "Contact Resto237", fr ? String(baseMetadata.description) : "Contact Resto237 for customer help or restaurant support in Cameroon.");
}
