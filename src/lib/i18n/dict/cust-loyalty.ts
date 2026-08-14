import { defineDict } from "../define";

/**
 * The loyalty ledger (/loyalty).
 *
 * OWNED BY THIS SCREEN — every string in both languages, or the build fails.
 * Prefix every key with `cly.` so two modules can never collide.
 */
export const custLoyaltyDict = defineDict({
  fr: {
    "cly.title": "Fidélité",
    "cly.subtitle": "Vos points, et d'où vient chacun d'eux.",
    "cly.available": "points disponibles, soit {amount} de réduction sur votre prochaine commande.",
    "cly.orderNow": "Commander maintenant",
    "cly.earned": "Points cumulés",
    "cly.earnedHint": "depuis la création du compte",
    "cly.spent": "Points utilisés",
    "cly.spentHint": "soit {amount} économisés",
    "cly.history": "Historique complet",
    "cly.historyBody": "Chaque ligne est rattachée à la commande qui l'a générée.",
    "cly.empty": "Aucun point pour l'instant",
    "cly.emptyBody": "Chaque commande livrée vous rapporte des points.",
  },
  en: {
    "cly.title": "Loyalty",
    "cly.subtitle": "Your points, and where each one came from.",
    "cly.available": "points available — {amount} off your next order.",
    "cly.orderNow": "Order now",
    "cly.earned": "Points earned",
    "cly.earnedHint": "since the account was created",
    "cly.spent": "Points used",
    "cly.spentHint": "{amount} saved",
    "cly.history": "Full history",
    "cly.historyBody": "Every line is tied to the order that produced it.",
    "cly.empty": "No points yet",
    "cly.emptyBody": "Every delivered order earns you points.",
  },
});
