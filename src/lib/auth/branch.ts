import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getImpersonation } from "./impersonation";
import { requireRole, type AuthProfile } from "./session";
import { can, type BranchRole, type Capability } from "@/lib/capabilities";
import type { SubscriptionState } from "@/lib/format/subscription";
import type { Branch } from "@/lib/branch-types";

/**
 * THE SECOND PERMISSION LEVEL (§2).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  `profiles.role = 'manager'` means only "this person works at a
 *  restaurant". It grants nothing on its own. What someone may actually do is
 *  decided by `restaurant_staff.role` AT ONE BRANCH — the same person can be
 *  owner in Akwa and waiter in Bonapriso.
 *
 *  Every manager page must therefore ask two questions, not one:
 *    1. requireRole("manager")     — do they work at a restaurant?  (layout)
 *    2. requireCapability("...")   — may they do THIS, HERE?        (page)
 *
 *  A page that renders is not a page the user may act on. Server Actions
 *  re-check independently, because an Action is a POST endpoint that never
 *  passes through the layout that guards its page.
 * ─────────────────────────────────────────────────────────────────────────
 */

const ACTIVE_BRANCH_COOKIE = "restolink-branch";

export type { Branch } from "@/lib/branch-types";

export interface BranchContext {
  profile: AuthProfile;
  branches: Branch[];
  active: Branch;
  /** True while a platform admin is viewing this tenant (§8). */
  impersonating: boolean;
}

/**
 * Every branch this person may operate, most relevant first.
 *
 * Read with the ADMIN client on purpose. The RLS policies in 0006 would allow
 * this read, but they resolve through `staff_role_at()`, which itself reads
 * restaurant_staff — so serving the roster that decides permissions through
 * the permission check is circular in spirit even where Postgres permits it.
 * The filter below is explicit and auditable in one place.
 */
const loadBranches = cache(async (profileId: string): Promise<Branch[]> => {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("restaurant_staff")
    .select(
      `role,
       restaurants!inner (
         id, name, branch_label, slug, is_primary, status, is_accepting_orders, setup_done_at
       )`,
    )
    .eq("profile_id", profileId)
    .eq("status", "active")
    // A roster membership is not a grant when the tenant itself is suspended.
    // This also keeps a saved branch cookie from selecting a suspended branch
    // when the same person still has access to another active one.
    .eq("restaurants.status", "active");

  if (error) {
    console.error("[branch:loadBranches]", error.message);
    return [];
  }

  type Row = {
    role: string;
    restaurants: {
      id: string;
      name: string;
      branch_label: string;
      slug: string;
      is_primary: boolean;
      status: string;
      is_accepting_orders: boolean;
      setup_done_at: string | null;
    };
  };

  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];

  const states = await fetchSubscriptionStates(rows.map((r) => r.restaurants.id));

  return rows
    .map((row) => {
      const r = row.restaurants;
      const sub = states.get(r.id) ?? NO_SUBSCRIPTION;

      return {
        restaurantId: r.id,
        restaurantName: r.name,
        branchLabel: r.branch_label,
        slug: r.slug,
        isPrimary: r.is_primary,
        status: r.status as Branch["status"],
        isAcceptingOrders: r.is_accepting_orders,
        role: row.role as BranchRole,
        setupDoneAt: r.setup_done_at,
        subscriptionState: sub.state,
        planTier: sub.tier,
        planName: sub.name,
        expiresAt: sub.endDate,
        hasSubscription: sub.exists,
      } satisfies Branch;
    })
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.branchLabel.localeCompare(b.branchLabel));
});

interface SubscriptionSummary {
  state: SubscriptionState;
  tier: string;
  name: string;
  endDate: string | null;
  /** False when the restaurant has never had a subscription row. */
  exists: boolean;
}

/**
 * Subscription state per branch, from the `subscription_state` view (0004).
 *
 * The view — not a date comparison here — because active / grace / locked is a
 * single rule with a grace window, and re-deriving it in TypeScript is how the
 * two drift apart until a tenant is locked out on the app but not in the
 * database (§5).
 *
 * TWO QUERIES, NOT AN EMBED. PostgREST cannot join a plan onto a VIEW: a view
 * carries no foreign-key metadata, so `subscription_plans(...)` silently fails
 * to resolve. Fetching the plans by id afterwards is explicit and works.
 */
async function fetchSubscriptionStates(restaurantIds: string[]) {
  const map = new Map<string, SubscriptionSummary>();
  if (restaurantIds.length === 0) return map;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("subscription_state")
    .select("restaurant_id, plan_id, state, end_date")
    .in("restaurant_id", restaurantIds);

  if (error) {
    // Not fatal. A missing subscription must not make the dashboard
    // unreachable — the tenant would then have no way to go and pay.
    console.error("[branch:fetchSubscriptionStates]", error.message);
    return map;
  }

  const rows = (data ?? []) as { restaurant_id: string; plan_id: string; state: string; end_date: string | null }[];
  const planIds = [...new Set(rows.map((r) => r.plan_id))];

  const plans = new Map<string, { tier: string; name: string }>();
  if (planIds.length > 0) {
    const { data: planRows } = await supabase
      .from("subscription_plans")
      .select("id, tier, name")
      .in("id", planIds);

    for (const p of (planRows ?? []) as { id: string; tier: string; name: string }[]) {
      plans.set(p.id, { tier: p.tier, name: p.name });
    }
  }

  for (const row of rows) {
    const plan = plans.get(row.plan_id);
    map.set(row.restaurant_id, {
      // The view also returns 'cancelled', which the UI has no separate
      // treatment for: a cancelled subscription grants exactly what an expired
      // one grants, which is Starter limits and a banner. Collapsing it here
      // beats widening the union with a state nothing renders differently.
      state: row.state === "cancelled" ? "locked" : (row.state as SubscriptionState),
      tier: plan?.tier ?? "starter",
      name: plan?.name ?? "—",
      endDate: row.end_date,
      exists: true,
    });
  }

  return map;
}

