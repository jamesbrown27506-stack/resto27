export const PUBLIC_SITE_URL = "https://resto237.online";

export function isPublicPage(path: string): boolean {
  return ["/", "/restaurants", "/explore", "/pricing", "/contact", "/privacy", "/terms"].some(
    root => path === root || (root !== "/" && path.startsWith(root + "/")),
  );
}

export function publicHref(path: string, locale: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const url = new URL(path, PUBLIC_SITE_URL);
  if (!isPublicPage(url.pathname)) return path;
  url.searchParams.delete("lang");
  if (locale === "en") url.searchParams.set("lang", "en");
  return url.pathname + url.search + url.hash;
}

export function absolutePublicUrl(path: string, locale = "fr") {
  return new URL(publicHref(path, locale), PUBLIC_SITE_URL).href;
}

export function discoverySlug(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
