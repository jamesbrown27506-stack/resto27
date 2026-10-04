import { syncStaffRole } from "./staff-access";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { UserRole, UserStatus } from "@/lib/session";
import {
  managerRestaurantRejection,
  type RestaurantAccessStatus,
} from "./restaurant-access";
import {
  effectiveSuperAdmin,
  superAdminColumnMissing,
  SUPER_ADMIN_ONLY_ERROR,
} from "./super-admin-rules";

/**
 * The session layer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE JWT PROVES WHO THEY ARE. IT DOES NOT PROVE THEY ARE STILL ALLOWED IN.
 *
 *  Supabase issues short-lived access tokens. `auth.admin.signOut(userId)`
 *  revokes refresh tokens, but a token already in a browser stays valid until
 *  it expires — up to an hour (explanation.md B.2). Suspending an account
 *  would therefore do nothing for an hour, which is §12 hard rule #6 and the
 *  single most common way this gets ported wrong.
 *
 *  The fix costs nothing, because we load the profile on every authenticated
 *  request anyway: check `status` there and reject. That is exactly what the
 *  old system's `enforce_session_validity()` did — port the behaviour, not the
 *  mechanism.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface AuthProfile {
  /** OUR id, not the provider's. Every foreign key points here. */
  id: string;
  authUserId: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  deletedAt: string | null;
  /**
   * A super administrator (migration 0063): holds the switches that move
   * money or change how the platform works. Always false unless role is
   * "admin". See lib/auth/super-admin-rules.ts for what it unlocks.
   */
  isSuperAdmin: boolean;
}

/** Why a session was rejected — drives the reason shown on /login (§14.2). */
export type RejectionReason =
  | "invalid"
  | "pending"
  | "pending-manager"
  | "suspended"
  /** Signed up, never clicked the confirmation email. */
  | "unconfirmed"
  /** Supabase's sign-in rate limit — nothing to do with this account. */
  | "busy"
  /** Supabase or the database did not answer — nothing was decided. */
  | "unavailable";

/**
 * A manager account can be active while the restaurant it operates is not.
 * Admin suspension changes `restaurants.status`, not `profiles.status`, so
 * account-only validation leaves both fresh logins and existing sessions
 * usable. Resolve the restaurant side of the relationship on every guarded
 * request, just as we resolve the profile side.
 */
export async function getManagerRestaurantRejection(
  profileId: string,
): Promise<RejectionReason | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("restaurant_staff")
    .select("restaurants!inner ( status )")
    .eq("profile_id", profileId)
    .eq("status", "active");

  if (error) {
    // Authorization fails closed. A database error must not turn into tenant
    // access that the application could not prove was still valid — but it
    // is not a wrong password either, and saying so sent people off to
    // reset passwords that were fine.
    console.error("[auth:manager-restaurants]", profileId, error.message);
    return "unavailable";
  }

  const statuses = (data ?? []).flatMap((row) => {
    const joined = (row as unknown as {
      restaurants:
        | { status?: string }
        | { status?: string }[]
        | null;
    }).restaurants;
    const restaurant = Array.isArray(joined) ? joined[0] : joined;
    const status = restaurant?.status;
    return status === "active" || status === "pending" || status === "suspended" || status === "paused"
      ? [status as RestaurantAccessStatus]
      : [];
  });

  return managerRestaurantRejection(statuses);
}

/**
 * The signed-in profile, or null.
 *
 * `cache()` dedupes within a single request: a layout, a page and three
 * components all calling this hit Supabase once, not five times. It does NOT
 * cache across requests, which is what we want — a suspension must take effect
 * on the very next request.
 */
/**
 * The verified Supabase user, or null.
 *
 * Separated from the profile lookup so callers can tell "nobody is signed in"
 * apart from "signed in, but has no profile row" — see `requireUser`, where
 * conflating the two produced a redirect loop.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createClient();

  // getUser(), never getSession(): getSession only decodes the cookie, and a
  // cookie can be forged. In a multi-tenant system the difference between two
  // users is the difference between two restaurants' revenue.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
});

export const getCurrentProfile = cache(async (): Promise<AuthProfile | null> => {
  const user = await getSessionUser();
  if (!user) return null;

  const supabase = await createClient();

  const BASE_COLUMNS = "id, auth_user_id, name, email, phone, avatar_url, role, status, deleted_at";

  /**
   * `is_super_admin` arrives with migration 0063, which production may not
   * have yet. Selecting a missing column fails the WHOLE read — and a failed
   * read here is "no profile", i.e. everybody signed out. So a missing column
   * retries without it, and `effectiveSuperAdmin` treats every admin as super
   * until the SQL runs (which is exactly what the migration then sets).
   */
  let result = await supabase
    .from("profiles")
    .select(`${BASE_COLUMNS}, is_super_admin`)
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (superAdminColumnMissing(result.error)) {
    result = (await supabase
      .from("profiles")
      .select(BASE_COLUMNS)
      .eq("auth_user_id", user.id)
      .maybeSingle()) as typeof result;
  }

  const { data, error } = result;

  if (error || !data) {
    /**
     * A verified session with no profile row is an ORPHAN.
     *
     * It happens when a user was created in `auth.users` before the
     * handle_new_user() trigger existed, or when the trigger failed. Logged
     * loudly because it is not a normal state and it will keep happening for
     * that account until the row is backfilled — see
     * supabase/migrations/0002_backfill_profiles.sql.
     */
    console.error(
      "[auth] Orphan session: auth user has no profiles row.",
      user.id,
      user.email,
      error?.message ?? "no row returned",
    );
    return null;
  }

  const role = (await syncStaffRole(data)) as UserRole;

  return {
    id: data.id,
    authUserId: data.auth_user_id,
    name: data.name,
    email: data.email,
    phone: data.phone,
    avatarUrl: data.avatar_url,
    role,
    status: data.status as UserStatus,
    deletedAt: data.deleted_at,
    isSuperAdmin: effectiveSuperAdmin(
      role,
      (data as { is_super_admin?: boolean | null }).is_super_admin,
    ),
  };
});

