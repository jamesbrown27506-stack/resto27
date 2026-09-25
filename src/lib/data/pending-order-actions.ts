"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getActiveProfile } from "@/lib/auth/session";
import { getActiveBranchSummary } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { getTimeLimits } from "@/lib/orders/time-limit-settings";
import { DEFAULT_ORDER_RESPONSE_MINUTES } from "@/lib/orders/deadline";

/**
 * The read behind the manager shell's "ring until accepted" alarm.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY A SEPARATE, DELIBERATELY SMALL ACTION.
 *
 *  The alarm calls this once when the back office opens, again when a
 *  `new_order` notification lands, and every 30 s ONLY while something is
 *  waiting — so on a quiet evening it costs nothing at all (Vercel CPU is
 *  billed per invocation; see docs/vercel-cpu-audit-2026-09-25.md). It
 *  returns ids and timestamps, never the order contents: the banner needs a
 *  count and a deadline, not a menu.
 *
 *  NEVER REDIRECTS. requireCapability() redirects to /not-found on refusal,
 *  and a redirect thrown from a background Server Action navigates the tab —
 *  a cashier who lost `orders.advance` mid-shift would be yanked off the page
 *  they were on by a poll. Refusal here is simply "nothing to ring for".
 *
 *  The branch is the SESSION's active branch (cookie checked against real
 *  membership), never an argument — same rule as every manager action.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface PendingAlarmOrder {
  id: string;
  reference: string;
  type: string;
  createdAt: string;
  scheduledFor: string | null;
}

export interface PendingAlarmState {
  /** The branch this list belongs to — the client drops a stale answer after a branch switch. */
  restaurantId: string | null;
  /** The admin's `order_response_minutes` — deadline.ts turns it into a time. */
  minutes: number;
  orders: PendingAlarmOrder[];
}

const NOTHING: PendingAlarmState = {
  restaurantId: null,
  minutes: DEFAULT_ORDER_RESPONSE_MINUTES,
  orders: [],
};

export async function getPendingOrderAlarm(): Promise<PendingAlarmState> {
  try {
    const { profile } = await getActiveProfile();
    if (!profile) return NOTHING;

    const branch = await getActiveBranchSummary(profile.id);
    // Only someone who can ACCEPT is rung for. A role that could only watch
    // the ring would learn to ignore it.
    if (!branch || !can(branch.role, "orders.advance")) return NOTHING;

    const [{ data, error }, limits] = await Promise.all([
      createAdminClient()
        .from("orders")
        .select("id, reference, type, created_at, scheduled_for")
        .eq("restaurant_id", branch.restaurantId)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(30),
      getTimeLimits(),
    ]);

    if (error) {
      console.error("[alarm:pending]", error.message);
      return { ...NOTHING, restaurantId: branch.restaurantId, minutes: limits.orderMinutes };
    }

    return {
      restaurantId: branch.restaurantId,
      minutes: limits.orderMinutes,
      orders: ((data ?? []) as {
        id: string;
        reference: string;
        type: string;
        created_at: string;
        scheduled_for: string | null;
      }[]).map((row) => ({
        id: row.id,
        reference: row.reference,
        type: row.type,
        createdAt: row.created_at,
        scheduledFor: row.scheduled_for,
      })),
    };
  } catch (error) {
    // A background check must never surface as an error overlay. Swallow and
    // report; the next trigger tries again.
    console.error("[alarm:pending] failed", error);
    return NOTHING;
  }
}
