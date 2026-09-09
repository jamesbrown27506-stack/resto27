import "server-only";
import type { Metadata } from "next";
import { absolutePublicUrl } from "./seo-config";
import { getLocale } from "./i18n/locale-server";

/**
 * The fallback share card.
 *
 * Was `/app-icon-512.png` — a 512×512 app icon paired with a
 * `summary_large_image` Twitter card, which wants roughly 1200×630. See
 * `app/og/route.tsx` for the generated replacement.
 */
const FALLBACK_OG_IMAGE = "/og";

export async function publicMetadata(path: string, title: string, description: string, image?: string | null): Promise<Metadata> {
  const locale = await getLocale();
  const canonical = absolutePublicUrl(path, locale);
  const imageUrl = image ? new URL(image, canonical).href : absolutePublicUrl(FALLBACK_OG_IMAGE);
  return {
    title, description,
    alternates: { canonical, languages: { "fr-CM": absolutePublicUrl(path), "en-CM": absolutePublicUrl(path, "en"), "x-default": absolutePublicUrl(path) } },
    openGraph: { title, description, url: canonical, locale: locale === "fr" ? "fr_CM" : "en_CM", type: "website",
      images: [{ url: imageUrl, ...(image ? {} : { width: 1200, height: 630 }) }] },
    twitter: { card: "summary_large_image", title, description, images: [imageUrl] },
  };
}

export function jsonLdString(value: unknown) { return JSON.stringify(value).replace(/</g, "\\u003c"); }
