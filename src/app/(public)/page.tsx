import { PUBLIC_SITE_URL } from "@/lib/seo-config";
import { faqJsonLd, jsonLdString, publicMetadata } from "@/lib/seo";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { getLocale as seoLocale } from "@/lib/i18n/locale-server";
import type { Metadata } from "next";
import { HomeContent } from "./home-content";
import { getBranding } from "@/lib/branding";
import { getSettingsMap } from "@/lib/settings-map";
import { readHomeStats } from "@/lib/home-stats";
import { getAppearance } from "@/lib/appearance";
import { fetchHomeDishGroups } from "@/lib/data/discovery";
import { fetchActiveRestaurants, fetchCuisineNames, fetchQuartierNames, fetchPublicStats, fetchFeaturedReviews } from "@/lib/data/public";
import { listPublicPlans } from "@/lib/data/plans";
import { getHeaderUser } from "@/lib/auth/header-user";
import { getFreeModeInfo } from "@/lib/data/billing";
import { getSocialLinks } from "@/lib/social-links";
import { telHref } from "@/lib/phone";
import { getTranslator } from "@/lib/i18n/locale-server";

/**
 * The homepage — server shell.
 *
 * Holds only the SEO surface (metadata + JSON-LD), because `metadata` is a
 * Server Component export while translation needs a Client Component. The
 * readable page lives in home-content.tsx.
 */
const baseMetadata: Metadata = {
  // Keywords first, brand last — nobody searches for the brand yet.
  title: "Commander un repas et réserver une table à Douala",
  description:
    "Commandez vos plats préférés en livraison ou à emporter et réservez votre table dans les meilleurs restaurants de Douala. Suivi en direct, paiement à la livraison.",
  alternates: { canonical: "/" },
};

/**
 * `WebSite` gives Google the sitelinks search box; `Organization` feeds the
 * knowledge panel. `areaServed` is the part that matters most — it is an
 * explicit signal that this is a Cameroon service, which a .com domain does
 * not convey on its own.
 */
/**
 * `sameAs` and `contactPoint` are what make this Organization node an
 * identifiable entity rather than a name with a logo.
 *
 * `sameAs` is the only cross-reference a knowledge graph or an LLM has to
 * confirm that "Resto237" is this Resto237 — it is fed from the social links
 * an administrator has actually enabled in settings, never from placeholders,
 * so an unset account simply omits the field rather than pointing at a URL
 * that does not exist.
 *
 * `contactPoint` makes the support number machine-readable. It was previously
 * plain text in the footer only, which meant the NAP had to be scraped rather
 * than read.
 */
/** "Resto237" → ["Resto 237", "resto237.online"]: the other ways the name is written. */
function alternateNames(name: string): string[] {
  const spaced = name.replace(/([a-z])(\d)/i, "$1 $2");
  return [...new Set([spaced, new URL(PUBLIC_SITE_URL).hostname])].filter((alt) => alt !== name);
}

function jsonLd(
  brand: { name: string; logoUrl: string | null; supportPhone: string | null; supportEmail: string },
  socialUrls: string[],
  description: string,
) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": PUBLIC_SITE_URL + "/#website",
        url: PUBLIC_SITE_URL + "/",
        name: brand.name,
        /*
          The site does not rank for its own name: "resto237" is shared with a
          restaurant's Facebook handle and two unrelated apps. The spellings
          people use for this site ("Resto 237", the bare domain) tell Google
          which of them all belong to this one.
        */
        alternateName: alternateNames(brand.name),
        inLanguage: ["fr-CM", "en-CM"],
        publisher: { "@id": PUBLIC_SITE_URL + "/#organization" },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: PUBLIC_SITE_URL + "/restaurants?q={search_term_string}",
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": PUBLIC_SITE_URL + "/#organization",
        name: brand.name,
        alternateName: alternateNames(brand.name),
        url: PUBLIC_SITE_URL + "/",
        // Omitted rather than sent empty when no logo is set: a blank `logo`
        // is a schema validation error, an absent one is simply silence.
        ...(brand.logoUrl ? { logo: brand.logoUrl } : {}),
        description,
        areaServed: { "@type": "Country", name: "Cameroon" },
        address: {
          "@type": "PostalAddress",
          addressCountry: "CM",
          addressLocality: "Douala",
          addressRegion: "Littoral",
        },
        ...(socialUrls.length ? { sameAs: socialUrls } : {}),
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "customer service",
            ...(telHref(brand.supportPhone) ? { telephone: telHref(brand.supportPhone)!.replace("tel:", "") } : {}),
            email: brand.supportEmail,
            areaServed: "CM",
            availableLanguage: ["French", "English"],
          },
        ],
      },
    ],
  };
}

export default async function HomePage() {
  const [brand, plans, restaurants, dishes, cuisines, quartiers, stats, testimonials, appearance, user, freeMode, settings] =
    await Promise.all([
      getBranding(),
      listPublicPlans(),
      fetchActiveRestaurants(),
      fetchHomeDishGroups(),
      fetchCuisineNames(),
      fetchQuartierNames(),
      fetchPublicStats(),
      fetchFeaturedReviews(),
      getAppearance(),
      getHeaderUser(),
      getFreeModeInfo(),
      getSettingsMap(),
    ]);
  const [socialLinks, t] = await Promise.all([getSocialLinks(), getTranslator()]);
  const JSON_LD = jsonLd(brand, socialLinks.map(link => link.url), t("mk.about.subtitle"));
  // The same six questions the FAQ section shows (home-content.tsx), marked up
  // so search and answer engines can tell which sentence answers which.
  const faq = [1, 2, 3, 4, 5, 6].map(n => ({
    question: t(`home.faq.q${n}` as TranslationKey),
    answer: t(`home.faq.a${n}` as TranslationKey),
  }));
  /*
    Which of the four figures this platform is willing to advertise. Resolved
    on the server and handed down, because the hero renders three of the same
    numbers inline and it is a Client Component — see lib/home-stats.
  */
  const statsVisible = readHomeStats(settings);

  return (
    <>
      <script
        type="application/ld+json"
        // JSON.stringify does not escape '<' — see the restaurant page for the
        // full reasoning. Escaping it keeps admin-set strings (brand name)
        // from ever closing this tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(faqJsonLd(faq)) }} />
      <HomeContent
        plans={plans}
        restaurants={restaurants}
        dishes={dishes}
        cuisines={cuisines}
        quartiers={quartiers}
        stats={stats}
        statsVisible={statsVisible}
        testimonials={testimonials}
        appearance={appearance}
        userArea={user?.area ?? null}
        freeModeInfo={freeMode}
      />
    </>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const fr = await seoLocale() === "fr";
  return publicMetadata("/", fr ? String(baseMetadata.title) : "Order food and book a table in Douala", fr ? String(baseMetadata.description) : "Discover restaurants in Douala, browse dishes and prices, order delivery or pickup, and reserve a table.");
}
