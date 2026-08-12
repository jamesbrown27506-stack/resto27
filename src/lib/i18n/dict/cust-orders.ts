import { defineDict } from "../define";

/**
 * Order history and order tracking (/orders, /orders/[id]).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `cor.` so two modules can never collide.
 */
export const custOrdersDict = defineDict({
  fr: {
    "cor.title": "Mes commandes",
    "cor.subtitle": "Suivez vos commandes en cours et retrouvez les anciennes.",
  },
  en: {
    "cor.title": "My orders",
    "cor.subtitle": "Track orders in progress and find your past ones.",
  },
});
