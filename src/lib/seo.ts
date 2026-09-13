import "server-only";
import type { Metadata } from "next";
import { absolutePublicUrl } from "./seo-config";
import { getLocale } from "./i18n/locale-server";
import { getBranding } from "./branding";

/**
 * The fallback share card.
 *
 * Was `/app-icon-512.png` — a 512×512 app icon paired with a
 * `summary_large_image` Twitter card, which wants roughly 1200×630. See
 * `app/og/route.tsx` for the generated replacement.
 */
const FALLBACK_OG_IMAGE = "/og";

/**
 * `index: false` keeps a reachable page out of search results while still
 * letting crawlers follow its links — for pages too thin to rank yet (see
 * the quality gates in `seo-guides.ts` and `discovery-content.ts`).
 */
export async function publicMetadata(
  path: string,
  title: string,
  description: string,
  image?: string | null,
  options: { index?: boolean } = {},
): Promise<Metadata> {
  const [locale, brand] = await Promise.all([getLocale(), getBranding()]);
  const canonical = absolutePublicUrl(path, locale);
  const imageUrl = image ? new URL(image, canonical).href : absolutePublicUrl(FALLBACK_OG_IMAGE);
  // The root layout's template appends " | {brand}". A title that already
  // names the brand shipped it twice: "À propos de Resto237 | Resto237".
  const namesBrand = Boolean(brand.name) && title.toLowerCase().includes(brand.name.toLowerCase());
  return {
    title: namesBrand ? { absolute: title } : title,
    description,
    ...(options.index === false ? { robots: { index: false, follow: true } } : {}),
    alternates: { canonical, languages: { "fr-CM": absolutePublicUrl(path), "en-CM": absolutePublicUrl(path, "en"), "x-default": absolutePublicUrl(path) } },
    openGraph: { title, description, url: canonical, locale: locale === "fr" ? "fr_CM" : "en_CM", type: "website",
      images: [{ url: imageUrl, ...(image ? {} : { width: 1200, height: 630 }) }] },
    twitter: { card: "summary_large_image", title, description, images: [imageUrl] },
  };
}

export function jsonLdString(value: unknown) { return JSON.stringify(value).replace(/</g, "\\u003c"); }

/**
 * `FAQPage` structured data for questions that are VISIBLE on the page.
 *
 * Google shows FAQ rich results only for a few authoritative sites now, but
 * the markup still tells every search and answer engine which sentence
 * answers which question — the part that gets quoted.
 */
export function faqJsonLd(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
