import type { MetadataRoute } from "next";
import { fetchDiscoveryCatalog, groupRestaurantCount } from "@/lib/data/discovery";
import { fetchGuideCatalog } from "@/lib/data/guides";
import { isDiscoveryIndexable } from "@/lib/discovery-content";
import { absolutePublicUrl, dishPath } from "@/lib/seo-config";
export const dynamic = "force-dynamic";

/**
 * `lastmod`, and why most entries carry one while a few deliberately do not.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  This sitemap shipped 162 URLs and not a single <lastmod>. Google uses it
 *  to decide what to recrawl and when, so without it a price change or a new
 *  dish waits for the next general crawl instead of being fetched because
 *  something actually moved.
 *
 *  The temptation is to stamp everything with "now" and be done. That is
 *  worse than omitting it: Google demonstrably discounts lastmod values it
 *  finds unreliable, and a sitemap where all 162 URLs change every time it is
 *  requested is the definition of unreliable — it would poison the signal for
 *  the pages that DO have a truthful date.
 *
 *  So: a page gets a lastmod only when a real timestamp backs it.
 *    · a dish page      -> that menu item's updated_at
 *    · a restaurant page-> the newest updated_at across its dishes, because a
 *                          menu edit is what actually changes that page
 *    · a group page     -> the newest updated_at among the dishes behind it
 *    · a guide page     -> the newest updated_at among its restaurants' dishes
 *    · /privacy, /terms, /pricing, /contact, /, /restaurants, /explore
 *                       -> nothing. Their content changes on deploy, and we
 *                          have no per-page record of when that last was.
 *
 *  Only pages that pass their quality gate are listed: a discovery page with
 *  one restaurant and no written copy, or a guide with fewer than two
 *  matches, is `noindex` — listing it here would contradict the page.
 * ─────────────────────────────────────────────────────────────────────────
 */
function newest(dates: (string | null | undefined)[]): Date | undefined {
  const times = dates
    .filter((d): d is string => Boolean(d))
    .map(d => new Date(d).getTime())
    .filter(t => Number.isFinite(t));
  return times.length ? new Date(Math.max(...times)) : undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [catalog, { guides }] = await Promise.all([fetchDiscoveryCatalog(), fetchGuideCatalog()]);
  const { restaurants, dishes, groups } = catalog;

  const dishesByRestaurant = new Map<string, string[]>();
  for (const dish of dishes) {
    const list = dishesByRestaurant.get(dish.restaurant.slug) ?? [];
    if (dish.updated_at) list.push(dish.updated_at);
    dishesByRestaurant.set(dish.restaurant.slug, list);
  }

  /**
   * Which dishes sit behind each discovery group, so a group page inherits a
   * truthful date. `groups` is built from the same catalog, so matching on the
   * same fields the group was derived from keeps the two in step.
   */
  const groupDates = new Map<string, string[]>();
  for (const dish of dishes) {
    if (!dish.updated_at) continue;
    const keys = [
      "food:" + dish.name,
      "neighbourhood:" + dish.restaurant.quartier,
      "cuisine:" + dish.restaurant.cuisine,
    ];
    for (const key of keys) {
      const list = groupDates.get(key) ?? [];
      list.push(dish.updated_at);
      groupDates.set(key, list);
    }
  }

  const entries: { path: string; lastModified?: Date }[] = [
    // Static pages: no trustworthy per-page timestamp, so no lastmod.
    { path: "/" },
    { path: "/restaurants" },
    { path: "/explore" },
    { path: "/about" },
    { path: "/pricing" },
    { path: "/contact" },
    { path: "/privacy" },
    { path: "/terms" },

    ...restaurants.map(r => ({
      path: "/restaurants/" + r.slug,
      lastModified: newest(dishesByRestaurant.get(r.slug) ?? []),
    })),

    ...dishes.map(d => ({
      path: dishPath(d.restaurant.slug, d),
      lastModified: newest([d.updated_at]),
    })),

    ...groups
      .filter(g => isDiscoveryIndexable(g.kind, g.slug, groupRestaurantCount(catalog, g)))
      .map(g => ({
        path: "/explore/" + g.kind + "/" + g.slug,
        lastModified: newest(groupDates.get(g.kind + ":" + g.name) ?? []),
      })),

    ...guides
      .filter(g => g.indexable)
      .map(g => ({
        path: "/explore/guide/" + g.slug,
        lastModified: newest(g.restaurants.flatMap(r => dishesByRestaurant.get(r.slug) ?? [])),
      })),
  ];

  // De-duplicate by path, keeping the first occurrence — the same behaviour
  // the previous Set-of-paths had.
  const byPath = new Map<string, { path: string; lastModified?: Date }>();
  for (const entry of entries) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, entry);
  }

  return [...byPath.values()].flatMap(({ path, lastModified }) =>
    ["fr", "en"].map(locale => ({
      url: absolutePublicUrl(path, locale),
      ...(lastModified ? { lastModified } : {}),
      alternates: {
        languages: {
          "fr-CM": absolutePublicUrl(path),
          "en-CM": absolutePublicUrl(path, "en"),
          "x-default": absolutePublicUrl(path),
        },
      },
    })),
  );
}
