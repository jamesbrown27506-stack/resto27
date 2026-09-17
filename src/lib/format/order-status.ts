import type { TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * The order state machine, as the UI sees it.
 *
 *   pending → awaiting_customer → confirmed → preparing → shipped → delivered
 *      ↓              ↓                 ↓           ↓          ↓
 *                  cancelled (from any non-terminal state)
 *
 * `delivered` and `cancelled` are terminal. Nothing may skip a state or move
 * backwards (§4) — the server enforces that, but the UI must not offer a
 * control that the server will refuse, so `nextStatus()` is the single source
 * for what button to show.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  `awaiting_customer` — ACCEPTED BY THE RESTAURANT, WAITING FOR PAYMENT.
 *
 *  The restaurant reviews every delivery and pickup order before money is
 *  requested. For deliveries it sets the delivery fee at that same point.
 *  The order stops at `awaiting_customer` while the customer pays the final,
 *  accepted total. Settlement moves it to `confirmed`, which is the kitchen's
 *  signal to start preparing the food. This applies to pickups as well.
 *
 * This same map renders on /orders/[id], /m/orders, /m/kitchen, /a and every
 * receipt. Defining it once is what stops those five screens drifting apart.
 */

export const ORDER_TYPES = ["delivery", "pickup", "dine_in"] as const;

export type OrderType = (typeof ORDER_TYPES)[number];

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

export type OrderStatusIcon =
  | "clock"
  | "check"
  | "flame"
  | "truck"
  | "package-check"
  | "x"
  | "shopping-bag"
  | "utensils"
  | "hand-platter";

export interface StatusMeta {
  /**
   * A KEY, never a word. Five screens render this, and only the dictionary
   * follows the language toggle — a literal here stayed French in an English
   * interface, which is exactly how the old map went wrong.
   */
  labelKey: TranslationKey;
  /** What the customer is waiting on. Shown under the timeline. */
  descKey: TranslationKey;
  /** Tailwind classes for a filled badge. */
  badge: string;
  /** Bare colour class for dots, bars and timeline rails. */
  dot: string;
  icon: OrderStatusIcon;
}

/**
 * COLOUR BELONGS TO THE STATE, NOT THE JOURNEY.
 *
 * `preparing` is warning-coloured whether the food is going on a bike or onto
 * a counter, so the palette is keyed on status alone and shared by all three
 * order types. Only the words and the icon fork below.
 */
const STATUS_TONE: Record<OrderStatus, { badge: string; dot: string }> = {
  pending: {
    badge: "bg-surface-2 text-text-secondary border border-border",
    dot: "bg-text-light",
  },
  awaiting_customer: {
    badge: "bg-warning-light text-warning border border-warning/25",
    dot: "bg-warning",
  },
  confirmed: {
    badge: "bg-info-light text-info border border-info/25",
    dot: "bg-info",
  },
  preparing: {
    badge: "bg-warning-light text-warning border border-warning/25",
    dot: "bg-warning",
  },
  shipped: {
    badge: "bg-primary-light text-primary border border-primary/25",
    dot: "bg-primary",
  },
  delivered: {
    badge: "bg-success-light text-success border border-success/25",
    dot: "bg-success",
  },
  cancelled: {
    badge: "bg-error-light text-error border border-error/25",
    dot: "bg-error",
  },
};

/**
 * The words and the icon, per order type — twenty-one entries, written out.
 *
 * A `Record<OrderType, Record<OrderStatus, …>>` rather than a lookup with a
 * fallback, on purpose: a combination nobody thought about is a COMPILE ERROR
 * instead of silently rendering delivery's wording. Where three types genuinely
 * say the same thing the key literal simply repeats, so the sharing is visible
 * rather than hidden behind an `??`.
 *
 * `awaiting_customer` appears under pickup and dine-in to keep the Record
 * total. It is unreachable there — `advanceOrder` only routes a DELIVERY order
 * into that state, because only a delivery order has a fee to accept.
 */
const TYPE_VIEW: Record<
  OrderType,
  Record<OrderStatus, { labelKey: TranslationKey; descKey: TranslationKey; icon: OrderStatusIcon }>
> = {
  delivery: {
    pending: { labelKey: "ost.pending", descKey: "ost.desc.pending", icon: "clock" },
    awaiting_customer: {
      labelKey: "ost.awaiting_customer",
      descKey: "ost.desc.awaiting_customer",
      icon: "clock",
    },
    confirmed: {
      labelKey: "ost.delivery.confirmed",
      descKey: "ost.desc.delivery.confirmed",
      icon: "check",
    },
    preparing: {
      labelKey: "ost.delivery.preparing",
      descKey: "ost.desc.delivery.preparing",
      icon: "flame",
    },
    shipped: {
      labelKey: "ost.delivery.shipped",
      descKey: "ost.desc.delivery.shipped",
      icon: "truck",
    },
    delivered: {
      labelKey: "ost.delivery.delivered",
      descKey: "ost.desc.delivery.delivered",
      icon: "package-check",
    },
    cancelled: { labelKey: "ost.cancelled", descKey: "ost.desc.cancelled", icon: "x" },
  },
  pickup: {
    pending: { labelKey: "ost.pending", descKey: "ost.desc.pending", icon: "clock" },
    awaiting_customer: {
      labelKey: "ost.awaiting_customer",
      descKey: "ost.desc.awaiting_customer",
      icon: "clock",
    },
    confirmed: {
      labelKey: "ost.pickup.confirmed",
      descKey: "ost.desc.pickup.confirmed",
      icon: "check",
    },
    preparing: {
      labelKey: "ost.pickup.preparing",
      descKey: "ost.desc.pickup.preparing",
      icon: "flame",
    },
    shipped: {
      labelKey: "ost.pickup.shipped",
      descKey: "ost.desc.pickup.shipped",
      icon: "shopping-bag",
    },
    delivered: {
      labelKey: "ost.pickup.delivered",
      descKey: "ost.desc.pickup.delivered",
      icon: "package-check",
    },
    cancelled: { labelKey: "ost.cancelled", descKey: "ost.desc.cancelled", icon: "x" },
  },
  dine_in: {
    pending: { labelKey: "ost.pending", descKey: "ost.desc.pending", icon: "clock" },
    awaiting_customer: {
      labelKey: "ost.awaiting_customer",
      descKey: "ost.desc.awaiting_customer",
      icon: "clock",
    },
    confirmed: {
      labelKey: "ost.dine_in.confirmed",
      descKey: "ost.desc.dine_in.confirmed",
      icon: "check",
    },
    preparing: {
      labelKey: "ost.dine_in.preparing",
      descKey: "ost.desc.dine_in.preparing",
      icon: "flame",
    },
    shipped: {
      labelKey: "ost.dine_in.shipped",
      descKey: "ost.desc.dine_in.shipped",
      icon: "hand-platter",
    },
    delivered: {
      labelKey: "ost.dine_in.delivered",
      descKey: "ost.desc.dine_in.delivered",
      icon: "utensils",
    },
    cancelled: { labelKey: "ost.cancelled", descKey: "ost.desc.cancelled", icon: "x" },
  },
};

/** How this status should read and look for this kind of order. */
export function orderStatusMeta(status: OrderStatus, type: OrderType): StatusMeta {
  return { ...TYPE_VIEW[type][status], ...STATUS_TONE[status] };
}

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
  return ORDER_FLOW[i + 1];
}

