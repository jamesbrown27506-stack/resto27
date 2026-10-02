/**
 * The history note a restaurant leaves when it asks a pickup customer to
 * confirm the handoff (the notification nudges them). Since 2026-10 it is a
 * nudge only, not a gate: the customer may confirm any order that is ready
 * (`shipped`) on their own — see confirmOwnDelivery.
 */
export const PICKUP_RECEIPT_CONFIRMATION_NOTE = "Pickup receipt confirmation requested";
