import "server-only";
import { cache } from "react";
import { fetchDiscoveryCatalog } from "./discovery";
import { buildGuideCatalog } from "@/lib/seo-guides";

/**
 * Every guide page (see `seo-guides.ts`), built from the same catalog as the
 * discovery pages — one read of restaurants and menus per request, shared.
 */
export const fetchGuideCatalog = cache(async () => {
  const { restaurants, dishes } = await fetchDiscoveryCatalog();
  return buildGuideCatalog({
    restaurants,
    dishes: dishes.map((dish) => ({ name: dish.name, price: Number(dish.price), restaurantId: dish.restaurant_id })),
  });
});