/**
 * The profile, but only if they are still allowed in.
 *
 * Returns a rejection reason instead of a profile when the account is no
 * longer usable, so callers can say *why* rather than dumping the user at a
 * generic login screen (§14.2).
 */
export async function getActiveProfile(): Promise<
  { profile: AuthProfile; reason?: never } | { profile?: never; reason: RejectionReason }
> {
  const profile = await getCurrentProfile();
  if (!profile) return { reason: "invalid" };

  if (profile.deletedAt) return { reason: "suspended" };
  if (profile.status === "suspended") return { reason: "suspended" };
  if (profile.status === "pending") {
    // A restaurant awaiting approval is a different situation from a diner
    // whose account is not yet active, and the copy differs accordingly.
    return { reason: profile.role === "manager" ? "pending-manager" : "pending" };
  }

  if (profile.role === "manager") {
    const reason = await getManagerRestaurantRejection(profile.id);
    if (reason) return { reason };
  }

  return { profile };
}

/**
 * Guard for any authenticated page. Redirects with the specific reason, so the
 * login screen can explain rather than just refuse.
 */
export async function requireUser(): Promise<AuthProfile> {
  const result = await getActiveProfile();

  if (result.reason) {
    /**
     * Clear the session whenever one exists but is not usable.
     *
     * This covers suspended and pending accounts, and also the orphan case —
     * a valid token whose profile row is missing. Skipping the sign-out there
     * caused a redirect loop: this guard sent the user to /login, the proxy
     * saw a valid session and sent them straight back to /account, forever.
     *
     * Checking for a session rather than branching on the reason means any
     * future rejection reason is handled correctly by default.
     */
    if (await getSessionUser()) {
      const supabase = await createClient();
      await supabase.auth.signOut();
    }
    redirect(`/login?reason=${result.reason}`);
  }

  return result.profile;
}

/**
 * Guard for an area restricted to one platform role.
 *
 * NOTE: this is the FIRST of the two permission levels (§2). It answers "does
 * this person work at a restaurant / run the platform". It does NOT answer
 * what they may do at a given branch — that is `restaurant_staff.role` and
 * `lib/auth/rbac`, and it must still be checked per page.
 */
export async function requireRole(...roles: UserRole[]): Promise<AuthProfile> {
  const profile = await requireUser();

  if (!roles.includes(profile.role)) {
    // 404 rather than 403: telling an unauthorised visitor that /a/users
    // exists is information they did not have a moment ago.
    redirect("/not-found");
  }

  return profile;
}

/**
 * Guard for a PAGE only a super administrator may use.
 *
 * Same 404 as `requireRole`: a simple admin who types the URL learns nothing
 * about what is behind it. Server Actions should prefer `superAdminOrError`,
 * which returns an ActionResult the form can show instead of navigating away
 * mid-submit.
 */
export async function requireSuperAdmin(): Promise<AuthProfile> {
  const profile = await requireRole("admin");
  if (!profile.isSuperAdmin) redirect("/not-found");
  return profile;
}

/**
 * The Server Action form of `requireSuperAdmin`.
 *
 * Still redirects anyone who is not an active admin at all (that is
 * `requireRole`, and a customer has no business getting a polite error), but
 * a SIMPLE admin gets `{ ok: false, error }` — the ActionResult shape of
 * lib/data/admin-actions.ts — so the button they pressed can say why.
 *
 *   const gate = await superAdminOrError();
 *   if (!gate.ok) return gate;
 *   const admin = gate.admin;
 */
export async function superAdminOrError(): Promise<
  { ok: true; admin: AuthProfile } | { ok: false; error: string }
> {
  const admin = await requireRole("admin");
  if (!admin.isSuperAdmin) return { ok: false, error: SUPER_ADMIN_ONLY_ERROR };
  return { ok: true, admin };
}

/** True when nobody is signed in. Cheap enough for layout-level branching. */
export async function isSignedOut(): Promise<boolean> {
  return (await getCurrentProfile()) === null;
}
