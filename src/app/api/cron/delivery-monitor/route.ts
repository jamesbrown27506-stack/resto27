import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { requireCronAuth, stampHeartbeat } from "@/lib/cron";

/**
 * Delivery monitor cron endpoint.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHAT IT DOES
 *
 *  Finds delivery orders that have been in `shipped` status for more than
 *  30 minutes without being delivered, and tells both sides ONCE:
 *
 *    1. The CUSTOMER: "your delivery is taking longer than expected, the
 *       restaurant has been alerted" — as its own `order_delayed` event with
 *       its own collapse tag, so it stacks beside the original "out for
 *       delivery" banner instead of silently replacing it.
 *
 *    2. The RESTAURANT: "this order has been out for over 30 minutes with
 *       no confirmation" — also `order_delayed`, never disguised as a new
 *       order: a fake `new_order` polluted the one channel that announces
 *       real revenue, and its collapse tag erased the genuine banner.
 *
 *  ONCE means once. `delivery_alert_sent_at` (0034 built the column and its
 *  partial index for exactly this) is both the filter and the stamp — the
 *  previous version re-alerted every 5 minutes forever, which is how staff
 *  learn to ignore alerts.
 *
 *  The pass ends with subscription hygiene (expired / permanently-failing
 *  push endpoints are pruned) and a heartbeat stamp /a/health reads.
 *
 *  Scheduled by vercel.json (or pg_cron per dev.md §P6). Bearer-protected.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const dynamic = "force-dynamic";

const TIMEOUT_MINUTES = 30;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000).toISOString();

  let { data: stuckOrders, error } = await supabase
    .from("orders")
    .select(
      "id, reference, customer_id, restaurant_id, total, restaurants ( name )",
    )
    .eq("type", "delivery")
    .eq("status", "shipped")
    .lt("shipped_at", cutoff)
    .is("delivered_at", null)
    .is("delivery_alert_sent_at", null);

  // Pre-0034 database: the dedupe column does not exist. Alerting repeatedly
  // is worse than not alerting — skip the sweep and say why, rather than
  // regressing to the every-5-minutes storm.
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    console.error("[delivery-monitor] delivery_alert_sent_at missing — run migration 0034. Sweep skipped.");
    stuckOrders = [];
    error = null;
  }

  if (error) {
    console.error("[delivery-monitor] query failed", error.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  let notified = 0;

  for (const order of stuckOrders ?? []) {
    const orderId = order.id as string;
    const reference = order.reference as string;
    const customerId = order.customer_id as string | null;
    const restaurantId = order.restaurant_id as string;
    const restaurantName =
      (order.restaurants as unknown as { name?: string } | null)?.name ?? undefined;

    // Notify the customer — if they have an account.
    if (customerId) {
      await notify({
        event: "order_delayed",
        tone: "warning",
        customerId,
        href: `/orders/${orderId}`,
        params: { reference, restaurantName, audience: "customer" },
      });
    }

    await notify({
      event: "order_delayed",
      tone: "warning",
      restaurantId,
      href: `/m/orders/${orderId}`,
      params: { reference, restaurantName, audience: "staff" },
    });

    // The stamp is what makes this alert a one-off. Written after the
    // notifies so a crash mid-loop re-alerts rather than silently skips.
    await supabase
      .from("orders")
      .update({ delivery_alert_sent_at: new Date().toISOString() })
      .eq("id", orderId);

    notified++;
  }

  const pruned = await pruneDeadSubscriptions(supabase);

  await stampHeartbeat("delivery-monitor", { checked: (stuckOrders ?? []).length, notified, pruned });

  return NextResponse.json({
    checked: (stuckOrders ?? []).length,
    notified,
    pruned,
    cutoff,
  });
}

/**
 * Push-subscription hygiene, piggybacked on the sweep that already runs.
 *
 * Two classes of dead row: an endpoint past its advertised expiry, and one
 * that has failed 10+ times with no success in 30 days (any success resets
 * the counter, so only persistent failures accumulate). Both re-register
 * through PushSync on the device's next open if the device is actually
 * alive — the same self-healing the reset flow relies on.
 */
async function pruneDeadSubscriptions(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<number> {
  let pruned = 0;
  try {
    const now = new Date().toISOString();
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: expired } = await supabase
      .from("push_subscriptions")
      .delete()
      .lt("expiration_time", now)
      .select("id");
    pruned += (expired ?? []).length;

    const { data: failing } = await supabase
      .from("push_subscriptions")
      .delete()
      .gte("failure_count", 10)
      .or(`last_success_at.is.null,last_success_at.lt.${monthAgo}`)
      .select("id");
    pruned += (failing ?? []).length;

    if (pruned > 0) console.log(`[delivery-monitor] pruned ${pruned} dead push subscriptions`);
  } catch (thrown) {
    // Pre-0042 database, or a transient failure — hygiene must never fail
    // the sweep that alerts about real orders.
    console.error("[delivery-monitor] subscription prune failed —", (thrown as Error)?.message ?? thrown);
  }
  return pruned;
}
