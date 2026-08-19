import { Suspense } from "react";
import { BrowseClient } from "./browse-client";
import { SkeletonCard } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { fetchFavoriteRestaurantIds, fetchCustomerAddresses } from "@/lib/data/customer";
import {
  fetchActiveRestaurants,
  fetchCuisineNames,
  fetchDishSearchIndex,
  fetchQuartierNames,
} from "@/lib/data/public";
import { getTranslator } from "@/lib/i18n/locale-server";

export default async function BrowsePage() {
  const user = await requireUser();
  const t = await getTranslator();

  const [favorites, restaurants, cuisines, quartiers, dishSearch, addresses] = await Promise.all([
    fetchFavoriteRestaurantIds(user.id),
    fetchActiveRestaurants(),
    fetchCuisineNames(),
    fetchQuartierNames(),
    fetchDishSearchIndex(),
    fetchCustomerAddresses(user.id),
  ]);

  /*
    Where this customer eats.

    Their default address if they have marked one, otherwise the first they
    saved — either is a far better guess at "near me" than no guess at all.
    Undefined when they have saved none, and the directory then sorts exactly
    as it does for a stranger.
  */
  const homeQuartier =
    (addresses.find((a) => a.isDefault) ?? addresses[0])?.quartier || undefined;

  return (
    <div className="container-page py-10 lg:py-14">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{t("cbr.browseTitle")}</h1>
        <p className="mt-2 text-text-secondary">{t("cbr.browseSubtitle")}</p>
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
          dishSearch={dishSearch}
          homeQuartier={homeQuartier}
        />
      </Suspense>
    </div>
  );
}