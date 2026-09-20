export type DiningSessionStatus = "awaiting_staff" | "open" | "payment_requested" | "closed" | "cancelled";
export type DiningGuestStatus = "pending" | "approved" | "rejected" | "expired";

/** QR ordering is the operational feature reserved for the 25,000 FCFA tier. */
export function diningFeatureAllowed(tier: string, state: string): boolean {
  return tier === "enterprise" && (state === "active" || state === "grace");
}

/** Approval is the physical-presence proof; payment_requested stays interactive. */
export function canGuestUseDiningSession(guest: string, session: string): boolean {
  return guest === "approved" && (session === "open" || session === "payment_requested");
}

/** An Enterprise QR visit must be paid before its order releases the table. */
export function canCloseDiningOrder(hasDiningSession: boolean, paid: boolean): boolean {
  return !hasDiningSession || paid;
}
