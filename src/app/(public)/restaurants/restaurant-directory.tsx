"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Store } from "lucide-react";
import { RestaurantCard, RestaurantGrid } from "@/components/restaurant/restaurant-card";
import { DirectoryFilters } from "@/components/restaurant/directory-filters";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/use-locale";
import type { PublicRestaurant } from "@/lib/data/public";

/**
 * Restaurant directory, shared by /restaurants (public) and /browse (signed in).
 *
 * Filters are seeded from the query string so the homepage hero's search
 * actually arrives somewhere — the PHP hero submitted to a page that ignored
 * half the parameters. The data comes in as props so the public page and the
 * signed-in page each fetch it once, server-side.
 */
export function RestaurantDirectory({
  restaurants,
  cuisines,
  quartiers,
  hrefFor,
  action,
  dishSearch,
  homeQuartier,
}: {
  restaurants: PublicRestaurant[];
  cuisines: string[];
  quartiers: string[];
  /**
   * The signed-in customer's own neighbourhood, from their default address.
   *
   * Undefined for anonymous visitors and for anyone who has not saved an
   * address — in which case nothing below changes and the list sorts exactly
   * as it always did.
   */
  homeQuartier?: string;
  /** Lets /browse point at its own detail route. */
  hrefFor?: (slug: string) => string;
  /** Favourite toggle, injected by the signed-in directory. */
  action?: (restaurantId: string) => React.ReactNode;
  /** Lowercased dish names per restaurant id — what "plat" in the search matches. */
  dishSearch?: Record<string, string>;
}) {
  const params = useSearchParams();
  const { t } = useLocale();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const [quartier, setQuartier] = useState(params.get("quartier") ?? "all");
  const [cuisine, setCuisine] = useState(params.get("cuisine") ?? "all");
  const [rating, setRating] = useState(params.get("rating") ?? "all");
  const [price, setPrice] = useState(params.get("price") ?? "all");
  const [delivery, setDelivery] = useState(params.get("delivery") ?? "all");
  /*
    ──────────────────────────────────────────────────────────────────────
     "NEAR ME" IS THE DEFAULT WHEN WE KNOW WHERE "ME" IS.

     Sorting by rating first is right for a stranger and wrong for a regular:
     the best-rated restaurant in Douala is useless to someone in Bonabéri if
     it will not deliver there, and delivery fees rise with distance whatever
     the star count says. When the customer has saved an address we lead with
     their own quartier.

     It is a DEFAULT, not a lock — "nearMe" is one option among four, and
     anyone who would rather sort by rating still can. And an explicit
     ?sort= in the URL always wins, because that came from the homepage hero
     or from a link someone shared, and both mean something specific.
    ──────────────────────────────────────────────────────────────────────
  */
  const [sort, setSort] = useState(
    params.get("sort") ?? (homeQuartier ? "nearMe" : "rating"),
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();

    const filtered = restaurants.filter((r) => {
      if (quartier !== "all" && r.quartier !== quartier) return false;
      if (cuisine !== "all" && r.cuisine !== cuisine) return false;
      if (rating !== "all" && r.rating < Number(rating)) return false;
      // Price here means the restaurant's minimum order — what a basket has to
      // reach — bucketed so the filter reads as a budget, not a threshold.
      if (price !== "all" && r.minimumOrder > Number(price)) return false;
      if (delivery !== "all" && r.deliveryEstimateMin > Number(delivery)) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.cuisine.toLowerCase().includes(q) ||
        r.quartier.toLowerCase().includes(q) ||
        // "Poulet DG" must find the restaurant that serves it, not just the
        // one named after it — the placeholder promises dish search.
        (dishSearch?.[r.id] ?? "").includes(q)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sort === "nearMe" && homeQuartier) {
        // Same neighbourhood first, then best-rated within each group — so
        // "near me" never degenerates into an arbitrary order among the
        // dozen restaurants that are all equally near.
        const aHome = a.quartier === homeQuartier ? 0 : 1;
        const bHome = b.quartier === homeQuartier ? 0 : 1;
        if (aHome !== bHome) return aHome - bHome;
        return b.rating - a.rating;
      }
      if (sort === "delivery") return a.deliveryEstimateMin - b.deliveryEstimateMin;
      if (sort === "name") return a.name.localeCompare(b.name, "fr");
      return b.rating - a.rating;
    });
  }, [query, quartier, cuisine, rating, price, delivery, sort, restaurants, dishSearch, homeQuartier]);

  function clear() {
    setQuery("");
    setQuartier("all");
    setCuisine("all");
    setRating("all");
    setPrice("all");
    setDelivery("all");
    // Back to the same default this screen opened with, not a hardcoded
    // "rating" that would silently drop a customer's own neighbourhood.
    setSort(homeQuartier ? "nearMe" : "rating");
  }

  return (
    <>
      <DirectoryFilters
        query={query}
        onQueryChange={setQuery}
        placeholder={t("restaurants.searchPlaceholder")}
        onClear={clear}
        resultCount={results.length}
        sort={{
          key: "sort",
          label: t("restaurants.sortLabel"),
          value: sort,
          onChange: setSort,
          options: [
            // Only offered when we can actually honour it.
            ...(homeQuartier ? [{ value: "nearMe", label: t("restaurants.sortNearMe") }] : []),
            { value: "rating", label: t("restaurants.sortRating") },
            { value: "delivery", label: t("restaurants.sortDelivery") },
            { value: "name", label: t("restaurants.sortName") },
          ],
        }}
        filters={[
          {
            key: "quartier",
            label: t("cbr.quartier"),
            value: quartier,
            onChange: setQuartier,
            options: [
              { value: "all", label: t("restaurants.allQuartiers") },
              ...quartiers.map((q) => ({ value: q, label: q })),
            ],
          },
          {
            key: "cuisine",
            label: t("cbr.cuisine"),
            value: cuisine,
            onChange: setCuisine,
            options: [
              { value: "all", label: t("restaurants.allCuisines") },
              ...cuisines.map((c) => ({ value: c, label: c })),
            ],
          },
          {
            key: "rating",
            label: t("cbr.rating"),
            value: rating,
            onChange: setRating,
            options: [
              { value: "all", label: t("restaurants.allRatings") },
              { value: "4", label: t("restaurants.rating4") },
              { value: "3", label: t("restaurants.rating3") },
            ],
          },
          {
            key: "price",
            label: t("cbr.budget"),
            value: price,
            onChange: setPrice,
            options: [
              { value: "all", label: t("restaurants.allBudgets") },
              { value: "2000", label: t("restaurants.budget2000") },
              { value: "5000", label: t("restaurants.budget5000") },
            ],
          },
          {
            key: "delivery",
            label: t("cbr.delivery"),
            value: delivery,
            onChange: setDelivery,
            options: [
              { value: "all", label: t("restaurants.allDelays") },
              { value: "15", label: t("restaurants.delay15") },
              { value: "30", label: t("restaurants.delay30") },
              { value: "45", label: t("restaurants.delay45") },
            ],
          },
        ]}
      />

      <p className="mt-4 text-sm text-text-secondary" aria-live="polite">
        {results.length}{" "}
        {t(results.length > 1 ? "restaurants.count_other" : "restaurants.count_one")}
        {/* Say WHY this order — an unexplained reordering reads as randomness. */}
        {sort === "nearMe" && homeQuartier && (
          <span className="text-text-light">
            {" · "}
            {t("restaurants.nearMeNote", { quartier: homeQuartier })}
          </span>
        )}
      </p>

      <div className="mt-6">
        {results.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title={t("restaurants.emptyTitle")}
            description={t("restaurants.emptyBody")}
            action={
              <Button variant="outline" onClick={clear}>
                {t("restaurants.reset")}
              </Button>
            }
          />
        ) : (
          <RestaurantGrid>
            {results.map((r) => (
              <RestaurantCard
                key={r.id}
                restaurant={r}
                href={hrefFor?.(r.slug)}
                action={action?.(r.id)}
              />
            ))}
          </RestaurantGrid>
        )}
      </div>
    </>
  );
}

/** Icon re-export so callers do not need a second lucide import. */
export { Store as DirectoryIcon };
