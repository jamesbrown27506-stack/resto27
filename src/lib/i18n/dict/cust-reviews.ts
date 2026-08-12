import { defineDict } from "../define";

/**
 * Reviews the customer has written (/reviews).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `crv.` so two modules can never collide.
 */
export const custReviewsDict = defineDict({
  fr: {
    "crv.title": "Mes avis",
    "crv.subtitle": "Ce que vous avez laissé aux restaurants.",
  },
  en: {
    "crv.title": "My reviews",
    "crv.subtitle": "What you have left for restaurants.",
  },
});
