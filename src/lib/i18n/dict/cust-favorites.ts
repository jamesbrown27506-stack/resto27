import { defineDict } from "../define";

/**
 * Saved restaurants (/favorites).
 *
 * OWNED BY THIS SCREEN — every string in both languages, or the build fails.
 * Prefix every key with `cfv.` so two modules can never collide.
 */
export const custFavoritesDict = defineDict({
  fr: {
    "cfv.title": "Favoris",
    "cfv.subtitle": "Les restaurants que vous avez enregistrés.",
    "cfv.empty": "Aucun favori",
    "cfv.emptyBody": "Touchez le cœur sur un restaurant pour le retrouver ici.",
    "cfv.discover": "Découvrir des restaurants",
    "cfv.remove": "Retirer {name} des favoris",
  },
  en: {
    "cfv.title": "Favourites",
    "cfv.subtitle": "The restaurants you have saved.",
    "cfv.empty": "No favourites",
    "cfv.emptyBody": "Tap the heart on a restaurant to find it here.",
    "cfv.discover": "Discover restaurants",
    "cfv.remove": "Remove {name} from favourites",
  },
});
