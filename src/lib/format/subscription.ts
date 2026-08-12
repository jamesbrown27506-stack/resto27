/**
 * Subscription state, as the UI sees it (§5).
 *
 *   now ≤ end_date                    → active
 *   end_date < now ≤ end_date + grace → grace  (full access, renewal banner)
 *   now > end_date + grace            → locked (limits drop to Starter)
 *
 * Three rules this file exists to honour, all of which are easy to lose:
 *
 *  1. `endDate = null` means NEVER EXPIRES, not "expired in 1970".
 *  2. An unparseable date must FAIL OPEN. A malformed date is our bug;
 *     locking a paying tenant out over it is unacceptable.
 *  3. The billing page stays reachable while locked — locking someone out of
 *     the only screen that can unlock them guarantees they never pay.
 *
 * The server is authoritative. This is the client-side mirror used to decide
 * what chrome to render; it must agree with `lib/billing/subscription` exactly.
 */

export type SubscriptionState = "active" | "grace" | "locked" | "free_mode";

export const DEFAULT_GRACE_DAYS = 3;

export interface SubscriptionInput {
  /** ISO string, or null for a plan that never expires. */
  endDate: string | null;
  graceDays?: number;
  /** Platform-wide free mode. Grants PAID-tier limits, not Starter (§5). */
  freeMode?: boolean;
  now?: Date;
}

export function resolveSubscriptionState(input: SubscriptionInput): SubscriptionState {
  const { endDate, graceDays = DEFAULT_GRACE_DAYS, freeMode = false, now = new Date() } = input;

  if (freeMode) return "free_mode";

  // Rule 1 — no end date means it never expires.
  if (endDate === null || endDate === undefined || endDate === "") return "active";

  const end = new Date(endDate);

  // Rule 2 — fail OPEN on garbage. Never lock a tenant out over our bug.
  if (Number.isNaN(end.getTime())) return "active";

  if (now.getTime() <= end.getTime()) return "active";

  const graceEnd = end.getTime() + graceDays * 86_400_000;
  return now.getTime() <= graceEnd ? "grace" : "locked";
}

interface StateMeta {
  label: string;
  /** Banner tone. `null` means render no banner at all. */
  tone: "info" | "warning" | "error" | null;
  /** Can the user dismiss the banner for this session? */
  dismissible: boolean;
  badge: string;
}

export const SUBSCRIPTION_STATE_META: Record<SubscriptionState, StateMeta> = {
  active: {
    label: "Actif",
    tone: null,
    dismissible: true,
    badge: "bg-success-light text-success border border-success/25",
  },
  grace: {
    label: "Période de grâce",
    tone: "warning",
    dismissible: true,
    badge: "bg-warning-light text-warning border border-warning/25",
  },
  locked: {
    label: "Verrouillé",
    // Undismissable by design: this is the state the tenant must act on.
    tone: "error",
    dismissible: false,
    badge: "bg-error-light text-error border border-error/25",
  },
  free_mode: {
    label: "Gratuit",
    tone: "info",
    dismissible: true,
    badge: "bg-info-light text-info border border-info/25",
  },
};

/**
 * Rule 3. The only route a locked tenant may still reach.
 *
 * Kept as a prefix test rather than an exact match so the invoice and payment
 * sub-pages stay reachable too — a tenant who can open the billing page but
 * not the pay page is still trapped.
 */
export function isAllowedWhileLocked(pathname: string): boolean {
  return pathname.startsWith("/m/billing");
}

/* ── Plans ─────────────────────────────────────────────────────────────── */

export type PlanTier = "starter" | "professional" | "enterprise";

export interface PlanLimits {
  menuItems: number | null; // null = unlimited
  tables: number | null;
  activePromotions: number | null;
  staffManagement: boolean;
  analytics: boolean;
  commissionRate: number;
}

/**
 * Fixture defaults only. In production these are READ FROM THE PLAN ROW
 * (§14.5 /a/plans) — the PHP app hardcoded them, and the whole point of the
 * plan builder is that the advertised limits on /pricing and the enforced
 * limits here are the same numbers.
 */
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  starter: {
    menuItems: 20,
    tables: 5,
    activePromotions: 1,
    staffManagement: false,
    analytics: false,
    commissionRate: 5,
  },
  professional: {
    menuItems: 100,
    tables: 25,
    activePromotions: 10,
    staffManagement: true,
    analytics: true,
    commissionRate: 3,
  },
  enterprise: {
    menuItems: null,
    tables: null,
    activePromotions: null,
    staffManagement: true,
    analytics: true,
    commissionRate: 2,
  },
};

export const PLAN_LABEL: Record<PlanTier, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

/**
 * "∞" for unlimited, so the UI never prints "null" or a magic 999999.
 *
 * Takes the locale like every formatter in lib/format: French groups with a
 * narrow space (10 000) and English with a comma (10,000), and a plan limit
 * rendered the French way inside an English page is the same leak the date
 * helpers had.
 */
export function formatLimit(limit: number | null, locale = "fr-CM"): string {
  return limit === null ? "∞" : limit.toLocaleString(locale);
}

/** 0–1 for a usage meter. Unlimited always reads as empty, never full. */
export function usageRatio(used: number, limit: number | null): number {
  if (limit === null || limit === 0) return 0;
  return Math.min(1, used / limit);
}
