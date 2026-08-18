import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { ReportsView } from "./reports-view";
import { requireCapability } from "@/lib/auth/branch";
import { fetchReports, isReportRange } from "@/lib/data/reports";
import { fetchPlanLimits } from "@/lib/data/billing";
import { PlanGateUpsell } from "@/components/billing/plan-gate";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mrp.title"] };
}

/**
 * Yesterday's figures are a different page from today's, and today's change
 * with every ticket. Nothing here may be cached.
 */
export const dynamic = "force-dynamic";

/** What `?range=` falls back to: a month is long enough to have a shape. */
const DEFAULT_RANGE = "30d";

export default async function ReportsPage({
  searchParams,
}: {
  // Next 16 hands these in as a Promise; a page that reads them synchronously
  // does not compile.
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const { active } = await requireCapability("reports.view");

  const { range: requested } = await searchParams;
  // `?range=a&range=b` arrives as an array, and the whole value is attacker
  // controlled — it is validated against the allowed set before it can reach
  // the data layer, never passed through as a string.
  const candidate = Array.isArray(requested) ? requested[0] : requested;
  const range = isReportRange(candidate) ? candidate : DEFAULT_RANGE;

  /**
   * ANALYTICS IS A PAID FEATURE (§14.4), AND THE FLAG COMES FROM THE DATABASE.
   *
   * A locked tenant drops to STARTER (§5) — same rule as the menu ceiling: the
   * subscription lapsed, so what they get is what the free plan gets. Which
   * plan includes analytics is a column an administrator can change on a
   * Tuesday afternoon, so it is read rather than hardcoded.
   *
   * IT MUST BE `fetchPlanLimits`, NOT `listPublicPlans`. The public list
   * filters on `is_active`, which is the PRICING-PAGE VISIBILITY flag, not a
   * statement about who is subscribed. Reading the entitlement through it
   * meant that the moment an admin retired a tier, every restaurant still
   * paying for it fell through `find()` to undefined and got told to buy the
   * plan they already have — while their menu and table ceilings, which read
   * the unfiltered query, kept working.
   */
  const tier = active.subscriptionState === "locked" ? "starter" : active.planTier;
  const plans = await fetchPlanLimits();
  const plan = plans.get(tier);

  // An EMPTY map means the table is unreadable, not that the tenant is
  // unentitled: billing being down must not black out a paying restaurant's
  // reports, the same direction the menu page errs in.
  const includesAnalytics = plan ? plan.analytics : plans.size === 0;

  if (!includesAnalytics) {
    // The queries do not run at all. Reading a tenant's revenue to render a
    // page that will not show it is six aggregates of wasted database time.
    return (
      <ManagerPage titleKey="mrp.title" descriptionKey="mrp.subtitle">
        <PlanGateUpsell feature="mgate.feature.reports" plan="mgate.plan.professional" />
      </ManagerPage>
    );
  }

  const report = await fetchReports(active.restaurantId, range);

  return (
    // titleKey, not title: this is a Server Component and cannot call
    // useLocale, so the heading is translated by <ManagerPage> itself.
    <ManagerPage titleKey="mrp.title" descriptionKey="mrp.subtitle">
      <ReportsView report={report} />
    </ManagerPage>
  );
}
