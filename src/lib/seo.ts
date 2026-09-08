import "server-only";
import type { Metadata } from "next";
import { absolutePublicUrl } from "./seo-config";
import { getLocale } from "./i18n/locale-server";

export async function publicMetadata(path: string, title: string, description: string, image?: string | null): Promise<Metadata> {
  const locale = await getLocale();
  const canonical = absolutePublicUrl(path, locale);
  return {
    title, description,
    alternates: { canonical, languages: { "fr-CM": absolutePublicUrl(path), "en-CM": absolutePublicUrl(path, "en"), "x-default": absolutePublicUrl(path) } },
    openGraph: { title, description, url: canonical, locale: locale === "fr" ? "fr_CM" : "en_CM", type: "website",
      images: image ? [{ url: new URL(image, canonical).href }] : [{ url: absolutePublicUrl("/app-icon-512.png") }] },
    twitter: { card: "summary_large_image", title, description, images: [image ? new URL(image, canonical).href : absolutePublicUrl("/app-icon-512.png")] },
  };
}

export function jsonLdString(value: unknown) { return JSON.stringify(value).replace(/</g, "\\u003c"); }
