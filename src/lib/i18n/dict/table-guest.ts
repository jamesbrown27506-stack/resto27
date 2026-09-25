import { defineDict } from "../define";

/**
 * The QR table page (/table/[token]) — guest-facing only.
 *
 * Prefix `tbg.`. The `tbg.err.*` block is what the guest Server Actions in
 * lib/data/dining-actions return: they used to answer in English whatever
 * language the guest had chosen, so a French-speaking diner who hit a rate
 * limit or a closed session was told so in a language they had not picked.
 * The actions now translate through getTranslator(), and the strings live
 * here with their English twins like every other screen's.
 */
export const tableGuestDict = defineDict({
  fr: {
    "tbg.waitHelp":
      "Un serveur va valider cet appareil, en général en quelques minutes. Pas de nouvelles ? Faites signe au personnel en salle.",
    "tbg.cancelRequest": "Annuler la demande",
    "tbg.cancelled": "Demande annulée. Vous pouvez scanner le QR code à nouveau quand vous voulez.",
    "tbg.basketNote": "Note pour cette commande (facultatif)",
    "tbg.basketNotePh": "Servir ensemble, sans glaçons…",
    "tbg.options": "Options à choisir",

    "tbg.err.tooManyJoin": "Trop de demandes. Demandez de l’aide à un serveur.",
    "tbg.err.settling":
      "Cette table règle son addition. Demandez au personnel de clôturer la visite avant de rescanner.",
    "tbg.err.tableUnavailable": "Cette table ne peut pas accueillir de clients pour le moment.",
    "tbg.err.waitOrder": "Patientez un peu avant d’envoyer une autre commande.",
    "tbg.err.sessionClosed": "Cette visite de table est terminée.",
    "tbg.err.roundFailed": "La commande n’a pas pu être envoyée. Vérifiez les plats et réessayez.",
    "tbg.err.itemUnavailable": "Un plat de votre panier n’est plus disponible. Retirez-le et réessayez.",
    "tbg.err.accessInactive": "Votre accès à la table n’est pas actif.",
    "tbg.err.writeFirst": "Écrivez d’abord un message.",
    "tbg.err.waitRequest": "Patientez un peu avant d’envoyer une autre demande.",
    "tbg.err.messageFailed": "Message non envoyé. Réessayez.",
    "tbg.err.notRequestingPayment": "Cette table n’attend pas de paiement.",
    "tbg.err.badPhone": "Entrez un numéro Mobile Money valide : 9 chiffres commençant par 6.",
    "tbg.err.billNotFound": "Addition introuvable.",
    "tbg.err.otherRequestActive": "Une autre demande Mobile Money est encore active pour cette addition.",
    "tbg.err.paymentActive": "Une demande de paiement est déjà active pour cette addition.",
    "tbg.err.paymentFailed": "Le paiement n’a pas abouti. Réessayez.",
    "tbg.err.paymentNotFound": "Paiement introuvable.",
    "tbg.err.visitInactive": "Votre visite de table n’est plus active.",
    "tbg.err.badSubscription": "Cet appareil ne peut pas recevoir les alertes.",
    "tbg.err.tryLater": "Réessayez un peu plus tard.",
    "tbg.err.alertsFailed": "Impossible d’activer les alertes de table.",
    "tbg.err.itemsPending": "Attendez que le restaurant ait répondu pour chaque plat avant de payer.",
    "tbg.err.preparePayment": "Impossible de préparer le paiement en ligne. Demandez de l’aide à un serveur.",
    "tbg.err.cancelFailed": "La demande n’a pas pu être annulée. Elle a peut-être déjà été traitée.",
  },
  en: {
    "tbg.waitHelp":
      "A waiter will approve this device, usually within a few minutes. Nothing yet? Wave to the staff in the room.",
    "tbg.cancelRequest": "Cancel the request",
    "tbg.cancelled": "Request cancelled. You can scan the QR code again whenever you like.",
    "tbg.basketNote": "Note for this order (optional)",
    "tbg.basketNotePh": "Serve together, no ice…",
    "tbg.options": "Options to choose",

    "tbg.err.tooManyJoin": "Too many requests. Ask a waiter for help.",
    "tbg.err.settling": "This table is settling its bill. Ask staff to close the visit before scanning again.",
    "tbg.err.tableUnavailable": "This table cannot accept guests right now.",
    "tbg.err.waitOrder": "Please wait a moment before sending another order.",
    "tbg.err.sessionClosed": "This table visit is closed.",
    "tbg.err.roundFailed": "The order could not be sent. Check the dishes and try again.",
    "tbg.err.itemUnavailable": "A dish in your basket is no longer available. Remove it and try again.",
    "tbg.err.accessInactive": "Your table access is not active.",
    "tbg.err.writeFirst": "Write a message first.",
    "tbg.err.waitRequest": "Please wait a moment before sending another request.",
    "tbg.err.messageFailed": "Message not sent. Try again.",
    "tbg.err.notRequestingPayment": "This table is not requesting payment.",
    "tbg.err.badPhone": "Enter a valid Mobile Money number: 9 digits starting with 6.",
    "tbg.err.billNotFound": "Bill not found.",
    "tbg.err.otherRequestActive": "Another Mobile Money request is still active for this bill.",
    "tbg.err.paymentActive": "A payment request is already active for this bill.",
    "tbg.err.paymentFailed": "The payment did not go through. Try again.",
    "tbg.err.paymentNotFound": "Payment not found.",
    "tbg.err.visitInactive": "Your table visit is no longer active.",
    "tbg.err.badSubscription": "This device cannot receive alerts.",
    "tbg.err.tryLater": "Please try again a little later.",
    "tbg.err.alertsFailed": "Could not enable table alerts.",
    "tbg.err.itemsPending": "Wait until the restaurant answers every dish before paying.",
    "tbg.err.preparePayment": "Could not prepare online payment. Ask a waiter for help.",
    "tbg.err.cancelFailed": "The request could not be cancelled. It may already have been handled.",
  },
});
