import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { StaffManager } from "./staff-manager";
import { requireCapability } from "@/lib/auth/branch";
import { fetchStaff } from "@/lib/data/manager";
import { fetchPlanLimits } from "@/lib/data/billing";
import { PlanGateUpsell } from "@/components/billing/plan-gate";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

// The roster changes the moment somebody is invited, suspended or accepts.
// A cached copy would show a colleague who no longer has access.
export const dynamic = "force-dynamic";

// The browser tab is a user-visible string too, so it reads the same locale
// cookie the page renders with rather than being hardcoded French.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mst.title"] };
}

/**
 * `staff.manage` guards the whole page, not just the buttons.
 *
 * Unlike the menu, there is no read-only view worth showing a waiter: the
 * roster with everyone's email and role is exactly the sort of thing a branch
 * role is meant to scope.
 */
export default async function StaffPage() {
  const { active, profile } = await requireCapability("staff.manage");

  /**
   * STAFF ACCOUNTS ARE A PAID-PLAN FEATURE (§14.4), AND THE FLAG COMES FROM
   * THE DATABASE.
   *
   * Same rule as reports: the entitlement is read, never hardcoded — which
   * tier includes staff management is an administrator's decision, and free
   * mode (platform free for now) is applied inside `fetchPlanLimits`, so a
   * free platform lets every tenant through. A locked tenant drops to Starter
   * (§5) and meets the gate like anyone else.
   */
  const tier = active.subscriptionState === "locked" ? "starter" : active.planTier;
  const plans = await fetchPlanLimits();
  const plan = plans.get(tier);

  // Empty map = billing table unreadable, not tenant unentitled: a billing
  // outage must not strip a restaurant of its own staff screen.
  const includesStaff = plan ? plan.staffManagement : plans.size === 0;

  if (!includesStaff) {
    return (
      <ManagerPage titleKey="mst.title" descriptionKey="mst.subtitle">
        {/* Professional is the first tier with staff (0053: staff_management
            for every tier but Starter). Naming only Enterprise sent a
            restaurant to a plan three times the price it needed. */}
        <PlanGateUpsell feature="mgate.feature.staff" plan="mgate.plan.professional" />
      </ManagerPage>
    );
  }

  const staff = await fetchStaff(active.restaurantId);

  return (
    // A Server Component cannot call useLocale, so it hands ManagerPage KEYS.
    // The restaurant's own name is not a translatable phrase, so the line that
    // names it is built in the client component from an interpolated key.
    <ManagerPage titleKey="mst.title" descriptionKey="mst.subtitle">
      <StaffManager
        staff={staff}
        myProfileId={profile.id}
        // Only an owner may create or demote another owner. Passed down so the
        // form can hide the option — the action refuses it regardless.
        isOwner={active.role === "owner"}
        restaurantName={active.restaurantName}
        // A single-location restaurant is seeded with the label "Principal";
        // repeating it beside the restaurant's own name says nothing. Only a
        // real second address earns the chip.
        branchLabel={
          active.isPrimary || active.branchLabel.trim() === "" || active.branchLabel === "Principal"
            ? null
            : active.branchLabel
        }
      />
    </ManagerPage>
  );
}
