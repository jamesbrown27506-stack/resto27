import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The plans, as the public pages show them.
 *
 * Read from the database, not from a constant. Prices, limits and the trial
 * length are things an administrator changes on a Tuesday afternoon; a
 * hardcoded pricing table means the homepage advertises one number while the
 * limit checks enforce another, and nobody notices until a customer does.
 */

export interface PublicPlan {
  id: string;
  tier: string;
  name: string;
  monthlyPrice: number;
  commissionRate: number;
  menuItemLimit: number | null;
  tableLimit: number | null;
  promotionLimit: number | null;
  staffManagement: boolean;
  analytics: boolean;
  isFeatured: boolean;
  /** Null when the plan has no free trial — Starter is already free. */
  trialDays: number | null;
}

export async function listPublicPlans(): Promise<PublicPlan[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");

  if (error) {
    console.error("[plans:listPublicPlans]", error.message);
    return [];
  }

  return (data ?? []).map((p) => ({
    id: p.id,
    tier: p.tier,
    name: p.name,
    monthlyPrice: p.monthly_price,
    commissionRate: Number(p.commission_rate),
    menuItemLimit: p.menu_item_limit,
    tableLimit: p.table_limit,
    promotionLimit: p.promotion_limit,
    staffManagement: p.staff_management,
    analytics: p.analytics,
    isFeatured: p.is_featured,
    // The column arrives with 0010; tolerate its absence so the pricing page
    // does not break on a database that has not been migrated yet.
    trialDays: (p.trial_days as number | null) ?? null,
  }));
}
