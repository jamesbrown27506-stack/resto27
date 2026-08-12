import { defineDict } from "../define";

/**
 * Favourite restaurants (/favorites).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `cfv.` so two modules can never collide.
 */
export const custFavoritesDict = defineDict({
  fr: {
    "cfv.title": "Favoris",
    "cfv.subtitle": "Les restaurants que vous gardez sous la main.",
  },
  en: {
    "cfv.title": "Favourites",
    "cfv.subtitle": "The restaurants you keep close at hand.",
  },
});
