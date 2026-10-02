import { discoverySlug } from "@/lib/seo-config";
import { rotationKey } from "@/lib/discovery/placement";

/**
 * Menu summaries for public listings: the homepage's dish tiles and the price
 * range on restaurant cards. Pure functions, so they are tested without a
 * database; the reads that feed them live in lib/data.
 */

export interface DishGroup {
  /** Its /explore/food/<slug> page lists every restaurant that serves it. */
  slug: string;
  name: string;
  imageUrl: string | null;
  restaurantCount: number;
  /** The cheapest price across those restaurants; null when none is priced. */
  minPrice: number | null;
}

export interface PriceRange {
  min: number;
  max: number;
}

/**
 * One tile per DISH, not per menu item.
 *
 * The same dish from three kitchens is one tile that leads to all three, so a
 * visitor chooses what to eat first and then the restaurant — the nearest, or
 * the cheapest — instead of being handed one restaurant's version. Dishes
 * served by more restaurants come first, because those are the ones worth
 * comparing; then those with a photograph, which is what makes a tile.
 *
 * With `placement` (lib/discovery/placement), the dish served by the
 * best-placed restaurant leads instead — a paying kitchen's dishes are not
 * shown after a free one's — and its photo is the one on the tile. With `day`,
 * ties rotate daily instead of running alphabetically: every restaurant
 * carries the same dozen dishes, and A-to-Z meant Ndolé and Poulet DG never
 * reached the homepage at all.
 */
export function groupDishes(
  dishes: { name: string; price: number; imageUrl: string | null; restaurantId: string }[],
  limit: number,
  options: { placement?: Map<string, number>; day?: string } = {},
): DishGroup[] {
  const { placement, day } = options;
  const rankOf = (restaurantId: string) => placement?.get(restaurantId) ?? Number.MAX_SAFE_INTEGER;
  const groups = new Map<
    string,
    { name: string; imageUrl: string | null; imageRank: number; bestRank: number; restaurants: Set<string>; minPrice: number }
  >();

  for (const dish of dishes) {
    const slug = discoverySlug(dish.name);
    if (!slug) continue;
    // A free item (a glass of water) must not become "from 0 FCFA".
    const price = dish.price > 0 ? dish.price : Infinity;
    const rank = rankOf(dish.restaurantId);
    const group = groups.get(slug);
    if (!group) {
      groups.set(slug, {
        name: dish.name,
        imageUrl: dish.imageUrl,
        imageRank: dish.imageUrl ? rank : Number.MAX_SAFE_INTEGER,
        bestRank: rank,
        restaurants: new Set([dish.restaurantId]),
        minPrice: price,
      });
      continue;
    }
    group.restaurants.add(dish.restaurantId);
    group.bestRank = Math.min(group.bestRank, rank);
    if (dish.imageUrl && (!group.imageUrl || rank < group.imageRank)) {
      group.imageUrl = dish.imageUrl;
      group.imageRank = rank;
    }
    group.minPrice = Math.min(group.minPrice, price);
  }

  return [...groups.entries()]
    .map(([slug, group]) => ({
      slug,
      name: group.name,
      imageUrl: group.imageUrl,
      restaurantCount: group.restaurants.size,
      minPrice: Number.isFinite(group.minPrice) ? group.minPrice : null,
      bestRank: group.bestRank,
    }))
    .sort((a, b) =>
      (placement ? a.bestRank - b.bestRank : 0) ||
      b.restaurantCount - a.restaurantCount ||
      Number(!a.imageUrl) - Number(!b.imageUrl) ||
      (day ? rotationKey(a.slug, day) - rotationKey(b.slug, day) : a.name.localeCompare(b.name, "fr")))
    .slice(0, limit)
    .map((group) => ({
      slug: group.slug,
      name: group.name,
      imageUrl: group.imageUrl,
      restaurantCount: group.restaurantCount,
      minPrice: group.minPrice,
    }));
}

export function priceRangesByRestaurant(items: { restaurantId: string; price: number }[]): Map<string, PriceRange> {
  const ranges = new Map<string, PriceRange>();
  for (const { restaurantId, price } of items) {
    if (!Number.isFinite(price) || price <= 0) continue;
    const range = ranges.get(restaurantId);
    if (!range) ranges.set(restaurantId, { min: price, max: price });
    else {
      range.min = Math.min(range.min, price);
      range.max = Math.max(range.max, price);
    }
  }
  return ranges;
}
