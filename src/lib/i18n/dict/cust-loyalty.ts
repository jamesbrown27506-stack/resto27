import { defineDict } from "../define";

/**
 * The loyalty programme (/loyalty).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `cly.` so two modules can never collide.
 */
export const custLoyaltyDict = defineDict({
  fr: {
    "cly.title": "Fidélité",
    "cly.subtitle": "Vos points et comment les utiliser.",
  },
  en: {
    "cly.title": "Loyalty",
    "cly.subtitle": "Your points and how to spend them.",
  },
});
