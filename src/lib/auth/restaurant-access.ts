import type { RejectionReason } from "./session";

export type RestaurantAccessStatus = "active" | "pending" | "suspended" | "paused";

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
 *
 * A PAUSED branch (0072 — its main's plan does not cover it) still lets its
 * team in: they have service to finish and a wallet to withdraw, and the
 * back office tells them why the orders stopped. Signing them out with
 * "invalid" would explain nothing.
 */
export function managerRestaurantRejection(
  statuses: RestaurantAccessStatus[],
): RejectionReason | null {
  if (statuses.length === 0 || statuses.includes("active") || statuses.includes("paused")) return null;
  if (statuses.includes("suspended")) return "suspended";
  if (statuses.includes("pending")) return "pending-manager";
  return "invalid";
}
