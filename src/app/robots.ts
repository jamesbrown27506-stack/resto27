import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL } from "@/lib/seo-config";

/** Private areas. Also gated server-side — robots.txt is politeness, not access control. */
const PRIVATE_PATHS = [
  "/m/",
  "/a/",
  "/api/",
  "/account",
  "/orders",
  "/cart",
  "/checkout",
  "/settings",
  "/profile",
  "/addresses",
  "/loyalty",
  "/favorites",
];

/**
 * AI crawlers, listed explicitly and allowed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  The blanket `User-agent: *` already permitted every one of these, so this
 *  block changes no behaviour. It is here to state the intent, because the
 *  default reads as an accident and the usual instinct is to start blocking.
 *
 *  Blocking would be wrong for this site specifically. The standard advice —
 *  allow the search crawlers, block the training ones — is written for
 *  publishers whose original writing is the product and who lose when it is
 *  repackaged elsewhere. Resto237 is the opposite case: menus and prices
 *  exist to be found, there is no editorial asset to protect, and the brand
 *  is unknown. Being absent from training data does not protect anything
 *  here; it only makes it less likely that an assistant asked "où commander
 *  du ndolé à Douala" has ever heard of the place.
 *
 *  Revisit this if the site ever publishes original writing worth licensing.
 * ─────────────────────────────────────────────────────────────────────────
 */
const AI_CRAWLERS = [
  // Retrieval / answer engines
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-User",
  "Claude-SearchBot",
  // Indexing / training
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Bytespider",
  "Amazonbot",
  "meta-externalagent",
];

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
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: AI_CRAWLERS,
        allow: "/",
        // The same private areas: an assistant has no more business in a
        // customer's basket than a search engine does.
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
