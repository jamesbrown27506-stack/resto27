import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { BillingView } from "./billing-view";
import { requireCapability } from "@/lib/auth/branch";
import { fetchBranchOverview, fetchPromotions, fetchTables } from "@/lib/data/manager";
import {
  fetchInvoices,
  fetchPaymentsEnabled,
  fetchPlans,
  fetchTrialState,
} from "@/lib/data/invoices";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/**
 * Billing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS PAGE MUST STAY REACHABLE WHILE THE TENANT IS LOCKED (§5, rule 3).
 *
 *  Locking someone out of the only screen that can unlock them is a trap that
 *  also guarantees they never pay. `requireCapability` gates on the ROLE, not
 *  on the subscription state, which is what keeps it open — the sidebar does
 *  the same via `allowLocked` in lib/nav.
 * ─────────────────────────────────────────────────────────────────────────
 */

// Invoices and the trial countdown change under the tenant's feet — a cached
// copy would offer to pay something already settled.
export const dynamic = "force-dynamic";

// The browser tab is a user-visible string too, so it reads the same locale
// cookie the page renders with rather than being hardcoded French.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mbl.title"] };
}

export default async function BillingPage() {
  const { active } = await requireCapability("billing.manage");

  const [plans, invoices, trial, paymentsEnabled, overview, tables, promotions] = await Promise.all([
    fetchPlans(),
    fetchInvoices(active.restaurantId),
    fetchTrialState(active.restaurantId),
    fetchPaymentsEnabled(),
    fetchBranchOverview(active.restaurantId),
    fetchTables(active.restaurantId),
    fetchPromotions(active.restaurantId),
  ]);

  return (
    // Keys, not strings: this page is a Server Component and cannot call
    // useLocale, but ManagerPage is a Client Component and can.
    <ManagerPage titleKey="mbl.title" descriptionKey="mbl.subtitle">
      <BillingView
        branch={{
          planTier: active.planTier,
          planName: active.planName,
          subscriptionState: active.subscriptionState,
          expiresAt: active.expiresAt,
        }}
        plans={plans}
        invoices={invoices}
        usage={{
          menuItems: overview.menuItems,
          tables: tables.length,
          promotions: promotions.filter((p) => p.isActive).length,
        }}
        // When a real provider is live the simulator refuses to run, so the
        // button is hidden rather than left there to fail.
        canSimulate={!paymentsEnabled}
        trial={trial}
        // The clock is stamped HERE and passed down as an ISO string. Reading
        // it during a client render is impure and the React Compiler rejects
        // it outright — and one instant for the whole page means the overdue
        // marks cannot disagree row to row.
        now={new Date().toISOString()}
      />
    </ManagerPage>
  );
}
