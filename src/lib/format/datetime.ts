/**
 * Date and time formatting.
 *
 * Rule from §16: timestamps are stored `timestamptz` in UTC and rendered in
 * `Africa/Douala`. The old schema stored naive local time, which breaks the
 * moment a second country opens. Every date in the UI goes through here so
 * there is exactly one place that knows the display zone.
 *
 * Uses Intl directly — no date library. Intl already knows Douala, ships with
 * the runtime, and works identically on the server and in the browser.
 */

export const DISPLAY_TZ = "Africa/Douala";

/**
 * Default locale for dates and numbers. Cameroon is francophone-majority, so
 * French is what an unspecified caller gets — including the thermal ticket and
 * outgoing email, which are deliberately French whatever the interface is set
 * to.
 */
export const DISPLAY_LOCALE = "fr-CM";

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  EVERY FUNCTION HERE TAKES AN OPTIONAL TRAILING `locale`.
 *
 *  It used to be a module constant, which meant an English interface still
 *  said "3 août 2026" — the one string on the page the language toggle could
 *  not reach. Passing it explicitly rather than reading a global is what keeps
 *  a Server Component and its hydration agreeing on the same text; a formatter
 *  that sniffed the current locale at call time would render French on the
 *  server and English in the browser, which is a hydration mismatch, not a
 *  translation.
 *
 *  Client components get it bound for them by `useDates()` in ./use-dates.
 * ─────────────────────────────────────────────────────────────────────────
 */
type DateInput = Date | string | number;

function toDate(value: DateInput): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions, locale: string): Intl.DateTimeFormat {
  // The locale belongs in the cache key. Without it the first caller wins and
  // every later one silently gets that language.
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: DISPLAY_TZ, ...options });
    cache.set(key, f);
  }
  return f;
}

/** "3 août 2026" */
export function formatDate(value: DateInput, locale: string = DISPLAY_LOCALE): string {
  const d = toDate(value);
  if (!d) return "—";
  return formatter({ day: "numeric", month: "long", year: "numeric" }, locale).format(d);
}

/** "03/08/2026" — for dense tables where the long form does not fit. */
export function formatDateShort(value: DateInput, locale: string = DISPLAY_LOCALE): string {
  const d = toDate(value);
  if (!d) return "—";
  return formatter({ day: "2-digit", month: "2-digit", year: "numeric" }, locale).format(d);
}

/** "14:30" — 24h, which is what a kitchen and a receipt both want. */
export function formatTime(value: DateInput, locale: string = DISPLAY_LOCALE): string {
  const d = toDate(value);
  if (!d) return "—";
  return formatter({ hour: "2-digit", minute: "2-digit", hour12: false }, locale).format(d);
}

/** "3 août 2026 à 14:30" */
export function formatDateTime(value: DateInput, locale: string = DISPLAY_LOCALE): string {
  const d = toDate(value);
  if (!d) return "—";
  return formatter(
    {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
    locale,
  ).format(d);
}

/** "lun. 3 août" — reservation day headers. */
export function formatDayLabel(value: DateInput, locale: string = DISPLAY_LOCALE): string {
  const d = toDate(value);
  if (!d) return "—";
  return formatter({ weekday: "short", day: "numeric", month: "short" }, locale).format(d);
}

/** "lundi" — a full weekday name, for reports and opening hours. */
export function weekdayName(weekday: number, locale: string = DISPLAY_LOCALE): string {
  // 2024-01-07 was a Sunday, so index 0..6 maps straight onto JS getDay().
  // A fixed reference date keeps this pure — no clock is read.
  const d = new Date(Date.UTC(2024, 0, 7 + (((weekday % 7) + 7) % 7), 12));
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(d);
}

const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let f = relativeCache.get(locale);
  if (!f) {
    f = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeCache.set(locale, f);
  }
  return f;
}

/**
 * "il y a 5 minutes". Used on order lists and the audit log.
 *
 * `now` is a parameter rather than an implicit `Date.now()` so a server render
 * and the client hydration can be handed the same instant — otherwise React
 * warns about mismatched text on every row.
 */
export function formatRelative(
  value: DateInput,
  now: DateInput = new Date(),
  locale: string = DISPLAY_LOCALE,
): string {
  const d = toDate(value);
  const base = toDate(now);
  if (!d || !base) return "—";

  const relative = relativeFormatter(locale);
  const seconds = Math.round((d.getTime() - base.getTime()) / 1000);
  const abs = Math.abs(seconds);

  if (abs < 45) return relative.format(Math.round(seconds), "second");
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 2592000) return relative.format(Math.round(seconds / 86400), "day");
  if (abs < 31536000) return relative.format(Math.round(seconds / 2592000), "month");
  return relative.format(Math.round(seconds / 31536000), "year");
}

/**
 * "12 min" — elapsed time since an order was placed.
 *
 * The kitchen display's single most important number: it is how a chef knows
 * which ticket is about to go late. Deliberately terse and unpunctuated so it
 * is legible from across a room.
 */
export function formatElapsed(since: DateInput, now: DateInput = new Date()): string {
  const start = toDate(since);
  const base = toDate(now);
  if (!start || !base) return "—";

  const minutes = Math.max(0, Math.floor((base.getTime() - start.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest.toString().padStart(2, "0")}`;
}

/** Minutes elapsed, for deciding when a kitchen ticket turns amber then red. */
export function minutesSince(since: DateInput, now: DateInput = new Date()): number {
  const start = toDate(since);
  const base = toDate(now);
  if (!start || !base) return 0;
  return Math.max(0, Math.floor((base.getTime() - start.getTime()) / 60000));
}

/** Whole days between two instants. Drives "days remaining" on billing. */
export function daysBetween(from: DateInput, to: DateInput): number {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return 0;
  return Math.ceil((b.getTime() - a.getTime()) / 86_400_000);
}

/** `<time dateTime>` attribute value — machine-readable, always UTC ISO. */
export function isoAttr(value: DateInput): string | undefined {
  return toDate(value)?.toISOString();
}
