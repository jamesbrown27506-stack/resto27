import { defineDict } from "../define";

/**
 * Customer bookings (/reservations).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `crs.` so two modules can never collide.
 */
export const custReservationsDict = defineDict({
  fr: {
    "crs.title": "Réservations",
    "crs.subtitle": "Vos tables réservées.",
  },
  en: {
    "crs.title": "Bookings",
    "crs.subtitle": "The tables you have booked.",
  },
});
