import "server-only";
import { fetchPlanLimits, type PlanEntitlements } from "@/lib/data/billing";
import type { Branch } from "@/lib/branch-types";

/**
 * What the ACTIVE branch's plan allows — for the SERVER ACTIONS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  The menu, promotions and staff pages already showed these ceilings, and
 *  the actions behind them never checked: a Starter restaurant calling
 *  createMenuItem directly (or two tabs, or an old screen) got the 21st
 *  dish anyway. A page that hides a button is not a limit. These checks are.
 *
 *  Same rule as the pages and table-access.ts: a lapsed (locked) plan is
 *  held to Starter, and a branch reads its main's plan (0072). Free mode is
 *  applied inside fetchPlanLimits.
 *
 *  Null when billing cannot be read: an outage must not stop a paying
 *  restaurant from working, so the caller lets the action through — the
 *  same "err towards the tenant" choice fetchPlanLimits documents.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function entitlementsFor(
  branch: Pick<Branch, "planTier" | "subscriptionState">,
): Promise<PlanEntitlements | null> {
  const tier = branch.subscriptionState === "locked" ? "starter" : branch.planTier;
  const limits = await fetchPlanLimits();
  if (limits.size === 0) return null;
  return limits.get(tier) ?? limits.get("starter") ?? null;
}
