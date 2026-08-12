"use client";

import { useLocale } from "@/lib/i18n/use-locale";

/** Visible only on keyboard focus. Client component so it can be translated. */
export function SkipLink() {
  const { t } = useLocale();

  return (
    <a href="#main" className="skip-link">
      {t("nav.skipToContent")}
    </a>
  );
}
