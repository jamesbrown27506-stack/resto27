import "server-only";

import { createAdminClient } from "@/lib/supabase/server";

/**
 * Give back what an order was holding once it is cancelled.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Placing an order takes two things before anyone has paid: tracked stock
 *  (checkout decrements it so two customers cannot buy the last plate) and
 *  redeemed loyalty points (a `redeem` ledger row). No cancel path ever gave
 *  them back — a cancelled order kept the dish "sold out" and the customer's
 *  points spent, for ever.
 *
 *  Call it ONLY from the caller that won the transition to `cancelled` (a
 *  conditional update that returned the row): that is what makes it run once
 *  per order. The loyalty part is additionally idempotent — a `refund` row
 *  for this order is written at most once.
 *
 *  Never throws: like notify() and the history writer, a failure to restock
 *  must not undo the cancellation it follows.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function releaseOrderHoldings(orderId: string): Promise<void> {
  const supabase = createAdminClient();
  try {
    const { data: lines } = await supabase
      .from("order_items")
      .select("menu_item_id, quantity")
      .eq("order_id", orderId);

    const byItem = new Map<string, number>();
    for (const line of (lines ?? []) as { menu_item_id: string | null; quantity: number }[]) {
      if (!line.menu_item_id) continue;
      byItem.set(line.menu_item_id, (byItem.get(line.menu_item_id) ?? 0) + Number(line.quantity));
    }

    if (byItem.size > 0) {
      const { data: items } = await supabase
        .from("menu_items")
        .select("id, track_stock, stock_quantity")
        .in("id", [...byItem.keys()]);
      for (const item of (items ?? []) as { id: string; track_stock: boolean; stock_quantity: number | null }[]) {
        if (!item.track_stock || item.stock_quantity === null) continue;
        await supabase
          .from("menu_items")
          .update({ stock_quantity: item.stock_quantity + (byItem.get(item.id) ?? 0) })
          .eq("id", item.id)
          // Read-then-write, guarded on the value read: a concurrent sale makes
          // this match nothing, and one plate of drift beats a double restock.
          .eq("stock_quantity", item.stock_quantity);
      }
    }

    const { data: ledger } = await supabase
      .from("loyalty_ledger")
      .select("profile_id, restaurant_id, points, kind")
      .eq("order_id", orderId)
      .in("kind", ["redeem", "refund"]);
    const rows = (ledger ?? []) as { profile_id: string; restaurant_id: string | null; points: number; kind: string }[];
    const redeemed = rows.filter((r) => r.kind === "redeem");
    if (redeemed.length > 0 && !rows.some((r) => r.kind === "refund")) {
      const points = redeemed.reduce((sum, r) => sum - Number(r.points), 0);
      if (points > 0) {
        await supabase.from("loyalty_ledger").insert({
          profile_id: redeemed[0].profile_id,
          order_id: orderId,
          restaurant_id: redeemed[0].restaurant_id,
          points,
          kind: "refund",
          note: "Commande annulée — points restitués",
        });
      }
    }
  } catch (error) {
    console.error("[orders:releaseHoldings]", orderId, error);
  }
}
