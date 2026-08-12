import "server-only";
import { cookies, headers } from "next/headers";
import { LOCALES, type Locale } from "./dictionaries";

export const DEFAULT_LOCALE: Locale = "fr";
export const LOCALE_COOKIE = "restolink-locale";

/**
 * The locale, resolved ON THE SERVER.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS MOVED OUT OF localStorage.
 *
 *  The first version kept the locale in localStorage and read it with
 *  useSyncExternalStore. That cannot work: the server has no localStorage and
 *  no navigator, so it always rendered French, while an English browser
 *  hydrated as English. React compared the two, found "Skip to content" where
 *  the HTML said "Aller au contenu", and threw a hydration mismatch — which
 *  then regenerated the whole tree on the client, which re-rendered <head>,
 *  which produced the "script tag while rendering" warning and a removeChild
 *  error as React tore down nodes the browser had already moved. THREE
 *  symptoms, one cause.
 *
 *  A cookie is readable in both places, so the server renders the right
 *  language the first time and hydration has nothing to disagree about.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const chosen = store.get(LOCALE_COOKIE)?.value;
  if (chosen && (LOCALES as readonly string[]).includes(chosen)) {
    return chosen as Locale;
  }

  // No cookie yet — first visit. Honour what the browser asked for rather than
  // defaulting everyone to French: Accept-Language is exactly this signal, and
  // it arrives on the very first request, before any JavaScript runs.
  return localeFromAcceptLanguage((await headers()).get("accept-language"));
}

/**
 * Browsers send Accept-Language already ordered by preference, so the first
 * tag we recognise is the answer. Full q-value parsing buys nothing here: with
 * two supported languages, ordering and weighting agree.
 */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;

  for (const part of header.split(",")) {
    const tag = part.split(";")[0]!.trim().toLowerCase().split("-")[0];
    if ((LOCALES as readonly string[]).includes(tag)) return tag as Locale;
  }

  return DEFAULT_LOCALE;
}
