import type { RejectionReason } from "./session";

export type RestaurantAccessStatus = "active" | "pending" | "suspended";

/**
 * Decide whether a manager still has a restaurant they are allowed to use.
 *
 * Restaurant suspension is branch-scoped: somebody who works at two branches
 * may keep using an active one when the other is suspended. They are rejected
 * only when memberships exist but none of those restaurants is active.
 *
 * An empty list is deliberately allowed. It is the existing "no branch"
 * state (for example, a staff member removed from their last roster), not
 * evidence that an administrator suspended a restaurant.
 */
export function managerRestaurantRejection(
  statuses: RestaurantAccessStatus[],
): RejectionReason | null {
  if (statuses.length === 0 || statuses.includes("active")) return null;
  if (statuses.includes("suspended")) return "suspended";
  if (statuses.includes("pending")) return "pending-manager";
  return "invalid";
}
