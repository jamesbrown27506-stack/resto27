import type { Metadata } from "next";
import { HomeContent } from "./home-content";
import { getBranding } from "@/lib/branding";
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
export const metadata: Metadata = {
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
        "@id": "/#website",
        url: "/",
        name: brand.name,
        inLanguage: ["fr-CM", "en-CM"],
        publisher: { "@id": "/#organization" },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: "/restaurants?q={search_term_string}",
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": "/#organization",
        name: brand.name,
        url: "/",
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
  const [brand, plans, restaurants, dishes, cuisines, quartiers, stats, testimonials, appearance, user, freeMode] =
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
    ]);
  const JSON_LD = jsonLd(brand);

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
        testimonials={testimonials}
        appearance={appearance}
        userArea={user?.area ?? null}
        freeModeInfo={freeMode}
      />
    </>
  );
}
