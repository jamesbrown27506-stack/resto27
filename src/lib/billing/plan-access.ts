import type { Branch } from "@/lib/branch-types";

/** On-site order entry requires a paid tier, including during free mode. */
export function onsiteOrdersAllowed(
  branch: Pick<Branch, "planTier" | "subscriptionState">,
): boolean {
  return (
    branch.subscriptionState !== "locked" &&
    (branch.planTier === "professional" || branch.planTier === "enterprise")
  );
}

/** Stable floor selection: retain every record and freeze tables beyond the cap. */
export function applyTablePlanLimit<T extends { id: string; number: string }>(
  tables: T[],
  limit: number | null,
): (T & { planLocked: boolean })[] {
  return [...tables]
    .sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }) || a.id.localeCompare(b.id))
    .map((table, index) => ({ ...table, planLocked: limit !== null && index >= limit }));
}
