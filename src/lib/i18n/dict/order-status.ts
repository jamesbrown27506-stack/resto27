import { defineDict } from "../define";

/**
 * What an order's state is CALLED, which depends on how it is being handed
 * over.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ONE MACHINE, THREE VOCABULARIES.
 *
 *  The stored statuses are named after the delivery journey — `shipped`,
 *  `delivered` — because delivery was the first thing this platform did. A
 *  takeaway order walks the identical states, so a customer who ordered to
 *  collect was told their food was "out for delivery" and shown a lorry, and
 *  the last step invited them to confirm a delivery that was never coming.
 *
 *  Renaming the stored values would rewrite every `order_status_history` row
 *  and break the trigger migration 0034 hangs off `shipped`. So the storage
 *  stays exactly as it is and only the READING forks: `shipped` means "out
 *  for delivery", "ready for pickup" or "served at your table" depending on
 *  `orders.type`, and nothing about the transitions changes.
 *
 *  Keys are grouped shared / delivery / pickup / dine_in. A key with no type
 *  segment (`ost.pending`) is one all three share and is deliberately
 *  repeated at each call site rather than hidden behind a fallback, so
 *  "these three are the same" is visible instead of assumed.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const orderStatusDict = defineDict({
  fr: {
    /* ── Shared by every order type ──────────────────────────────────── */
    "ost.pending": "En attente",
    "ost.cancelled": "Annulée",
    "ost.awaiting_customer": "Frais de livraison à valider",
    "ost.desc.pending": "Le restaurant n'a pas encore confirmé votre commande.",
    "ost.desc.cancelled": "Cette commande a été annulée.",
    "ost.desc.awaiting_customer":
      "Le restaurant a chiffré la livraison. Acceptez ou refusez pour continuer.",

    /* ── Delivery ────────────────────────────────────────────────────── */
    "ost.delivery.confirmed": "Confirmée",
    "ost.delivery.preparing": "En préparation",
    "ost.delivery.shipped": "En livraison",
    "ost.delivery.delivered": "Livrée",
    "ost.desc.delivery.confirmed": "Le restaurant a accepté votre commande.",
    "ost.desc.delivery.preparing": "Votre commande est en cuisine.",
    "ost.desc.delivery.shipped": "Votre commande est en route.",
    "ost.desc.delivery.delivered": "Commande livrée. Bon appétit !",

    /* ── Pickup ──────────────────────────────────────────────────────── */
    "ost.pickup.confirmed": "Acceptée",
    "ost.pickup.preparing": "En cuisine",
    "ost.pickup.shipped": "Prête à retirer",
    "ost.pickup.delivered": "Récupérée",
    "ost.desc.pickup.confirmed": "Le restaurant a accepté votre commande.",
    "ost.desc.pickup.preparing": "Votre commande est en cuisine.",
    "ost.desc.pickup.shipped": "Votre commande vous attend au comptoir.",
    "ost.desc.pickup.delivered": "Commande récupérée. Bon appétit !",

    /* ── Dine in ─────────────────────────────────────────────────────── */
    "ost.dine_in.confirmed": "Acceptée",
    "ost.dine_in.preparing": "En cuisine",
    "ost.dine_in.shipped": "Servie à table",
    "ost.dine_in.delivered": "Terminée",
    "ost.desc.dine_in.confirmed": "Votre commande est passée en cuisine.",
    "ost.desc.dine_in.preparing": "Votre commande est en cuisine.",
    "ost.desc.dine_in.shipped": "Votre commande a été servie à table.",
    "ost.desc.dine_in.delivered": "Service terminé. Bon appétit !",

    /* ── The button that advances an order, keyed by TARGET status ───── */
    "ost.next.confirmed": "Confirmer",
    "ost.next.preparing": "Commencer",
    "ost.next.delivery.shipped": "Envoyer",
    "ost.next.delivery.delivered": "Marquer livrée",
    "ost.next.pickup.shipped": "Prête à retirer",
    "ost.next.pickup.delivered": "Marquer récupérée",
    "ost.next.dine_in.shipped": "Servir",
    "ost.next.dine_in.delivered": "Clôturer la table",
  },
  en: {
    /* ── Shared by every order type ──────────────────────────────────── */
    "ost.pending": "Pending",
    "ost.cancelled": "Cancelled",
    "ost.awaiting_customer": "Delivery fee to approve",
    "ost.desc.pending": "The restaurant has not confirmed your order yet.",
    "ost.desc.cancelled": "This order was cancelled.",
    "ost.desc.awaiting_customer":
      "The restaurant has quoted the delivery. Accept or decline to continue.",

    /* ── Delivery ────────────────────────────────────────────────────── */
    "ost.delivery.confirmed": "Confirmed",
    "ost.delivery.preparing": "Preparing",
    "ost.delivery.shipped": "Out for delivery",
    "ost.delivery.delivered": "Delivered",
    "ost.desc.delivery.confirmed": "The restaurant accepted your order.",
    "ost.desc.delivery.preparing": "Your order is in the kitchen.",
    "ost.desc.delivery.shipped": "Your order is on its way.",
    "ost.desc.delivery.delivered": "Order delivered. Enjoy!",

    /* ── Pickup ──────────────────────────────────────────────────────── */
    "ost.pickup.confirmed": "Accepted",
    "ost.pickup.preparing": "Cooking",
    "ost.pickup.shipped": "Ready for pickup",
    "ost.pickup.delivered": "Collected",
    "ost.desc.pickup.confirmed": "The restaurant accepted your order.",
    "ost.desc.pickup.preparing": "Your order is in the kitchen.",
    "ost.desc.pickup.shipped": "Your order is waiting for you at the counter.",
    "ost.desc.pickup.delivered": "Order collected. Enjoy!",

    /* ── Dine in ─────────────────────────────────────────────────────── */
    "ost.dine_in.confirmed": "Accepted",
    "ost.dine_in.preparing": "Cooking",
    "ost.dine_in.shipped": "Served",
    "ost.dine_in.delivered": "Closed",
    "ost.desc.dine_in.confirmed": "Your order has gone through to the kitchen.",
    "ost.desc.dine_in.preparing": "Your order is in the kitchen.",
    "ost.desc.dine_in.shipped": "Your order has been served at your table.",
    "ost.desc.dine_in.delivered": "Service complete. Enjoy!",

    /* ── The button that advances an order, keyed by TARGET status ───── */
    "ost.next.confirmed": "Confirm",
    "ost.next.preparing": "Start",
    "ost.next.delivery.shipped": "Send out",
    "ost.next.delivery.delivered": "Mark delivered",
    "ost.next.pickup.shipped": "Mark ready",
    "ost.next.pickup.delivered": "Mark collected",
    "ost.next.dine_in.shipped": "Serve",
    "ost.next.dine_in.delivered": "Close the table",
  },
});
