/**
 * Branch coverage — which branches a plan runs and what it bills (0072).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE RULE, IN ONE PLACE.
 *
 *  A branch has no subscription of its own: it runs on its main
 *  restaurant's. `included_branches` counts LOCATIONS, the main included —
 *  Enterprise = 3 is the main + 2 branches for one price. Each branch beyond
 *  that costs `extra_branch_price` a month on the main's invoice, and a plan
 *  whose price is NULL cannot run extras at all (Starter: no branches).
 *
 *  Every number the back office shows, every invoice amount and every
 *  pause/resume decision comes out of these functions, so the screen, the
 *  bill and the sync cannot disagree about who is covered.
 *
 *  Plain module — no server imports — so the rules are unit tested
 *  (coverage.test.ts) and the client can show the same arithmetic.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface BranchPlanTerms {
  monthlyPrice: number;
  /** Locations the plan includes, the main restaurant counted. */
  includedBranches: number;
  /** Monthly price of each branch beyond the included ones; null = not sold. */
  extraBranchPrice: number | null;
}

const DAY_MS = 86_400_000;

/** One plan month — the same period activateFromInvoice grants. */
export const BRANCH_PERIOD_DAYS = 30;

/** Branches (besides the main) the plan includes at no extra cost. */
export function includedBranchSlots(plan: Pick<BranchPlanTerms, "includedBranches">): number {
  return Math.max(0, Math.floor(plan.includedBranches) - 1);
}

/** Can a restaurant on this plan run any branch at all? */
export function planAllowsBranches(plan: Pick<BranchPlanTerms, "includedBranches" | "extraBranchPrice">): boolean {
  return includedBranchSlots(plan) > 0 || plan.extraBranchPrice !== null;
}

/**
 * How many branches may run right now.
 *
 * Zero when the main restaurant itself is not running (suspended, pending)
 * or its subscription has lapsed past grace: branches exist only while the
 * plan behind them is live. Grace still counts as live — the main keeps full
 * access during it, and so do its branches.
 */
export function coveredBranchCount(input: {
  plan: Pick<BranchPlanTerms, "includedBranches" | "extraBranchPrice">;
  mainStatus: string;
  /** subscription_state.state of the MAIN restaurant. */
  mainState: string;
  /** subscriptions.extra_branches — extras paid for the current period. */
  paidExtraBranches: number;
}): number {
  if (input.mainStatus !== "active") return 0;
  if (input.mainState !== "active" && input.mainState !== "grace") return 0;
  const extra = input.plan.extraBranchPrice === null ? 0 : Math.max(0, Math.floor(input.paidExtraBranches));
  return includedBranchSlots(input.plan) + extra;
}

/**
 * Extra branches a month of this plan bills, for `openBranches` open ones.
 *
 * A plan that sells no extras bills none — the branches beyond its
 * allowance are paused, not charged.
 */
export function billableExtraBranches(
  plan: Pick<BranchPlanTerms, "includedBranches" | "extraBranchPrice">,
  openBranches: number,
): number {
  if (plan.extraBranchPrice === null) return 0;
  return Math.max(0, Math.floor(openBranches) - includedBranchSlots(plan));
}

export interface PlanInvoiceQuote {
  /** Extra branches billed this month. */
  extraBranches: number;
  /** The part of `amount` paying for them. */
  branchAmount: number;
  amount: number;
}

/** One month of the plan, branches included. */
export function planInvoiceQuote(plan: BranchPlanTerms, openBranches: number): PlanInvoiceQuote {
  const extraBranches = billableExtraBranches(plan, openBranches);
  const branchAmount = extraBranches * Math.max(0, plan.extraBranchPrice ?? 0);
  return { extraBranches, branchAmount, amount: Math.max(0, plan.monthlyPrice) + branchAmount };
}

/**
 * What `branches` more extras cost from now to the end of the paid period.
 *
 * Charged by the day, rounded UP to the franc (whole XAF, never a fraction a
 * Mobile Money request cannot carry). No end date means a full month. An end
 * date already behind us (grace) has nothing left to prorate: those branches
 * are billed on the renewal instead, which is due anyway.
 */
