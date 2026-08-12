import { defineDict } from "../define";

/**
 * The customer dashboard (/account).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `cac.` so two modules can never collide.
 */
export const custAccountDict = defineDict({
  fr: {
    "cac.title": "Tableau de bord",
    "cac.subtitle": "Vos commandes, vos réservations et vos points.",
  },
  en: {
    "cac.title": "Dashboard",
    "cac.subtitle": "Your orders, your bookings and your points.",
  },
});