/**
 * The button that advances an order, keyed by the status it moves INTO.
 *
 * Keyed by target rather than source because that is what the button says:
 * from `preparing`, delivery reads "Envoyer" and pickup reads "Prête à
 * retirer" — the same transition, two different promises to the customer.
 *
 * Null at `awaiting_customer` (nextStatus is null there — the restaurant has
 * no move) and at every terminal state.
 */
const NEXT_LABEL: Record<OrderType, Partial<Record<OrderStatus, TranslationKey>>> = {
  delivery: {
    awaiting_customer: "ost.next.awaiting_customer",
    confirmed: "ost.next.confirmed",
    preparing: "ost.next.preparing",
    shipped: "ost.next.delivery.shipped",
    delivered: "ost.next.delivery.delivered",
  },
  pickup: {
    awaiting_customer: "ost.next.awaiting_customer",
    confirmed: "ost.next.confirmed",
    preparing: "ost.next.preparing",
    shipped: "ost.next.pickup.shipped",
    delivered: "ost.next.pickup.delivered",
  },
  dine_in: {
    awaiting_customer: "ost.next.awaiting_customer",
    confirmed: "ost.next.confirmed",
    preparing: "ost.next.preparing",
    shipped: "ost.next.dine_in.shipped",
    delivered: "ost.next.dine_in.delivered",
  },
};