export function proratedBranchCharge(input: {
  unitPrice: number;
  branches: number;
  now: Date;
  periodEnd: string | null;
}): { amount: number; days: number } {
  const branches = Math.max(0, Math.floor(input.branches));
  if (branches === 0 || input.unitPrice <= 0) return { amount: 0, days: 0 };

  let days = BRANCH_PERIOD_DAYS;
  if (input.periodEnd) {
    const end = Date.parse(input.periodEnd);
    if (Number.isFinite(end)) days = Math.ceil((end - input.now.getTime()) / DAY_MS);
  }
  if (days <= 0) return { amount: 0, days: 0 };

  return {
    amount: Math.ceil((input.unitPrice * branches * days) / BRANCH_PERIOD_DAYS),
    days,
  };
}

export type NextBranchCost =
  /** Fits the included branches, or an extra already paid for. */
  | { kind: "covered" }
  /** One more extra: `monthly` from the next renewal, `dueNow` for the days left. */
  | { kind: "extra"; monthly: number; dueNow: number; days: number }
  /** The plan cannot run another branch. */
  | { kind: "unavailable" };

/**
 * What opening one more branch costs — shown BEFORE the owner commits, from
 * the same arithmetic the invoice will use.
 *
 * Free mode bills nothing now; the branch still joins the next renewal like
 * any other once the platform charges again.
 */
export function nextBranchCost(input: {
  plan: BranchPlanTerms;
  openBranches: number;
  paidExtraBranches: number;
  periodEnd: string | null;
  now: Date;
  freeMode: boolean;
}): NextBranchCost {
  const { plan } = input;
  const paid = plan.extraBranchPrice === null ? 0 : Math.max(0, Math.floor(input.paidExtraBranches));
  const after = Math.max(0, Math.floor(input.openBranches)) + 1;

  if (after <= includedBranchSlots(plan) + paid) return { kind: "covered" };
  if (plan.extraBranchPrice === null) return { kind: "unavailable" };

  const monthly = Math.max(0, plan.extraBranchPrice);
  if (input.freeMode) return { kind: "extra", monthly, dueNow: 0, days: 0 };

  const toPay = billableExtraBranches(plan, after) - paid;
  const charge = proratedBranchCharge({ unitPrice: monthly, branches: toPay, now: input.now, periodEnd: input.periodEnd });
  return { kind: "extra", monthly, dueNow: charge.amount, days: charge.days };
}

export type BranchRunState = "active" | "paused";

export interface BranchCoverageRow {
  id: string;
  /** restaurants.status. Only 'active' and 'paused' are ours to change. */
  status: string;
  /** The owner closed it; it stays paused and is not billed. */
  closedAt: string | null;
  createdAt: string;
}

/** Branches that count towards the allowance and the bill. */
export function openBranches<T extends BranchCoverageRow>(rows: T[]): T[] {
  return rows.filter((row) => !row.closedAt && (row.status === "active" || row.status === "paused"));
}

/**
 * Who runs and who is paused, given `covered` slots.
 *
 * The OLDEST open branches keep running and the newest pause first: a
 * downgrade must not take down the location that has served customers for a
 * year to keep the one opened last week. The owner decides otherwise by
 * closing a branch, which frees its slot for the next one.
 *
 * Suspended and pending rows are the admin's, never touched. Returns only
 * the rows whose status must change.
 */
export function branchStatusChanges(rows: BranchCoverageRow[], covered: number): Map<string, BranchRunState> {
  const changes = new Map<string, BranchRunState>();
  const ours = rows
    .filter((row) => row.status === "active" || row.status === "paused")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  let slots = Math.max(0, Math.floor(covered));
  for (const row of ours) {
    let next: BranchRunState = "paused";
    if (!row.closedAt && slots > 0) {
      next = "active";
      slots -= 1;
    }
    if (next !== row.status) changes.set(row.id, next);
  }
  return changes;
}
