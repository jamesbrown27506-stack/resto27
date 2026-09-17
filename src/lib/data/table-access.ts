import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { applyTablePlanLimit } from "@/lib/billing/plan-access";
import { fetchPlanLimits } from "./billing";

interface FloorRecord {
  id: string;
  number: string;
  capacity: number;
  status: "available" | "occupied" | "reserved" | "out_of_service";
}

/** One floor/entitlement read shared by booking, order creation and the manager UI. */
export async function fetchTableAccess(restaurantId: string) {
  const supabase = createAdminClient();
  const [floor, subscription, limits] = await Promise.all([
    supabase.from("restaurant_tables").select("id, number, capacity, status").eq("restaurant_id", restaurantId),
    supabase.from("subscription_state").select("plan_id, state").eq("restaurant_id", restaurantId).maybeSingle(),
    fetchPlanLimits(),
  ]);
  if (floor.error) throw new Error("Could not read the restaurant floor.");
  if (subscription.error) throw new Error("Could not verify the restaurant package.");

  let tier = "starter";
  const sub = subscription.data;
  if (sub?.plan_id && sub.state !== "locked" && sub.state !== "cancelled") {
    const plan = await supabase.from("subscription_plans").select("tier").eq("id", sub.plan_id).maybeSingle();
    if (plan.error) throw new Error("Could not verify the restaurant package.");
    tier = plan.data?.tier ?? "starter";
  }
  const entitlement = limits.get(tier) ?? limits.get("starter");
  if (!entitlement) throw new Error("Could not verify the table allowance.");
  const limit = entitlement.tableLimit;
  return { tables: applyTablePlanLimit((floor.data ?? []) as FloorRecord[], limit), limit };
}
