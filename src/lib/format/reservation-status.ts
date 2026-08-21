import type { TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * Reservation status, as the customer UI sees it.
 *
 * Kept in `format/` (not `lib/data/`) because it is imported by client
 * components — `lib/data/*` pulls in the service-role Supabase client, which
 * depends on `next/headers` and cannot travel to the browser.
 */

/**
 * `awaiting_payment` sits between "the restaurant said yes" and "the table is
 * yours" (migration 0039).
 *
 * The deposit used to be taken at booking, while the request was still
 * `pending` and nobody at the restaurant had seen it — so a decline meant
 * refunding somebody for a table that never existed. The restaurant decides
 * first; only then is the customer asked to pay, and paying is what turns the
 * booking into `confirmed`.
 */
export const RESERVATION_STATUSES = [
  "pending",
  "awaiting_payment",
  "confirmed",
  "seated",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type CustomerReservationStatus = (typeof RESERVATION_STATUSES)[number];

/**
 * The status word, TRANSLATED.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A Record of French strings cannot be translated, which is why this is now
 *  a function taking `t`. The map stayed French in an English interface on
 *  every screen that showed a reservation — dashboard, list and detail — and
 *  no amount of translating the surrounding page fixed the one word that
 *  actually says what happened to the booking.
 *
 *  `t` is passed in rather than imported so this file works on both sides of
 *  the boundary: client components hand it `useLocale().t`, Server Components
 *  hand it `await getTranslator()`. Same keys either way.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function reservationStatusLabel(
  status: CustomerReservationStatus,
  t: (key: TranslationKey) => string,
): string {
  return t(`crs.status.${status}` as TranslationKey);
}

export const RESERVATION_STATUS_TONE: Record<
  CustomerReservationStatus,
  "neutral" | "success" | "warning" | "error" | "info"
> = {
  pending: "warning",
  // Accent-coloured rather than merely "pending": this is the one state that
  // needs the customer to DO something, and it expires if they do not.
  awaiting_payment: "warning",
  confirmed: "info",
  seated: "info",
  completed: "success",
  cancelled: "neutral",
  no_show: "error",
};
