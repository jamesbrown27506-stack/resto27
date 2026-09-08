import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL } from "@/lib/seo-config";

/**
 * Generated, not a static file (§14.1).
 *
 * The host comes from the request-derived base URL, never a build-time
 * constant — §11 warns that a stale APP_URL fails in a uniquely confusing way,
 * and a robots.txt pointing at the wrong host de-indexes the real one.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = PUBLIC_SITE_URL;

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private areas. These are also gated server-side — robots.txt is a
        // politeness convention, not access control.
        disallow: ["/m/", "/a/", "/api/", "/account", "/orders", "/cart", "/checkout", "/settings", "/profile", "/addresses", "/loyalty", "/favorites"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