export function advanceLabelKey(status: OrderStatus, type: OrderType): TranslationKey | null {
  const next = nextStatus(status);
  return next ? (NEXT_LABEL[type][next] ?? null) : null;
}

/** A customer may cancel only before the kitchen has committed to the food. */
export function canCustomerCancel(status: OrderStatus): boolean {
  // `awaiting_customer` has its own Decline, which cancels with the reason
  // "the delivery fee" already filled in — but plain cancel stays available so
  // the ordinary control never disappears mid-flow.
  return status === "pending" || status === "awaiting_customer";
}

/**
 * Is there anything for the RESTAURANT to do to this order?
 *
 * Drives whether the action cluster renders at all, on both the queue and the
 * order detail screen. Two separate reasons to show it, and the second is not
 * an afterthought:
 *
 *   · `canAdvance && !isTerminal` — there is a next step and this person is
 *     allowed to take it. A delivered or cancelled order has nowhere to go,
 *     and a waiter without `orders.advance` gets no buttons rather than
 *     buttons the server will refuse.
 *   · `awaiting_customer`, ALWAYS — even for someone who cannot advance, and
 *     even though there is deliberately no advance button in that state. What
 *     renders there is the notice explaining that the kitchen must not start
 *     until the customer accepts the delivery fee. A missing button with no
 *     explanation is read as a broken screen, and the guess that follows is
 *     "cook it anyway", which is the food waste the state exists to prevent.
 */
export function hasRestaurantActions(status: OrderStatus, canAdvance: boolean): boolean {
  return status === "awaiting_customer" || (canAdvance && !isTerminal(status));
}

/**
 * The steps a customer of THIS kind of order will actually walk.
 *
 * `awaiting_customer` is a delivery-only state — it exists to hold an order
 * while the customer accepts a delivery fee, and a takeaway has no fee to
 * accept. Leaving it in the pickup timeline showed a step that could never
 * happen, and worse, threw the progress bar off by one: `flowIndex` counted
 * it, so a confirmed pickup order painted the delivery-fee step as done.
 */
export function orderFlow(type: OrderType): OrderStatus[] {
  return ORDER_FLOW;
}

/** Zero-based index into this type's flow; -1 for cancelled. */
export function flowIndex(status: OrderStatus, type: OrderType): number {
  return orderFlow(type).indexOf(status);
}

/* ── Order type and payment method ─────────────────────────────────────── */

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  delivery: "Livraison",
  pickup: "À emporter",
  dine_in: "Sur place",
};

export type PaymentMethod = "cash_on_delivery" | "pay_at_restaurant" | "mobile_money" | "wallet";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash_on_delivery: "Espèces à la livraison",
  pay_at_restaurant: "Paiement au restaurant",
  mobile_money: "Mobile Money",
  wallet: "Portefeuille",
};
