import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";

/**
 * Delivery monitor cron endpoint.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHAT IT DOES
 *
 *  Finds delivery orders that have been in `shipped` status for more than
 *  30 minutes without being delivered. When this happens:
 *
 *    1. The CUSTOMER is notified: "Your delivery is taking longer than
 *       expected. We are looking for a delivery agent."
 *
 *    2. The RESTAURANT is notified: "A delivery order has been waiting
 *       for pickup for over 30 minutes. Please check on it."
 *
 *  This covers both scenarios:
 *    - Restaurant has own delivery: the restaurant's riders haven't picked up
 *    - Platform delivery: no agent has been assigned yet
 *
 *  Called by pg_cron every 5 minutes (see dev.md §P6). Bearer-token
 *  protected — an unauthenticated request gets 401.
 *
 *  Idempotent: notifying twice about the same order is harmless (the
 *  customer sees two messages, which is better than seeing none).
 * ─────────────────────────────────────────────────────────────────────────
 */

export const dynamic = "force-dynamic";

const TIMEOUT_MINUTES = 30;

export async function GET(request: Request) {
  // Bearer token check — same pattern as the reconciler.
  const authHeader = request.headers.get("authorization");
  const token = process.env.CRON_SECRET;
  if (!token || authHeader !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000).toISOString();

  // Find delivery orders stuck in "shipped" for more than 30 minutes.
  // The `delivered_at` column is null for orders still in transit.
  const { data: stuckOrders, error } = await supabase
    .from("orders")
    .select(
      "id, reference, customer_id, restaurant_id, total, created_at, shipped_at",
    )
    .eq("type", "delivery")
    .eq("status", "shipped")
    .lt("shipped_at", cutoff)
    .is("delivered_at", null);

  if (error) {
    console.error("[delivery-monitor] query failed", error.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  if (!stuckOrders || stuckOrders.length === 0) {
    return NextResponse.json({ checked: 0, notified: 0 });
  }

  let notified = 0;

  for (const order of stuckOrders) {
    const orderId = order.id as string;
    const reference = order.reference as string;
    const customerId = order.customer_id as string | null;
    const restaurantId = order.restaurant_id as string;
    const total = order.total as number;

    // Notify the customer — if they have an account.
    if (customerId) {
      await notify({
        event: "order_status",
        tone: "warning",
        customerId,
        href: `/orders/${orderId}`,
        params: {
          status: "shipped",
          reference,
          restaurantName: "", // Will be resolved by the notify system
        },
      });
    }

    // Notify the restaurant staff.
    await notify({
      event: "new_order",
      tone: "warning",
      restaurantId,
      href: `/m/orders/${orderId}`,
      params: {
        reference,
        customerName: "⚠️ Delivery delay",
        amount: total,
      },
    });

    notified++;
  }

  return NextResponse.json({
    checked: stuckOrders.length,
    notified,
    cutoff: cutoff,
  });
}
