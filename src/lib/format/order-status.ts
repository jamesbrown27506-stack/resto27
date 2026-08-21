/**
 * The order state machine, as the UI sees it.
 *
 *   pending → [awaiting_customer] → confirmed → preparing → shipped → delivered
 *      ↓              ↓                 ↓           ↓          ↓
 *                  cancelled (from any non-terminal state)
 *
 * `delivered` and `cancelled` are terminal. Nothing may skip a state or move
 * backwards (§4) — the server enforces that, but the UI must not offer a
 * control that the server will refuse, so `nextStatus()` is the single source
 * for what button to show.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  `awaiting_customer` — THE DELIVERY FEE THE CUSTOMER NEVER AGREED TO.
 *
 *  A delivery order is placed before anyone knows what delivering it costs;
 *  the restaurant quotes the fee when it reads the order. That quote used to
 *  be applied unilaterally — the total rose, the order went straight to
 *  `confirmed`, and the customer found out from a notification afterwards.
 *
 *  Which is bad twice over. The customer is charged something they never
 *  accepted, with no remedy but cancelling. And `confirmed` is the signal to
 *  START COOKING — so the kitchen commits food to an order the customer may be
 *  about to refuse over its price. Every disputed fee was a wasted dish.
 *
 *  The order now stops at `awaiting_customer` while they decide. Accepting
 *  moves it to `confirmed`, so the kitchen still starts on exactly the same
 *  signal, and now only ever for an order somebody agreed to pay for.
 *
 *  It is IN the flow, not beside it: the customer's timeline is the honest
 *  place to show that a step is waiting on them.
 *
 *  A fee of zero skips it. "We deliver free" changes nothing the customer
 *  agreed to, so there is nothing to accept.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This same map renders on /orders/[id], /m/orders, /m/kitchen, /a and every
 * receipt. Defining it once is what stops those five screens drifting apart.
 */

export const ORDER_STATUSES = [
  "pending",
  "awaiting_customer",
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
  "awaiting_customer",
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
  awaiting_customer: {
    label: "Frais de livraison à valider",
    description: "Le restaurant a chiffré la livraison. Acceptez ou refusez pour continuer.",
    badge: "bg-warning-light text-warning border border-warning/25",
    dot: "bg-warning",
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

/**
 * The one forward transition the RESTAURANT can make, or null.
 *
 * `awaiting_customer` returns null on purpose: the only way out of it is the
 * customer accepting or declining the fee. A restaurant that could advance
 * past it would be agreeing to a price on the customer's behalf, which is the
 * whole thing the state exists to prevent — and `advanceOrder` refuses it
 * server-side for the same reason.
 *
 * `pending` still answers `awaiting_customer` here, but the caller decides:
 * `advanceOrder` sends a delivery order with a fee above zero into it, and
 * everything else straight to `confirmed`.
 */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  if (status === "awaiting_customer") return null;
  const i = ORDER_FLOW.indexOf(status);
  if (i === -1 || i === ORDER_FLOW.length - 1) return null;
  if (status === "pending") return "confirmed";
  return ORDER_FLOW[i + 1];
}

/**
 * Label for the button that advances an order. Used by manager + kitchen.
 *
 * Null at `awaiting_customer` because nextStatus is: the restaurant has no
 * move there, and offering one would be it accepting a price for the customer.
 */
export function advanceLabel(status: OrderStatus): string | null {
  const next = nextStatus(status);
  if (!next) return null;
  const labels: Partial<Record<OrderStatus, string>> = {
    confirmed: "Confirmer",
    preparing: "Commencer",
    shipped: "Envoyer",
    delivered: "Marquer livrée",
  };
  return labels[next] ?? null;
}

/** A customer may cancel only before the kitchen has committed to the food. */
export function canCustomerCancel(status: OrderStatus): boolean {
  // `awaiting_customer` has its own Decline, which cancels with the reason
  // "the delivery fee" already filled in — but plain cancel stays available so
  // the ordinary control never disappears mid-flow.
  return status === "pending" || status === "awaiting_customer" || status === "confirmed";
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