/**
 * What a restaurant with no subscription row gets: FREE STARTER, ACTIVE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS USED TO SAY `locked`, AND THAT WAS A BUG WITH TEETH.
 *
 *  Reasoning went: no plan means Starter limits, and `locked` is the state
 *  that imposes Starter limits. But `locked` also means "your subscription
 *  lapsed" — so a restaurant approved five minutes ago, that has never had a
 *  plan and owes nothing, was met with "Compte verrouillé. Réglez votre
 *  facture." and a dashboard where every link but billing was disabled.
 *
 *  There was no invoice to settle. Starter costs 0 FCFA and never expires.
 *  Missing row and lapsed subscription are different facts and only one of
 *  them is the tenant's fault.
 *
 *  Approval now creates the Starter row, so this is the fallback rather than
 *  the norm — but a missing row must degrade into working software, not into
 *  a lockout nobody can clear.
 * ─────────────────────────────────────────────────────────────────────────
 */
const NO_SUBSCRIPTION: SubscriptionSummary = {
  state: "active",
  tier: "starter",
  name: "Starter",
  endDate: null,
  exists: false,
};

/**
 * The branch context for the current request, or null if there is none.
 *
 * WHILE IMPERSONATING, the admin gets the impersonated restaurant as `owner`.
 * That is the point of impersonation — seeing what the tenant sees — and every
 * action taken is already stamped with the impersonator's email in the audit
 * log, so nothing is lost by granting the view.
 */
export const getBranchContext = cache(async (): Promise<BranchContext | null> => {
  const impersonation = await getImpersonation();

  if (impersonation) {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("restaurants")
      .select("id, name, branch_label, slug, is_primary, status, is_accepting_orders, setup_done_at")
      .eq("id", impersonation.restaurantId)
      .maybeSingle();

    if (!data) return null;

    const states = await fetchSubscriptionStates([data.id]);
    const sub = states.get(data.id) ?? NO_SUBSCRIPTION;
    const admin = await requireRole("admin", "manager");

    const branch: Branch = {
      restaurantId: data.id,
      restaurantName: data.name,
      branchLabel: data.branch_label,
      slug: data.slug,
      isPrimary: data.is_primary,
      status: data.status,
      isAcceptingOrders: data.is_accepting_orders,
      role: "owner",
      setupDoneAt: data.setup_done_at,
      subscriptionState: sub.state,
      planTier: sub.tier,
      planName: sub.name,
      expiresAt: sub.endDate,
      hasSubscription: sub.exists,
    };

    return { profile: admin, branches: [branch], active: branch, impersonating: true };
  }

  const profile = await requireRole("manager", "admin");
  const branches = await loadBranches(profile.id);
  if (branches.length === 0) return null;

  // The cookie is a PREFERENCE, not a grant: the chosen id is only honoured if
  // it appears in the list we just loaded from restaurant_staff. A forged
  // cookie naming someone else's restaurant selects nothing and falls through
  // to the first branch this person genuinely works at.
  const chosen = (await cookies()).get(ACTIVE_BRANCH_COOKIE)?.value;
  const active = branches.find((b) => b.restaurantId === chosen) ?? branches[0]!;

  return { profile, branches, active, impersonating: false };
});

/**
 * The branch context, or a redirect.
 *
 * A manager with no branch is a real state, not a bug: their application was
 * approved as a user but the restaurant row is gone, or an owner removed them
 * from the last branch they worked at mid-session. /m/no-branch explains it
 * instead of rendering an empty dashboard that looks broken.
 */
export async function requireBranch(): Promise<BranchContext> {
  const context = await getBranchContext();
  if (!context) redirect("/m/no-branch");
  return context;
}

/**
 * Guard a page on ONE capability at the ACTIVE branch.
 *
 * 404 rather than 403, for the same reason as requireRole: confirming that
 * /m/billing exists tells a waiter something they did not know a moment ago.
 */
export async function requireCapability(capability: Capability): Promise<BranchContext> {
  const context = await requireBranch();

  if (!can(context.active.role, capability)) {
    redirect("/not-found");
  }

  return context;
}

/**
 * Switch branches.
 *
 * Validated against real membership before the cookie is written, so the
 * cookie can never come to hold a restaurant this person does not work at —
 * belt and braces with the check in getBranchContext.
 */
export async function setActiveBranch(restaurantId: string): Promise<boolean> {
  const profile = await requireRole("manager", "admin");
  const branches = await loadBranches(profile.id);

  if (!branches.some((b) => b.restaurantId === restaurantId)) return false;

  (await cookies()).set(ACTIVE_BRANCH_COOKIE, restaurantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return true;
}
