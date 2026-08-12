/**
 * The order state machine, as the UI sees it.
 *
 *   pending → confirmed → preparing → shipped → delivered
 *      ↓          ↓           ↓          ↓
 *           cancelled (from any non-terminal state)
 *
 * `delivered` and `cancelled` are terminal. Nothing may skip a state or move
 * backwards (§4) — the server enforces that, but the UI must not offer a
 * control that the server will refuse, so `nextStatus()` is the single source
 * for what button to show.
 *
 * This same map renders on /orders/[id], /m/orders, /m/kitchen, /a and every
 * receipt. Defining it once is what stops those five screens drifting apart.
 */

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The happy path, in order. Drives the customer's status timeline. */
export const ORDER_FLOW: OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "shipped",
  "delivered",
];

export const TERMINAL_STATUSES: OrderStatus[] = ["delivered", "cancelled"];

interface StatusMeta {
  label: string;
  /** What the customer is waiting on. Shown under the timeline. */
  description: string;
  /** Tailwind classes for a filled badge. */
  badge: string;
  /** Bare colour class for dots, bars and timeline rails. */
  dot: string;
  /** Lucide icon name, resolved by the badge component. */
  icon: "clock" | "check" | "flame" | "truck" | "package-check" | "x";
}

export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  pending: {
    label: "En attente",
    description: "Le restaurant n'a pas encore confirmé votre commande.",
    badge: "bg-surface-2 text-text-secondary border border-border",
    dot: "bg-text-light",
    icon: "clock",
  },
  confirmed: {
    label: "Confirmée",
    description: "Le restaurant a accepté votre commande.",
    badge: "bg-info-light text-info border border-info/25",
    dot: "bg-info",
    icon: "check",
  },
  preparing: {
    label: "En préparation",
    description: "Votre commande est en cuisine.",
    badge: "bg-warning-light text-warning border border-warning/25",
    dot: "bg-warning",
    icon: "flame",
  },
  shipped: {
    label: "En livraison",
    description: "Votre commande est en route.",
    badge: "bg-primary-light text-primary border border-primary/25",
    dot: "bg-primary",
    icon: "truck",
  },
  delivered: {
    label: "Livrée",
    description: "Commande livrée. Bon appétit !",
    badge: "bg-success-light text-success border border-success/25",
    dot: "bg-success",
    icon: "package-check",
  },
  cancelled: {
    label: "Annulée",
    description: "Cette commande a été annulée.",
    badge: "bg-error-light text-error border border-error/25",
    dot: "bg-error",
    icon: "x",
  },
};

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** The one forward transition available, or null at a terminal state. */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  const i = ORDER_FLOW.indexOf(status);
  if (i === -1 || i === ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[i + 1];
}

/** Label for the button that advances an order. Used by manager + kitchen. */
export function advanceLabel(status: OrderStatus): string | null {
  const next = nextStatus(status);
  if (!next) return null;
  return {
    confirmed: "Confirmer",
    preparing: "Commencer",
    shipped: "Envoyer",
    delivered: "Marquer livrée",
  }[next as Exclude<OrderStatus, "pending" | "cancelled">];
}

/** A customer may cancel only before the kitchen has committed to the food. */
export function canCustomerCancel(status: OrderStatus): boolean {
  return status === "pending" || status === "confirmed";
}

/** Zero-based index into ORDER_FLOW; -1 for cancelled. */
export function flowIndex(status: OrderStatus): number {
  return ORDER_FLOW.indexOf(status);
}

/* ── Order type and payment method ─────────────────────────────────────── */

export type OrderType = "delivery" | "pickup" | "dine_in";

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  delivery: "Livraison",
  pickup: "À emporter",
  dine_in: "Sur place",
};

export type PaymentMethod = "cash_on_delivery" | "pay_at_restaurant";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash_on_delivery: "Espèces à la livraison",
  pay_at_restaurant: "Paiement au restaurant",
};
