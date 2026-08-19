"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { RestaurantDirectory } from "@/app/(public)/restaurants/restaurant-directory";
import { useToast } from "@/components/ui/toast";
import { toggleFavorite } from "@/lib/data/customer-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { PublicRestaurant } from "@/lib/data/public";
import { cn } from "@/lib/utils";

/**
 * Signed-in directory. Same component as /restaurants, plus favourite toggles
 * and links that point at /browse/[slug] so ordering stays inside the
 * authenticated flow.
 */
function FavoriteToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={active ? t("cbr.removeFavorite") : t("cbr.addFavorite")}
      // relative + z-10 so it sits above the card's stretched link.
      className={cn(
        "relative z-10 grid size-9 place-items-center rounded-full backdrop-blur-sm transition-colors",
        active ? "bg-surface text-error" : "bg-surface/85 text-text-light hover:text-error",
      )}
    >
      <Heart className={cn("size-4", active && "fill-current")} aria-hidden />
    </button>
  );
}

export function BrowseClient({
  initialFavorites,
  restaurants,
  cuisines,
  quartiers,
  dishSearch,
  homeQuartier,
}: {
  initialFavorites: string[];
  restaurants: PublicRestaurant[];
  cuisines: string[];
  quartiers: string[];
  dishSearch: Record<string, string>;
  /** From the customer's default address — drives the "near me" sort. */
  homeQuartier?: string;
}) {
  const { toast } = useToast();
  const [favorites, setFavorites] = useState<string[]>(initialFavorites);

  async function toggle(id: string) {
    setFavorites((current) =>
      current.includes(id) ? current.filter((f) => f !== id) : [...current, id],
    );
    const result = await toggleFavorite(id);
    if (!result.ok) {
      setFavorites((current) =>
        current.includes(id) ? current.filter((f) => f !== id) : [...current, id],
      );
      toast(result.error, "error");
    }
  }

  return (
    <RestaurantDirectory
      restaurants={restaurants}
      cuisines={cuisines}
      quartiers={quartiers}
      dishSearch={dishSearch}
      homeQuartier={homeQuartier}
      // One page per restaurant now — /browse/[slug] is a permanent redirect
      // to it, so linking straight there saves every customer a round trip.
      hrefFor={(slug) => `/restaurants/${slug}`}
      action={(id) => (
        <FavoriteToggle active={favorites.includes(id)} onToggle={() => toggle(id)} />
      )}
    />
  );
}