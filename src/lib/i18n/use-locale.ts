"use client";

import { useCallback, useContext } from "react";
import { DICTIONARIES, interpolate, type Locale, type TranslationKey } from "./dictionaries";
import { LocaleContext } from "./locale-provider";

export const DEFAULT_LOCALE: Locale = "fr";

/**
 * Read and change the interface language.
 *
 * The value comes from context, which the root layout seeds from a cookie
 * resolved on the server — see lib/i18n/locale-server.ts for why it is not
 * localStorage. Consumers are unchanged from the old external-store version;
 * only where the value originates has moved.
 */
export function useLocale() {
  const { locale, setLocale } = useContext(LocaleContext);

  /**
   * Translate. Falls back to the key itself rather than to French, so a
   * missing string is visible in review instead of silently shipping the
   * wrong language.
   */
  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string =>
      interpolate(DICTIONARIES[locale][key] ?? key, vars),
    [locale],
  );

  return { locale, setLocale, t };
}

/**
 * Re-exported, not defined here.
 *
 * This module is "use client", so anything it DEFINES becomes a client
 * reference that throws when a Server Component calls it — which is exactly
 * what /loyalty hit. The implementation moved to ./dictionaries (no "use
 * client", callable from both sides); this line keeps every existing client
 * import working without touching a single call site.
 */
export { intlLocale } from "./dictionaries";
