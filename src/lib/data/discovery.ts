import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchActiveRestaurants } from "./public";
import { relationOne } from "@/lib/public-utils";
import { discoverySlug, dishPath } from "@/lib/seo-config";
import { groupDishes, type DishGroup } from "@/lib/menu-summary";
import { pickMenuDishes, placementDay } from "@/lib/discovery/placement";
import { effectiveCourse } from "@/lib/menu/course";
import { isMissingColumn } from "./missing-column";

type CatalogRow = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  updated_at: string | null;
  /** 0071 — absent on a database that has not run it. */
  course?: string | null;
  menu_categories: { is_active: boolean; name?: string | null } | { is_active: boolean; name?: string | null }[] | null;
};

/**
 * Every available dish in an active category of an active restaurant, paged
 * past PostgREST's 1 000-row cap. `course` (0071) is asked for and dropped
 * if the database does not have it yet, remembered for the process — a
 * missing column must cost the course chips their manager overrides, never
 * the catalogue behind the homepage, Explore and the sitemap.
 */
let courseColumnExists: boolean | null = null;

async function readCatalogRows(): Promise<CatalogRow[]> {
  const db = createAdminClient();
  const read = async (withCourse: boolean) => {
    const rows: CatalogRow[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await db.from("menu_items")
        .select(`id, restaurant_id, name, description, price, image_url, updated_at${withCourse ? ", course" : ""}, menu_categories(is_active, name), restaurants!inner(status)`)
        .eq("is_available", true).eq("restaurants.status", "active").order("id").range(start, start + 999);
      if (error) return { rows, error };
      rows.push(...(data ?? []) as unknown as CatalogRow[]);
      if (!data || data.length < 1000) break;
    }
    return { rows, error: null };
  };

  if (courseColumnExists !== false) {
    const first = await read(true);
    if (!first.error) {
      courseColumnExists = true;
      return first.rows;
    }
    if (!isMissingColumn(first.error, "course")) throw new Error("Public menu catalog is unavailable");
    console.warn("[discovery] menu_items.course is missing — run migration 0071. Dish courses are inferred until then.");
    courseColumnExists = false;
  }
  const fallback = await read(false);
  if (fallback.error) throw new Error("Public menu catalog is unavailable");
  return fallback.rows;
}

export const fetchDiscoveryCatalog = cache(async () => {
  const restaurants = await fetchActiveRestaurants();
  const byId = new Map(restaurants.map(r => [r.id, r]));
  const rows = await readCatalogRows();
  const dishes = rows.filter(row => byId.has(row.restaurant_id) && relationOne(row.menu_categories)?.is_active !== false)
    .map(row => ({
      ...row,
      restaurant: byId.get(row.restaurant_id)!,
      /** Where the dish is browsed: the restaurant's choice, else inferred (lib/menu/course). */
      dishCourse: effectiveCourse({ course: row.course, name: row.name, categoryName: relationOne(row.menu_categories)?.name }),
    }));
  const groups = [
    ...Array.from(new Set(restaurants.map(r => r.quartier).filter(Boolean))).map(name => ({ kind: "neighbourhood", name, slug: discoverySlug(name) })),
    ...Array.from(new Set(restaurants.map(r => r.cuisine).filter(Boolean))).map(name => ({ kind: "cuisine", name, slug: discoverySlug(name) })),
    ...Array.from(new Set(dishes.map(d => d.name))).map(name => ({ kind: "food", name, slug: discoverySlug(name) })),
  ].filter(group => group.slug);
  const uniqueGroups = [...new Map(groups.map(group => [group.kind + ":" + group.slug, group])).values()];
  return { restaurants, dishes, groups: uniqueGroups };
});

type DiscoveryCatalog = Awaited<ReturnType<typeof fetchDiscoveryCatalog>>;

/**
 * How many distinct restaurants stand behind a discovery page — the number
 * the quality gate (`isDiscoveryIndexable`) is decided on. Matched on the
 * same fields the group was derived from, so page, sitemap and gate agree.
 */
export function groupRestaurantCount(catalog: Pick<DiscoveryCatalog, "restaurants" | "dishes">, group: { kind: string; slug: string }): number {
  if (group.kind === "neighbourhood") return catalog.restaurants.filter(r => discoverySlug(r.quartier) === group.slug).length;
  if (group.kind === "cuisine") return catalog.restaurants.filter(r => discoverySlug(r.cuisine) === group.slug).length;
  return new Set(catalog.dishes.filter(d => discoverySlug(d.name) === group.slug).map(d => d.restaurant_id)).size;
}

/**
 * The homepage's dish tiles: one per dish, each leading to its
 * /explore/food page. Never throws — the catalog does, and a menu read that
 * fails must cost the homepage one section, not the whole page.
 */
export async function fetchHomeDishGroups(limit = 6): Promise<DishGroup[]> {
  try {
    const { dishes, restaurants } = await fetchDiscoveryCatalog();
    return groupDishes(
      dishes.map((dish) => ({
        name: dish.name,
        price: Number(dish.price),
        imageUrl: dish.image_url,
        restaurantId: dish.restaurant_id,
      })),
      limit,
      { placement: placementMap(restaurants), day: placementDay(new Date()) },
    );
  } catch (error) {
    console.error("[discovery:fetchHomeDishGroups]", (error as Error).message);
    return [];
  }
}

function placementMap(restaurants: { id: string; placement?: number }[]): Map<string, number> {
  return new Map(restaurants.map((r, index) => [r.id, r.placement ?? index]));
}

/** One dish as the signed-in home's "on the menu today" grid shows it. */
export interface MenuPick {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
  href: string;
  restaurantName: string;
}

/**
 * Real dishes from real menus for the signed-in home — each opens its own
 * dish page, where the menu's add-to-basket (options, one-kitchen basket)
 * already lives. Ordered by lib/discovery/placement: the better-placed
 * restaurant leads every round, each dish name once, the photo first.
 * Free items (a glass of water) are not suggestions. Never throws.
 */
export async function fetchMenuPicks(limit = 6): Promise<MenuPick[]> {
  try {
    const { dishes, restaurants } = await fetchDiscoveryCatalog();
    const priced = dishes.filter((dish) => Number(dish.price) > 0);
    const picks = pickMenuDishes(
      priced.map((dish) => ({ ...dish, restaurantId: dish.restaurant_id, hasPhoto: Boolean(dish.image_url) })),
      placementMap(restaurants),
      placementDay(new Date()),
      limit,
    );
    return picks.map((dish) => ({
      id: dish.id,
      name: dish.name,
      price: Number(dish.price),
      imageUrl: dish.image_url,
      href: dishPath(dish.restaurant.slug, dish),
      restaurantName: dish.restaurant.name,
    }));
  } catch (error) {
    console.error("[discovery:fetchMenuPicks]", (error as Error).message);
    return [];
  }
}
