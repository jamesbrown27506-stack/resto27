import "server-only";
import type { createAdminClient } from "@/lib/supabase/server";

// Moved out of order-actions.ts ("use server"), where as an export it was a
// public endpoint that could free any restaurant's table. Only the order and
// reservation actions — which have checked the caller — call it now.

/**
 * Free a dine-in table — but ONLY if nobody else is sitting at it.
 *
 * The party's order reaching `delivered` means they ate; the reservation
 * reaching `completed` or `no_show` means they never will. Either way the
 * table should go back to the floor — unless ANOTHER open dine-in order is
 * still running on it (a second round, a split bill), in which case the
 * table is genuinely still taken and releasing it would seat strangers on
 * top of a party. The guard is the check; the `status = 'occupied'` filter
 * on the update is the safety: a table already released stays released.
 */
export async function releaseTableIfFree(
  supabase: ReturnType<typeof createAdminClient>,
  restaurantId: string,
  tableNumber: string | null,
): Promise<void> {
  if (!tableNumber) return;

  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("type", "dine_in")
    .eq("table_number", tableNumber)
    .not("status", "in", '("cancelled","delivered")');

  if ((count ?? 0) > 0) return;

  await supabase
    .from("restaurant_tables")
    .update({ status: "available" })
    .eq("restaurant_id", restaurantId)
    .eq("number", tableNumber)
    .eq("status", "occupied");
}
