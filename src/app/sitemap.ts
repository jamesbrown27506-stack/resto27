import type { MetadataRoute } from "next";
import { fetchDiscoveryCatalog } from "@/lib/data/discovery";
import { absolutePublicUrl } from "@/lib/seo-config";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { restaurants, dishes, groups } = await fetchDiscoveryCatalog();
  const paths = new Set([
    "/", "/restaurants", "/explore", "/pricing", "/contact", "/privacy", "/terms",
    ...restaurants.map(r => "/restaurants/" + r.slug),
    ...dishes.map(d => "/restaurants/" + d.restaurant.slug + "/menu/" + d.id),
    ...groups.map(g => "/explore/" + g.kind + "/" + g.slug),
  ]);
  return [...paths].flatMap(path => ["fr", "en"].map(locale => ({
    url: absolutePublicUrl(path, locale),
    alternates: { languages: { "fr-CM": absolutePublicUrl(path), "en-CM": absolutePublicUrl(path, "en"), "x-default": absolutePublicUrl(path) } },
  })));
}
