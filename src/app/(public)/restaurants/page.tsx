import { publicMetadata } from "@/lib/seo";
import { getLocale as seoLocale } from "@/lib/i18n/locale-server";
import Link from "@/components/layout/public-link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonCard } from "@/components/ui/skeleton";
import { RestaurantDirectory } from "./restaurant-directory";
import {
  fetchActiveRestaurants,
  fetchCuisineNames,
  fetchDishSearchIndex,
  fetchQuartierNames,
} from "@/lib/data/public";
import { getTranslator } from "@/lib/i18n/locale-server";
import { jsonLdString } from "@/lib/seo";
import { absolutePublicUrl } from "@/lib/seo-config";
import { breadcrumbJsonLd } from "@/lib/breadcrumbs";
import { formatQuartier } from "@/lib/geo-cm";

const baseMetadata: Metadata = {
  title: "Restaurants à Douala — livraison et à emporter",
  description:
    "Parcourez tous les restaurants de Douala : cuisine camerounaise, grillades, poisson braisé. Filtrez par quartier, cuisine et note.",
  alternates: { canonical: "/restaurants" },
};

export default async function RestaurantsPage() {
  const t = await getTranslator();
  const [restaurants, cuisines, quartiers, dishSearch] = await Promise.all([
    fetchActiveRestaurants(),
    fetchCuisineNames(),
    fetchQuartierNames(),
    fetchDishSearchIndex(),
  ]);
  const locale = await seoLocale();
  const fr = locale === "fr";

  /*
    This page listed every restaurant on the platform and shipped no
    structured data at all. `ItemList` is what tells Google the page IS a
    directory and what is in it, in order — the same treatment the
    /explore/* pages already had.
  */
  const listJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: fr ? "Restaurants à Douala" : "Restaurants in Douala",
    numberOfItems: restaurants.length,
    itemListElement: restaurants.map((restaurant, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: `${restaurant.name} — ${formatQuartier(restaurant.quartier)}, Douala`,
      url: absolutePublicUrl("/restaurants/" + restaurant.slug, locale),
    })),
  };

  const crumbs = breadcrumbJsonLd(
    [
      { name: fr ? "Accueil" : "Home", path: "/" },
      { name: fr ? "Restaurants" : "Restaurants", path: "/restaurants" },
    ],
    locale,
  );

  return (
    <div className="container-page py-6 sm:py-10 lg:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(listJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(crumbs) }} />
      {/*
        Tighter on a phone. At text-4xl with mb-8 the title, subtitle and
        explore link took a third of a 360x640 viewport before the search box
        even started — on a page whose whole job is to show restaurants.
      */}
      <header className="mb-5 sm:mb-8">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{t("restaurants.title")}</h1>
        <p className="mt-1.5 text-sm text-text-secondary sm:mt-2 sm:text-base">{t("restaurants.subtitle")}</p>
        <Link href="/explore" className="mt-3 inline-block text-sm font-semibold text-primary sm:mt-4 sm:text-base">{fr ? "Explorer par plat, cuisine ou quartier →" : "Explore by dish, cuisine or neighbourhood →"}</Link>
      </header>

      {/* useSearchParams needs a Suspense boundary to keep the page static. */}
      <Suspense
        fallback={
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        }
      >
        <RestaurantDirectory
          restaurants={restaurants}
          cuisines={cuisines}
          quartiers={quartiers}
          dishSearch={dishSearch}
        />
      </Suspense>
    </div>
  );
}
export async function generateMetadata(): Promise<Metadata> {
  const fr = await seoLocale() === "fr";
  return publicMetadata("/restaurants", fr ? String(baseMetadata.title) : "Restaurants in Douala — delivery and pickup", fr ? String(baseMetadata.description) : "Browse restaurants in Douala by neighbourhood, cuisine and dish. Compare menus, prices and customer reviews.");
}
