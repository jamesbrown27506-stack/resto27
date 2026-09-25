import type { Locale } from "./dictionaries";

/**
 * French for the English errors the restaurant-side Server Actions return.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY A LOOKUP AND NOT A DICTIONARY KEY PER ACTION.
 *
 *  The order, dining and menu actions answer in English (the admin-area
 *  convention leaked into them), and those strings went straight into a
 *  toast in front of French-speaking kitchen and cash staff mid-service.
 *  The actions are owned and changed elsewhere, so this module translates
 *  the messages it recognises at the one place they reach a person — the
 *  toast — and passes anything unknown through untouched. A new English
 *  message therefore degrades to "still English", never to a blank toast.
 *
 *  Long-term the actions should return a machine `reason` like the checkout
 *  flow does; until then, keep this list in step with them.
 * ─────────────────────────────────────────────────────────────────────────
 */

const FR: Record<string, string> = {
  // order-actions
  "Order not found.": "Commande introuvable.",
  "This order is already finished.": "Cette commande est déjà terminée.",
  "Collect or request payment before closing this table.":
    "Encaissez ou demandez le paiement avant de clôturer cette table.",
  "Ask the customer to confirm collection instead of closing this pickup directly.":
    "Demandez au client de confirmer le retrait au lieu de clôturer cette commande vous-même.",
  "Quote the delivery fee before confirming.": "Indiquez les frais de livraison avant d'accepter.",
  "Could not update the order.": "Impossible de mettre à jour la commande.",
  "Only pickup orders need collection confirmation.":
    "Seules les commandes à emporter demandent une confirmation de retrait.",
  "Mark the pickup ready before asking the customer to confirm collection.":
    "Marquez la commande prête avant de demander la confirmation du retrait.",
  "This pickup was placed without a customer account, so Resto237 cannot request an in-app confirmation.":
    "Cette commande a été passée sans compte client : Resto237 ne peut pas demander de confirmation dans l'application.",
  "Give a reason — the customer reads it.": "Indiquez un motif — le client le lit.",
  "Could not cancel the order.": "Impossible d'annuler la commande.",
  "The customer is paying right now. Wait a few minutes before cancelling.":
    "Le client est en train de payer. Attendez quelques minutes avant d'annuler.",
  "This order is paid online, so the customer must be refunded. Contact Resto237 support to cancel it.":
    "Cette commande est payée en ligne : le client doit être remboursé. Contactez le support Resto237 pour l'annuler.",
  "The ticket is empty.": "Le ticket est vide.",
  "No such table at this branch.": "Cette table n'existe pas dans cette succursale.",
  "That table is out of service.": "Cette table est hors service.",
  "A dish on the ticket no longer exists.": "Un plat du ticket n'existe plus.",
  "Invalid quantity.": "Quantité invalide.",
  "Invalid price.": "Prix invalide.",
  "Could not create the order.": "Impossible de créer la commande.",
  "Could not save the ticket lines.": "Impossible d'enregistrer les lignes du ticket.",
  // dining-actions
  "Table session not found.": "Session de table introuvable.",
  "Confirm the whole-table receipt first.": "Confirmez d'abord l'encaissement de toute la table.",
  "The bill changed or payment is in progress. Refresh and review it again.":
    "L'addition a changé ou un paiement est en cours. Actualisez et vérifiez-la à nouveau.",
  "There is no bill to collect.": "Il n'y a pas d'addition à encaisser.",
  "The bill could not be moved to payment. Refresh and try again.":
    "Impossible de passer l'addition en paiement. Actualisez et réessayez.",
  "Give the customer a reason (5–240 characters).": "Donnez un motif au client (5 à 240 caractères).",
  "Dish request not found.": "Demande de plat introuvable.",
  "Select between 1 and 50 different dishes.": "Sélectionnez entre 1 et 50 plats.",
  "Choose an approved guest.": "Choisissez un client accepté.",
  "Write a message first.": "Écrivez d'abord un message.",
  "Message not sent.": "Message non envoyé.",
  "Could not save your table alert preference.": "Impossible d'enregistrer votre préférence d'alerte.",
  "The 25,000 FCFA package is required.": "La formule à 25 000 FCFA est requise.",
  // manager-actions (service-time ones)
  "Could not change availability.": "Impossible de changer la disponibilité.",
  "Could not update the table.": "Impossible de mettre à jour la table.",
  "Could not update the reservation.": "Impossible de mettre à jour la réservation.",
  "Could not change the service state.": "Impossible de changer l'état du service.",
};

/** Patterns for the messages that carry a number or a dish name. */
const FR_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    /^Your advertised maximum is (.+) FCFA\. Quote that amount or less\.$/,
    (m) => `Votre maximum annoncé est de ${m[1]} FCFA. Indiquez ce montant ou moins.`,
  ],
  [/^Party size must be between 1 and (\d+)\.$/, (m) => `Le nombre de couverts doit être entre 1 et ${m[1]}.`],
  [/^"(.+)" is sold out\.$/, (m) => `« ${m[1]} » est épuisé.`],
  [/^Only (\d+) of "(.+)" left in stock\.$/, (m) => `Plus que ${m[1]} « ${m[2]} » en stock.`],
  [
    /^(\d+) dish\(es\) could not be updated\. Refresh and review them\.$/,
    (m) => `${m[1]} plat(s) n'ont pas pu être mis à jour. Actualisez et vérifiez-les.`,
  ],
];

/** The message in the reader's language when we know it; otherwise as sent. */
export function localizeActionError(message: string | null | undefined, locale: Locale, fallback = ""): string {
  const text = (message ?? "").trim();
  if (!text) return fallback;
  if (locale !== "fr") return text;
  const exact = FR[text];
  if (exact) return exact;
  for (const [pattern, render] of FR_PATTERNS) {
    const match = text.match(pattern);
    if (match) return render(match);
  }
  return text;
}
