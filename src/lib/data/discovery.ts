import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchActiveRestaurants } from "./public";
import { relationOne } from "@/lib/public-utils";
import { discoverySlug } from "@/lib/seo-config";
import { groupDishes, type DishGroup } from "@/lib/menu-summary";

export const fetchDiscoveryCatalog = cache(async () => {
  const restaurants = await fetchActiveRestaurants();
  const byId = new Map(restaurants.map(r => [r.id, r]));
  const db = createAdminClient();
  type Row = { id: string; restaurant_id: string; name: string; description: string; price: number; image_url: string | null; updated_at: string | null; menu_categories: { is_active: boolean } | { is_active: boolean }[] | null };
  const rows: Row[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await db.from("menu_items")
      .select("id, restaurant_id, name, description, price, image_url, updated_at, menu_categories(is_active), restaurants!inner(status)")
      .eq("is_available", true).eq("restaurants.status", "active").order("id").range(start, start + 999);
    if (error) throw new Error("Public menu catalog is unavailable");
    rows.push(...(data ?? []) as unknown as Row[]);
    if (!data || data.length < 1000) break;
  }
  const dishes = rows.filter(row => byId.has(row.restaurant_id) && relationOne(row.menu_categories)?.is_active !== false)
    .map(row => ({ ...row, restaurant: byId.get(row.restaurant_id)! }));
  const groups = [
    ...Array.from(new Set(restaurants.map(r => r.quartier).filter(Boolean))).map(name => ({ kind: "neighbourhood", name, slug: discoverySlug(name) })),
    ...Array.from(new Set(restaurants.map(r => r.cuisine).filter(Boolean))).map(name => ({ kind: "cuisine", name, slug: discoverySlug(name) })),
    ...Array.from(new Set(dishes.map(d => d.name))).map(name => ({ kind: "food", name, slug: discoverySlug(name) })),
  ].filter(group => group.slug);
  const uniqueGroups = [...new Map(groups.map(group => [group.kind + ":" + group.slug, group])).values()];
  return { restaurants, dishes, groups: uniqueGroups };
});

/**
 * The homepage's dish tiles: one per dish, each leading to its
 * /explore/food page. Never throws — the catalog does, and a menu read that
 * fails must cost the homepage one section, not the whole page.
 */
export async function fetchHomeDishGroups(limit = 6): Promise<DishGroup[]> {
  try {
    const { dishes } = await fetchDiscoveryCatalog();
    return groupDishes(
      dishes.map((dish) => ({
        name: dish.name,
        price: Number(dish.price),
        imageUrl: dish.image_url,
        restaurantId: dish.restaurant_id,
      })),
      limit,
    );
  } catch (error) {
    console.error("[discovery:fetchHomeDishGroups]", (error as Error).message);
    return [];
  }
}
