import { defineDict } from "../define";

/**
 * The order action cluster (advance / quote the fee / cancel), shared by the
 * manager queue and the order detail screen.
 *
 * Only the strings the SHARED COMPONENT owns live here. The queue's own copy
 * (`mo.*`) and the fee dialog's (`fee.*`) stay where they are — this module is
 * for what the two screens say IDENTICALLY because they run the same code.
 *
 * Prefix every key with `oact.`.
 */
export const orderActionsDict = defineDict({
  fr: {
    "oact.sentToCustomer": "Frais envoyés. La commande attend l'accord du client.",
    "oact.requestPickupConfirmation": "Demander confirmation au client",
    "oact.pickupConfirmationSent": "Demande envoyée au client.",
    "oact.pickupConfirmationPending": "La commande reste ouverte jusqu'à la confirmation du client.",
  },
  en: {
    "oact.sentToCustomer": "Fee sent. The order is waiting for the customer to accept.",
    "oact.requestPickupConfirmation": "Ask customer to confirm pickup",
    "oact.pickupConfirmationSent": "Confirmation request sent to the customer.",
    "oact.pickupConfirmationPending": "This order stays open until the customer confirms collection.",
  },
});
