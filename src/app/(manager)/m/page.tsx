import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardView } from "./dashboard-view";
import { SUBSCRIPTION_STATE_META } from "@/lib/format/subscription";
import { requireBranch } from "@/lib/auth/branch";
import { fetchBranchOverview, fetchReservations, fetchSetupChecklist } from "@/lib/data/manager";
import { fetchPlanLimits, freeModePlanName } from "@/lib/data/billing";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";
import { can } from "@/lib/capabilities";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["nav.m.dashboard"] };
}

/**
 * The restaurant dashboard — server half.
 *
 * Does every read, then hands plain numbers to a Client Component that owns
 * the copy. That split exists because a Server Component cannot call
 * useLocale, which is why this page stayed French whatever the toggle said.
 */
export default async function ManagerDashboard() {
  const { active, profile } = await requireBranch();

  // First login for a brand-new restaurant: the setup wizard is the first
  // thing they do, before the dashboard pretends their empty floor is a
  // going concern. The migration backfilled `setup_done_at` for every
  // established tenant, so this only ever catches genuinely new ones.
  // Only for whoever can build the menu: a waiter's first sign-in must not
  // land on a wizard they cannot finish (and the dashboard would send them
  // straight back to it).
  if (!active.setupDoneAt && can(active.role, "menu.edit")) redirect("/m/setup");

  const [overview, upcoming, limits, checklist, freePlan] = await Promise.all([
    fetchBranchOverview(active.restaurantId),
    fetchReservations(active.restaurantId, { from: new Date(), status: "pending" }),
    fetchPlanLimits(),
    fetchSetupChecklist(active.restaurantId),
    freeModePlanName(),
  ]);

  // While the platform is free every restaurant has the richest plan's
  // features, so that is the plan the chip names — "Enterprise · Gratuit",
  // not the "Starter" on file that it is not limited to.
  const stateMeta = SUBSCRIPTION_STATE_META[freePlan ? "free_mode" : active.subscriptionState];

  // A locked tenant drops to Starter limits (§5) — existing rows keep working.
  const tier = active.subscriptionState === "locked" ? "starter" : active.planTier;
  const limit = limits.get(tier) ?? limits.get("starter") ?? null;

  return (
    <DashboardView
      firstName={profile.name.split(" ")[0] ?? profile.name}
      branch={{
        restaurantName: active.restaurantName,
        branchLabel: active.branchLabel,
        status: active.status,
        role: active.role,
        isAcceptingOrders: active.isAcceptingOrders,
      }}
      planLabel={`${freePlan ?? active.planName} · ${stateMeta.label}`}
      // `tone: null` on an active subscription means "no banner needed" — it is
      // not a Badge tone. Neutral is the right chip for a healthy plan.
      planTone={stateMeta.tone ?? "neutral"}
      overview={overview}
      upcoming={upcoming.map((r) => ({
        id: r.id,
        guestName: r.guestName,
        partySize: r.partySize,
        reservedFor: r.reservedFor,
      }))}
      menuItemLimit={limit?.menuItemLimit ?? null}
      checklist={checklist}
    />
  );
}
