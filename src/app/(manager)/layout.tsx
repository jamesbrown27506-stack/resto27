import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };
import { ManagerShell } from "@/components/layout/manager-shell";
import { requireRole } from "@/lib/auth/session";
import { getBranchContext } from "@/lib/auth/branch";
import { NoBranch } from "@/components/layout/no-branch";
import { getBranding } from "@/lib/branding";
import { freeModeEndsAt, isFreeMode } from "@/lib/data/billing";

/**
 * Manager area guard — BOTH permission levels (§2).
 *
 *   1. requireRole("manager", "admin") — does this person work at a restaurant?
 *   2. getBranchContext()              — which branch, and as what?
 *
 * The second is the one that matters. `profiles.role = 'manager'` grants
 * nothing on its own; what someone may do comes from restaurant_staff.role at
 * one branch, and each page re-checks its own capability with
 * requireCapability(). This layout only establishes the context.
 *
 * Admins are allowed through so impersonation (§8) has somewhere to land.
 */
export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole("manager", "admin");
  const [context, brand, freeMode, freeEnds] = await Promise.all([
    getBranchContext(),
    getBranding(),
    isFreeMode(),
    freeModeEndsAt(),
  ]);

  /**
   * A signed-in manager with no branch is a real state, not a bug.
   *
   * Their application is approved but the restaurant row is gone, or an owner
   * removed them from the last branch they worked at mid-session. Rendering
   * the shell around an empty context would crash on `active`; rendering an
   * empty dashboard would look broken. This says what happened.
   */
  if (!context) {
    return <NoBranch name={profile.name} isAdmin={profile.role === "admin"} />;
  }

  return (
    <ManagerShell
      branches={context.branches}
      active={context.active}
      brand={{ name: brand.name, logoUrl: brand.logoUrl }}
      user={{
        name: context.profile.name,
        email: context.profile.email,
        phone: context.profile.phone,
        avatarUrl: context.profile.avatarUrl,
      }}
      impersonating={
        context.impersonating
          ? {
              adminName: context.profile.name,
              targetName:
                context.active.branchLabel && context.active.branchLabel !== "Principal"
                  ? `${context.active.restaurantName} — ${context.active.branchLabel}`
                  : context.active.restaurantName,
            }
          : null
      }
      freeMode={freeMode}
      freeModeEndsAt={freeEnds}
    >
      {children}
    </ManagerShell>
  );
}
