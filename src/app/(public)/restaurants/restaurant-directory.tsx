"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Store } from "lucide-react";
import { RestaurantCard, RestaurantGrid } from "@/components/restaurant/restaurant-card";
import { FilterBar } from "@/components/data/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
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
}: {
  restaurants: PublicRestaurant[];
  cuisines: string[];
  quartiers: string[];
  /** Lets /browse point at its own detail route. */
  hrefFor?: (slug: string) => string;
  /** Favourite toggle, injected by the signed-in directory. */
  action?: (restaurantId: string) => React.ReactNode;
}) {
  const params = useSearchParams();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const [quartier, setQuartier] = useState(params.get("quartier") ?? "all");
  const [cuisine, setCuisine] = useState(params.get("cuisine") ?? "all");
  const [sort, setSort] = useState(params.get("sort") ?? "rating");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();

    const filtered = restaurants.filter((r) => {
      if (quartier !== "all" && r.quartier !== quartier) return false;
      if (cuisine !== "all" && r.cuisine !== cuisine) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.cuisine.toLowerCase().includes(q) ||
        r.quartier.toLowerCase().includes(q)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sort === "delivery") return a.deliveryEstimateMin - b.deliveryEstimateMin;
      if (sort === "name") return a.name.localeCompare(b.name, "fr");
      return b.rating - a.rating;
    });
  }, [query, quartier, cuisine, sort, restaurants]);

  function clear() {
    setQuery("");
    setQuartier("all");
    setCuisine("all");
    setSort("rating");
  }

  return (
    <>
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Restaurant, plat ou cuisine…"
        onClear={clear}
        selects={[
          {
            key: "quartier",
            label: "Quartier",
            value: quartier,
            onChange: setQuartier,
            options: [
              { value: "all", label: "Tout Douala" },
              ...quartiers.map((q) => ({ value: q, label: q })),
            ],
          },
          {
            key: "cuisine",
            label: "Cuisine",
            value: cuisine,
            onChange: setCuisine,
            options: [
              { value: "all", label: "Toutes cuisines" },
              ...cuisines.map((c) => ({ value: c, label: c })),
            ],
          },
          {
            key: "sort",
            label: "Trier",
            value: sort,
            onChange: setSort,
            options: [
              { value: "rating", label: "Mieux notés" },
              { value: "delivery", label: "Plus rapides" },
              { value: "name", label: "Nom (A–Z)" },
            ],
          },
        ]}
      />

      <p className="mt-4 text-sm text-text-secondary" aria-live="polite">
        {results.length} restaurant{results.length > 1 ? "s" : ""}
      </p>

      <div className="mt-6">
        {results.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="Aucun restaurant ne correspond"
            description="Essayez un autre quartier, ou élargissez la recherche à toutes les cuisines."
            action={
              <Button variant="outline" onClick={clear}>
                Réinitialiser les filtres
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
