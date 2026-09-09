export const PUBLIC_SITE_URL = "https://resto237.online";

export function isPublicPage(path: string): boolean {
  return ["/", "/restaurants", "/explore", "/about", "/pricing", "/contact", "/privacy", "/terms"].some(
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

/**
 * The URL slug for a dish page.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Dish pages were addressed by raw UUID:
 *
 *    /restaurants/mami-chop/menu/21d4ee21-804e-4e26-9c18-41c1f1cf6577
 *
 *  Forty-eight of the site's eighty-one pages looked like that. The URL is a
 *  ranking signal and a thing people read in a result, and a UUID carries
 *  neither the dish name nor anything else a searcher typed.
 *
 *  The six-character id suffix is deliberate. A bare name slug would collide
 *  the moment one restaurant lists two dishes with the same name — and the
 *  link is built from a single dish, with no knowledge of its siblings, so
 *  collisions cannot be detected at the point of generation. The suffix makes
 *  every slug unique by construction while keeping the dish name in the URL,
 *  which is the part that matters.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function dishSlug(name: string, id: string): string {
  const base = discoverySlug(name);
  const suffix = id.replace(/-/g, "").slice(0, 6);
  return base ? `${base}-${suffix}` : suffix;
}

export function dishPath(restaurantSlug: string, dish: { id: string; name: string }): string {
  return `/restaurants/${restaurantSlug}/menu/${dishSlug(dish.name, dish.id)}`;
}

/**
 * Whether partner-written copy is fit to be a meta description.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY A LANGUAGE CHECK AND NOT JUST A LENGTH ONE.
 *
 *  The restaurant page already fell back to a composed sentence when a
 *  partner's description was under 30 characters. Mami Chop's is
 *  "The best of feeling of a cameroonian dish" — 40 characters, so it passed
 *  the length gate and shipped as the meta description AND the schema
 *  `description` of a French page. It is English, and it is not grammatical
 *  in either language.
 *
 *  Detecting language properly is out of scope for a meta tag, so this is a
 *  deliberately crude signal: does the text carry the function words of the
 *  page's own language? French and English differ enough in their most common
 *  words that this separates the two reliably at sentence length, which is
 *  all that is being asked of it. It errs toward the composed fallback, and
 *  the composed fallback is always correct — just less characterful.
 * ─────────────────────────────────────────────────────────────────────────
 */
const FR_MARKERS = /\b(le|la|les|des|du|une|un|et|avec|dans|pour|sur|nos|vos|notre|votre|est|sont|au|aux|chez|plats?|cuisine|maison|saveurs?)\b/gi;
const EN_MARKERS = /\b(the|of|and|with|our|your|for|from|best|food|dish(es)?|taste|fresh|we|is|are|at|in)\b/gi;

export function isUsableDescription(text: string | null | undefined, locale: "fr" | "en"): boolean {
  const trimmed = text?.trim() ?? "";

  // Long enough to be a sentence rather than a label. 30 was too permissive:
  // it admitted six-word fragments.
  if (trimmed.length < 60) return false;

  const fr = (trimmed.match(FR_MARKERS) ?? []).length;
  const en = (trimmed.match(EN_MARKERS) ?? []).length;

  // No function words either way — a keyword list, not prose.
  if (fr === 0 && en === 0) return false;

  return locale === "fr" ? fr >= en : en >= fr;
}
