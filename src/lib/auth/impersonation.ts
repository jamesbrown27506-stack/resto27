import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "./session";

/**
 * Impersonation context (§8).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE COOKIE IS A HINT. THE ROLE CHECK IS THE SECURITY.
 *
 *  The cookie holds nothing but a restaurant id, and it is httpOnly so page
 *  scripts cannot read or forge it. But the guarantee does not rest on that:
 *  `getImpersonation()` re-loads the caller's profile on every request and
 *  returns null unless they are a currently-ACTIVE ADMIN.
 *
 *  So a stolen or hand-crafted cookie achieves nothing for a customer, and an
 *  admin who is suspended mid-session stops impersonating on their very next
 *  request rather than at their next login.
 *
 *  Both the start and the end are written to the audit log, and every action
 *  taken while impersonating records the impersonator SEPARATELY from the
 *  actor — otherwise the trail shows the tenant doing things they never did.
 * ─────────────────────────────────────────────────────────────────────────
 */

const COOKIE = "restolink-impersonating";

export interface ImpersonationContext {
  restaurantId: string;
  restaurantName: string;
  branchLabel: string;
  /** The real administrator behind the session. */
  adminName: string;
  adminEmail: string;
}

/**
 * The active impersonation, or null.
 *
 * `cache()` dedupes within a request: the layout, the banner and any guard can
 * all call this and hit the database once.
 */
export const getImpersonation = cache(async (): Promise<ImpersonationContext | null> => {
  const store = await cookies();
  const restaurantId = store.get(COOKIE)?.value;
  if (!restaurantId) return null;

  // Re-verified every request. This is the actual protection.
  //
  // SUPER admins only (migration 0063): acting as a tenant reaches their
  // wallet, withdrawals and staff — every money switch a restaurant has. A
  // super admin demoted mid-session stops impersonating on the next request,
  // exactly like a suspended one.
  const profile = await getCurrentProfile();
  if (
    !profile ||
    profile.role !== "admin" ||
    !profile.isSuperAdmin ||
    profile.status !== "active" ||
    profile.deletedAt
  ) {
    return null;
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("restaurants")
    .select("id, name, branch_label")
    .eq("id", restaurantId)
    .maybeSingle();

  // A deleted or renamed-away restaurant leaves a stale cookie. Treat it as
  // no impersonation rather than showing a banner naming nothing.
  if (!data) return null;

  return {
    restaurantId: data.id,
    restaurantName: data.name,
    branchLabel: data.branch_label,
    adminName: profile.name,
    adminEmail: profile.email,
  };
});

export async function setImpersonationCookie(restaurantId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, restaurantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Deliberately short. Impersonation is for diagnosing one problem, not a
    // mode to sit in — and a forgotten session is one where an admin's actions
    // silently accumulate against a tenant's name.
    maxAge: 60 * 60,
  });
}

export async function clearImpersonationCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
