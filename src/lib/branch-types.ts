import type { BranchRole } from "./capabilities";
import type { SubscriptionState } from "./format/subscription";

/**
 * The branch shape, in a module with NO server dependencies.
 *
 * It lives here rather than in lib/auth/branch.ts because the sidebar and the
 * shell are client components and need the type. `lib/auth/branch` imports
 * "server-only", and a client file importing from it — even `import type` —
 * is one bundler change away from pulling the runtime module into the browser
 * along with the service-role key it uses.
 */
export interface Branch {
  restaurantId: string;
  restaurantName: string;
  branchLabel: string;
  slug: string;
  isPrimary: boolean;
  /**
   * The main restaurant this branch runs under, or null for a main (0072).
   * A branch has no subscription of its own: its plan, limits and billing
   * are the main's.
   */
  parentId: string | null;
  /**
   * 'paused' is a branch the main's plan does not cover (or its owner
   * closed): hidden from customers, back office still open — see 0072.
   */
  status: "active" | "pending" | "suspended" | "paused";
  /** The owner closed this branch on purpose — paused until reopened. */
  closedAt: string | null;
  isAcceptingOrders: boolean;
  /** THIS user's role at THIS branch. Not their account role. */
  role: BranchRole;
  /** Null while the first-login setup wizard has not been finished. */
  setupDoneAt: string | null;
  subscriptionState: SubscriptionState;
  planTier: string;
  planName: string;
  /** Null when the plan never expires, or when there is no subscription yet. */
  expiresAt: string | null;
  /**
   * The last moment of the grace period (end date + grace days). The plan
   * keeps working until then; "Due: <expiresAt>" alone read as a deadline
   * already missed. Null without an end date.
   */
  graceEndsAt?: string | null;
  /** False means "never chose a plan", which reads differently from "expired". */
  hasSubscription: boolean;
}
