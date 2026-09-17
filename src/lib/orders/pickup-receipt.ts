/**
 * A pickup becomes collected only after the restaurant asks the signed-in
 * customer to confirm the handoff. This durable history note gates both
 * the customer action and the restaurant UI without a schema migration.
 */
export const PICKUP_RECEIPT_CONFIRMATION_NOTE = "Pickup receipt confirmation requested";
