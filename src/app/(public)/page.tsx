import { PUBLIC_SITE_URL } from "@/lib/seo-config";
import { publicMetadata } from "@/lib/seo";
import { getLocale as seoLocale } from "@/lib/i18n/locale-server";
import type { Metadata } from "next";
import { HomeContent } from "./home-content";
import { getBranding } from "@/lib/branding";
import { getSettingsMap } from "@/lib/settings-map";
import { readHomeStats } from "@/lib/home-stats";
import { getAppearance } from "@/lib/appearance";
import { fetchPopularDishes, fetchActiveRestaurants, fetchCuisineNames, fetchQuartierNames, fetchPublicStats, fetchFeaturedReviews } from "@/lib/data/public";
import { listPublicPlans } from "@/lib/data/plans";
import { getHeaderUser } from "@/lib/auth/header-user";
import { getFreeModeInfo } from "@/lib/data/billing";

/**
 * The homepage — server shell.
 *
 * Holds only the SEO surface (metadata + JSON-LD), because `metadata` is a
 * Server Component export while translation needs a Client Component. The
 * readable page lives in home-content.tsx.
 */
const baseMetadata: Metadata = {
  // Keywords first, brand last — nobody searches for the brand yet.
  title: "Commander un repas et réserver une table au Cameroun",
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
function jsonLd(brand: { name: string; logoUrl: string | null }) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": PUBLIC_SITE_URL + "/#website",
        url: PUBLIC_SITE_URL + "/",
        name: brand.name,
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
        url: PUBLIC_SITE_URL + "/",
        // Omitted rather than sent empty when no logo is set: a blank `logo`
        // is a schema validation error, an absent one is simply silence.
        ...(brand.logoUrl ? { logo: brand.logoUrl } : {}),
        areaServed: { "@type": "Country", name: "Cameroon" },
        address: {
          "@type": "PostalAddress",
          addressCountry: "CM",
          addressLocality: "Douala",
        },
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
      fetchPopularDishes(),
      fetchCuisineNames(),
      fetchQuartierNames(),
      fetchPublicStats(),
      fetchFeaturedReviews(),
      getAppearance(),
      getHeaderUser(),
      getFreeModeInfo(),
      getSettingsMap(),
    ]);
  const JSON_LD = jsonLd(brand);
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
  return publicMetadata("/", fr ? String(baseMetadata.title) : "Order food and book a table in Cameroon", fr ? String(baseMetadata.description) : "Discover restaurants in Douala, browse dishes and prices, order delivery or pickup, and reserve a table.");
}
