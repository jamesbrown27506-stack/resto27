import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { getCartConfig } from "@/lib/orders/cart-config";
import { notify } from "@/lib/notify";

/**
 * POINTS ARE EARNED ON DELIVERY, NOT AT CHECKOUT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS LIVES IN ITS OWN MODULE.
 *
 *  It used to be a private helper inside order-actions, called from exactly
 *  one place: the manager advancing an order to `delivered`. That was fine
 *  while the restaurant was the only party who could close an order.
 *
 *  The customer can now confirm receipt themselves — which is the right
 *  thing, since they are the one holding the bag — and that opened a trap:
 *  two paths reach `delivered`, and points awarded on only one of them means
 *  a customer who closes their own order silently earns nothing. The bug
 *  would be invisible (no error, no missing row to notice) and would look
 *  like the loyalty scheme simply not working sometimes.
 *
 *  One function, both callers. order-actions is a "use server" module, so it
 *  cannot export a helper taking a Supabase client — every export there
 *  becomes a server action. Hence a plain server-only module instead.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * NEVER THROWS. A failed ledger row must not retract a delivered order — it
 * is a reconciliation problem, not a delivery problem.
 */
export async function awardDeliveryPoints(order: {
  subtotal: number;
  reference: string;
  customer_id: string | null;
  restaurant_id: string;
  id: string;
}): Promise<void> {
  const config = await getCartConfig();
  if (!config.loyaltyEnabled || !order.customer_id || config.pointsPer1000 <= 0) return;

  const points = Math.floor(order.subtotal / 1000) * config.pointsPer1000;
  if (points <= 0) return;

  const supabase = createAdminClient();

  /*
    ONE LEDGER ROW PER ORDER, whoever closed it.

    Both the restaurant and the customer can move an order to `delivered`.
    The status guard on each UPDATE means only one of them can win the
    transition — but a retry, or a manual status correction that passes
    through `shipped` a second time, would reach this function twice. Reading
    first is not free of races, and the cost of getting it wrong is real
    money, so the check is here AND the write is idempotent by order_id at
    the caller's discretion.
  */
  const { data: already } = await supabase
    .from("loyalty_ledger")
    .select("id")
    .eq("order_id", order.id)
    .eq("kind", "earn")
    .maybeSingle();

  if (already) return;

  const { error } = await supabase.from("loyalty_ledger").insert({
    profile_id: order.customer_id,
    order_id: order.id,
    restaurant_id: order.restaurant_id,
    points,
    kind: "earn",
    note: `Commande ${order.reference} livrée`,
  });

  if (error) {
    console.error("[orders:awardDeliveryPoints]", order.id, error.message);
    return;
  }

  // The points landed; the customer should know they did.
  await notify({
    event: "loyalty",
    tone: "success",
    customerId: order.customer_id,
    href: "/loyalty",
    params: { points, reference: order.reference },
  });
}
