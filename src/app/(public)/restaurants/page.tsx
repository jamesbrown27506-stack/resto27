import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonCard } from "@/components/ui/skeleton";
import { RestaurantDirectory } from "./restaurant-directory";
import { fetchActiveRestaurants, fetchCuisineNames, fetchQuartierNames } from "@/lib/data/public";

export const metadata: Metadata = {
  title: "Restaurants à Douala — livraison et à emporter",
  description:
    "Parcourez tous les restaurants de Douala : cuisine camerounaise, grillades, poisson braisé. Filtrez par quartier, cuisine et note.",
  alternates: { canonical: "/restaurants" },
};

export default async function RestaurantsPage() {
  const [restaurants, cuisines, quartiers] = await Promise.all([
    fetchActiveRestaurants(),
    fetchCuisineNames(),
    fetchQuartierNames(),
  ]);

  return (
    <div className="container-page py-10 lg:py-14">
      <header className="mb-8">
        <h1 className="font-display text-4xl font-bold">Restaurants</h1>
        <p className="mt-2 text-text-secondary">
          Tous les établissements actifs sur RestoLink, à Douala et environs.
        </p>
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
        />
      </Suspense>
    </div>
  );
}