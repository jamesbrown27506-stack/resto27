import { defineDict } from "../define";

/**
 * The restaurant directory and a restaurant's public page.
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `cbr.` so two modules can never collide.
 */
export const custBrowseDict = defineDict({
  fr: {
    "cbr.title": "Restaurants",
    "cbr.subtitle": "Trouvez où commander près de chez vous.",
  },
  en: {
    "cbr.title": "Restaurants",
    "cbr.subtitle": "Find somewhere to order from near you.",
  },
});
