import type { Locale } from "@/lib/i18n/dictionaries";
import { isPublicPage, publicHref, PUBLIC_SITE_URL } from "@/lib/seo-config";

/**
 * The installed app's launch decisions, as pure functions so they are tested
 * without a phone. The components that act on them are app-launch.tsx and
 * app-update-prompt.tsx.
 */

/** The phone's language as the site's: English for any English tag, else French. */
export function localeFromTag(tag: string | null | undefined): Locale {
  return (tag ?? "").trim().toLowerCase().startsWith("en") ? "en" : "fr";
}

/**
 * Where to send the app so the page is in `target`, or null when it already
 * is — or cannot be, because only public pages carry their language in the
 * URL (?lang=en). Every other page reads the cookie the provider just wrote.
 */
export function launchLocaleHref(current: string, target: Locale): string | null {
  const url = new URL(current, PUBLIC_SITE_URL);
  if (!isPublicPage(url.pathname)) return null;
  const next = publicHref(url.pathname + url.search + url.hash, target);
  return next === url.pathname + url.search + url.hash ? null : next;
}

/**
 * From versionCode 4 (app 1.3) Android holds its launch screen until the
 * site's launch screen takes over. Older builds hide it on a fixed timer, so
 * by the time the site is ready the page is already showing — playing the
 * animated mark then would cover a loaded page and hand it back again.
 */
export const SPLASH_HELD_FROM = 4;

export function splashIsHeld(build: string | number | null | undefined): boolean {
  const code = Number.parseInt(String(build ?? ""), 10);
  return Number.isFinite(code) && code >= SPLASH_HELD_FROM;
}

/**
 * True when the installed app is older than the published APK.
 *
 * `installedBuild` is what Capacitor's App.getInfo() reports as `build` — on
 * Android the versionCode, as a string. Anything unreadable counts as not
 * outdated: a prompt that cannot tell is worse than no prompt.
 */
export function isOutdated(installedBuild: string | number | null | undefined, latestCode: number): boolean {
  const installed = Number.parseInt(String(installedBuild ?? ""), 10);
  return Number.isFinite(installed) && installed > 0 && installed < latestCode;
}
