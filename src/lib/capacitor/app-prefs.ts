"use client";

import { Preferences } from "@capacitor/preferences";
import type { Locale } from "@/lib/i18n/dictionaries";

/**
 * What the installed app remembers between launches. Native storage rather
 * than cookies: it survives the WebView clearing its cache, and it is read
 * before the first page has decided anything.
 */
const ONBOARDED_KEY = "resto237:onboarded";
const LOCALE_KEY = "resto237:app-locale";

export async function hasOnboarded(): Promise<boolean> {
  return (await Preferences.get({ key: ONBOARDED_KEY })).value === "1";
}

export function markOnboarded(): Promise<void> {
  return Preferences.set({ key: ONBOARDED_KEY, value: "1" });
}

/**
 * The language the app opens in. The site opens in French by URL, so without
 * this an English phone — or someone who switched to English — would land on
 * French at every launch.
 */
export async function savedAppLocale(): Promise<Locale | null> {
  const value = (await Preferences.get({ key: LOCALE_KEY })).value;
  return value === "fr" || value === "en" ? value : null;
}

export function rememberAppLocale(locale: Locale): Promise<void> {
  return Preferences.set({ key: LOCALE_KEY, value: locale });
}
