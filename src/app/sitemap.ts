import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";
import { fetchActiveRestaurants } from "@/lib/data/public";

/**
 * Generated sitemap. Lists EVERY ACTIVE RESTAURANT, live (§14.1) — a newly
 * approved restaurant must appear without a deploy, which a checked-in static
 * file cannot do.
 *
 * Pending and suspended tenants are excluded: submitting a URL that 404s or
 * redirects wastes crawl budget and teaches Google to trust the file less.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await siteUrl();
  const restaurants = await fetchActiveRestaurants();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/restaurants`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/register/restaurant`, changeFrequency: "monthly", priority: 0.6 },
  ];

  const restaurantRoutes: MetadataRoute.Sitemap = restaurants.map((r) => ({
    url: `${base}/restaurants/${r.slug}`,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...staticRoutes, ...restaurantRoutes];
}
