"use client";

import { createContext, useCallback, useMemo, useSyncExternalStore } from "react";
import { LOCALES, type Locale } from "./dictionaries";

export const LOCALE_COOKIE = "restolink-locale";

export interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

export const LocaleContext = createContext<LocaleContextValue>({
  locale: "fr",
  setLocale: () => {},
});

/* ── The store: <html lang> ─────────────────────────────────────────────── */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
}

/**
 * THE CLIENT READS `<html lang>`, NOT THE PROP. This is the whole fix.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  The previous version was `useState(initial)`, and useState reads its
 *  argument exactly once — on the render that first mounts the component.
 *  The provider lives in the ROOT layout, which survives every navigation, so
 *  that one read happened on the first page of the session and was never
 *  revisited.
 *
 *  Meanwhile the server re-reads the cookie on every request. Switch language
 *  and navigate, and the two drift apart in whichever direction the session
 *  happened to go — which is exactly what the console showed: one page with
 *  the server in French and the client in English, another with the reverse.
 *
 *  `<html lang>` cannot drift, because it is written by the same server
 *  render that produced the HTML being hydrated. Reading it means the client
 *  is quoting the document back to itself.
 *
 *  React calls getServerSnapshot for both the SSR render and the hydration
 *  render, then re-checks with getSnapshot immediately afterwards. So a stale
 *  `initial` no longer produces a hydration ERROR — it produces one ordinary
 *  re-render into the correct language, which is a recoverable outcome
 *  instead of a tree-wide regeneration.
 * ─────────────────────────────────────────────────────────────────────────
 */
function getSnapshot(): Locale {
  const lang = document.documentElement.getAttribute("lang");
  return (LOCALES as readonly string[]).includes(lang ?? "") ? (lang as Locale) : "fr";
}

/**
 * Holds the current locale for the client tree.
 *
 * `initial` still comes from the cookie (or Accept-Language) on the server,
 * and is what the server and the hydration pass both render.
 */
export function LocaleProvider({
  initial,
  children,
}: {
  initial: Locale;
  children: React.ReactNode;
}) {
  const locale = useSyncExternalStore(subscribe, getSnapshot, () => initial);

  const setLocale = useCallback((next: Locale) => {
    if (!(LOCALES as readonly string[]).includes(next)) return;

    // NOT httpOnly, deliberately: this is a display preference, not a
    // credential, and the client is the one that changes it. A year, because
    // re-asking someone their language every session is a small insult.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;

    // Written BEFORE notifying: the attribute is the store, so subscribers
    // must not be woken until it holds the new value. It also keeps screen
    // readers and hyphenation in step without a reload.
    document.documentElement.setAttribute("lang", next);

    for (const listener of listeners) listener();
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
