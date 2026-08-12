import { Suspense } from "react";
import { BrowseClient } from "./browse-client";
import { SkeletonCard } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { fetchFavoriteRestaurantIds } from "@/lib/data/customer";
import { fetchActiveRestaurants, fetchCuisineNames, fetchQuartierNames } from "@/lib/data/public";

export default async function BrowsePage() {
  const user = await requireUser();

  const [favorites, restaurants, cuisines, quartiers] = await Promise.all([
    fetchFavoriteRestaurantIds(user.id),
    fetchActiveRestaurants(),
    fetchCuisineNames(),
    fetchQuartierNames(),
  ]);

  return (
    <div className="container-page py-10 lg:py-14">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Commander</h1>
        <p className="mt-2 text-text-secondary">
          Choisissez un restaurant et composez votre commande.
        </p>
      </header>

      <Suspense
        fallback={
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        }
      >
        <BrowseClient
          initialFavorites={favorites}
          restaurants={restaurants}
          cuisines={cuisines}
          quartiers={quartiers}
        />
      </Suspense>
    </div>
  );
}