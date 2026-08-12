"use client";

import { useMemo } from "react";
import {
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDayLabel,
  formatRelative,
  formatTime,
  weekdayName,
} from "./datetime";
import { intlLocale, useLocale } from "@/lib/i18n/use-locale";

/**
 * The date helpers, bound to the interface language.
 *
 * Every function in ./datetime takes an optional trailing `locale`, which is
 * correct but tedious at forty call sites — and a call site that forgets it
 * fails silently, in French, which is exactly the bug that is hard to spot in
 * review. This hook removes the opportunity.
 *
 * Client components only. A Server Component has no locale in context; it
 * either passes an already-formatted string down, or lets the default French
 * stand — which is the right answer for the print ticket and for email.
 */
export function useDates() {
  const { locale } = useLocale();

  return useMemo(() => {
    const tag = intlLocale(locale);
    return {
      /** "3 août 2026" / "3 August 2026" */
      date: (value: Date | string | number) => formatDate(value, tag),
      /** "03/08/2026" */
      dateShort: (value: Date | string | number) => formatDateShort(value, tag),
      /** "14:30" */
      time: (value: Date | string | number) => formatTime(value, tag),
      /** "3 août 2026 à 14:30" */
      dateTime: (value: Date | string | number) => formatDateTime(value, tag),
      /** "lun. 3 août" */
      dayLabel: (value: Date | string | number) => formatDayLabel(value, tag),
      /** "lundi" / "Monday", from a 0–6 index where 0 is Sunday. */
      weekday: (weekday: number) => weekdayName(weekday, tag),
      /**
       * "il y a 5 minutes". `now` stays REQUIRED here on purpose: it must come
       * from a server-stamped instant, or the server and the browser format
       * two different clocks and React reports a hydration mismatch on every
       * row.
       */
      relative: (value: Date | string | number, now: Date | string | number) =>
        formatRelative(value, now, tag),
      /** The raw Intl tag, for a caller that needs its own formatter. */
      locale: tag,
    };
  }, [locale]);
}
