import "server-only";
import { absolutePublicUrl } from "./seo-config";
import type { Locale } from "./i18n/dictionaries";

/**
 * `BreadcrumbList` JSON-LD.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Breadcrumbs existed on exactly one page type — the menu-item page — and
 *  nowhere else, so Google had no declared hierarchy for the listing pages
 *  that actually sit above it. Breadcrumbs are what let a result show
 *  "Resto237 › Explorer › Ndolé à Douala" instead of a bare URL, and on a
 *  marketplace with a real taxonomy (quartier / cuisine / plat) that path is
 *  most of what tells a searcher where they are about to land.
 *
 *  Positions are 1-based and the trailing item is the current page, which is
 *  included with its own URL — Google accepts the self-referencing last crumb
 *  and it keeps the list complete for anything else reading it.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function breadcrumbJsonLd(
  trail: { name: string; path: string }[],
  locale: Locale,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absolutePublicUrl(crumb.path, locale),
    })),
  };
}
