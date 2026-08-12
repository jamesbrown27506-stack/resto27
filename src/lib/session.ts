/**
 * Session shape and a fixture value.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  FIXTURE ONLY. Replaced in P3 by `lib/auth/session`, which loads the
 *  profile server-side and — critically — RE-CHECKS `status` on every
 *  request. A valid JWT proves who someone is; it does not prove they are
 *  still allowed in (B.2, the revocation gap).
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The shape is deliberately the real one so swapping the implementation does
 * not ripple through every component.
 */

import type { BranchRole } from "./capabilities";
import type { SubscriptionState } from "./format/subscription";

export type UserRole = "customer" | "manager" | "admin";
export type UserStatus = "active" | "pending" | "suspended";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
}

/**
 * A branch the signed-in user may operate.
 *
 * Branches are rows in `restaurants` sharing a `user_id` (§3) — not a separate
 * table — distinguished by `branchLabel`, one flagged primary. The per-branch
 * role is the second level of the permission model.
 */
export interface BranchMembership {
  restaurantId: string;
  restaurantName: string;
  branchLabel: string;
  isPrimary: boolean;
  role: BranchRole;
  subscriptionState: SubscriptionState;
  planTier: "starter" | "professional" | "enterprise";
}

export interface Session {
  user: SessionUser;
  /** Every branch this user may operate. Empty for customers and admins. */
  branches: BranchMembership[];
  /** The branch currently in context. Must be one of `branches`. */
  activeBranchId: string | null;
  /** Set while an admin is viewing the platform as a tenant (§8). */
  impersonating: { adminName: string; targetName: string } | null;
}

export const FIXTURE_MANAGER: Session = {
  user: {
    id: "u_manager_1",
    name: "Paul Mbarga",
    email: "paul@chezmarcel.cm",
    phone: "+237 6 77 88 99 00",
    avatarUrl: null,
    role: "manager",
    status: "active",
  },
  branches: [
    {
      restaurantId: "r_1",
      restaurantName: "Chez Marcel",
      branchLabel: "Akwa",
      isPrimary: true,
      role: "owner",
      subscriptionState: "active",
      planTier: "professional",
    },
    {
      restaurantId: "r_2",
      restaurantName: "Chez Marcel",
      branchLabel: "Bonapriso",
      isPrimary: false,
      role: "manager",
      subscriptionState: "grace",
      planTier: "starter",
    },
  ],
  activeBranchId: "r_1",
  impersonating: null,
};

export const FIXTURE_ADMIN: Session = {
  user: {
    id: "u_admin_1",
    name: "Awa Fotso",
    email: "awa@restolink.cm",
    phone: null,
    avatarUrl: null,
    role: "admin",
    status: "active",
  },
  branches: [],
  activeBranchId: null,
  impersonating: null,
};

export function activeBranch(session: Session): BranchMembership | null {
  if (!session.activeBranchId) return session.branches[0] ?? null;
  return session.branches.find((b) => b.restaurantId === session.activeBranchId) ?? null;
}
