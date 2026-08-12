"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import { getCartConfig } from "@/lib/orders/cart-config";
import { nextStatus, isTerminal, type OrderStatus } from "@/lib/format/order-status";
import type { ActionResult } from "./admin-actions";

/**
 * Order mutations, restaurant side.
 *
 * Same two rules as every manager action: the capability is re-checked here
 * (a Server Action never passes through the layout that guards its page), and
 * the branch comes from the SESSION, never from an argument — an order id
 * from another restaurant simply does not match the `.eq("restaurant_id")`.
 */

/** Everything a status change needs to know about the order it changes. */
async function loadOrder(restaurantId: string, orderId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("orders")
    .select("id, status, type, total, delivery_fee, delivery_fee_set_at, subtotal, reference, customer_id, restaurant_id")
    .eq("restaurant_id", restaurantId)
    .eq("id", orderId)
    .maybeSingle();
  return data as {
    id: string;
    status: OrderStatus;
    type: string;
    total: number;
    delivery_fee: number;
    delivery_fee_set_at: string | null;
    subtotal: number;
    reference: string;
    customer_id: string | null;
    restaurant_id: string;
  } | null;
}

/** The history row — snapshotted actor, never joined (§9). */
async function recordHistory(orderId: string, status: string, by: { name: string; email: string }, note?: string) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("order_status_history").insert({
    order_id: orderId,
    status,
    by_name: by.name,
    by_email: by.email,
    note: note ?? null,
  });
  // Like the audit log: failing to write history must not undo the operation
  // it records.
  if (error) console.error("[orders:history]", orderId, error.message);
}

function refreshOrderScreens() {
  revalidatePath("/m/orders");
  revalidatePath("/m/kitchen");
  revalidatePath("/m");
}

/**
 * Advance one step along the state machine.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE SERVER RE-DERIVES THE TRANSITION. The client never posts a target
 *  status — it posts "advance", and `nextStatus()` decides what that means
 *  from the CURRENT row. Two taps racing on the same ticket both read the
 *  same state; the second becomes a no-op instead of a double-skip.
 *
 *  THE FEE GATE (§4): a delivery order cannot reach `confirmed` without a
 *  quoted fee. Checked here, not just in the dialog — the dialog is UI, this
 *  is the rule.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function advanceOrder(
  orderId: string,
  input: { deliveryFee?: number } = {},
): Promise<ActionResult & { status?: OrderStatus }> {
  const { active, profile } = await requireCapability("orders.advance");
  const supabase = createAdminClient();

  const order = await loadOrder(active.restaurantId, orderId);
  if (!order) return { ok: false, error: "Order not found." };

  const next = nextStatus(order.status);
  if (!next) return { ok: false, error: "This order is already finished." };

  const patch: Record<string, unknown> = { status: next };

  if (next === "confirmed" && order.type === "delivery" && order.delivery_fee_set_at === null) {
    const fee = input.deliveryFee;
    // Zero is a legitimate quote ("we deliver free nearby") — only absence and
    // nonsense are refused. XAF is zero-decimal: whole francs or it is wrong.
    if (fee === undefined || !Number.isInteger(fee) || fee < 0) {
      return { ok: false, error: "Quote the delivery fee before confirming." };
    }
    patch.delivery_fee = fee;
    patch.delivery_fee_set_at = new Date().toISOString();
    // The customer committed to a total that did not yet include delivery.
    patch.total = order.total + fee;
  }

  if (next === "delivered") {
    patch.delivered_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", orderId)
    .eq("restaurant_id", active.restaurantId)
    // The optimistic-concurrency guard: if someone advanced it first, this
    // matches nothing and the refresh shows the newer truth.
    .eq("status", order.status);

  if (error) {
    console.error("[orders:advanceOrder]", orderId, error.message);
    return { ok: false, error: "Could not update the order." };
  }

  await recordHistory(orderId, next, { name: profile.name, email: profile.email });

  if (next === "delivered") await awardDeliveryPoints(supabase, order);

  refreshOrderScreens();
  revalidatePath(`/m/orders/${orderId}`);
  revalidatePath("/loyalty");
  revalidatePath("/account");
  return { ok: true, status: next };
}

/**
 * Points are EARNED ON DELIVERY, not at checkout.
 *
 * Awarding them at checkout would pay for orders that are later cancelled,
 * and the natural exploit is to order, collect, cancel, repeat. The one-earn
 * row per order index (0013) makes a double-advance a no-op rather than a
 * double-credit.
 */
async function awardDeliveryPoints(
  supabase: ReturnType<typeof createAdminClient>,
  order: {
    subtotal: number;
    reference: string;
    customer_id: string | null;
    restaurant_id: string;
    id: string;
  },
) {
  const config = await getCartConfig();
  if (!config.loyaltyEnabled || !order.customer_id || config.pointsPer1000 <= 0) return;

  const points = Math.floor(order.subtotal / 1000) * config.pointsPer1000;
  if (points <= 0) return;

  const { error } = await supabase.from("loyalty_ledger").insert({
    profile_id: order.customer_id,
    order_id: order.id,
    restaurant_id: order.restaurant_id,
    points,
    kind: "earn",
    note: `Commande ${order.reference} livrée`,
  });
  if (error) {
    // A failed ledger row must never retract a delivered order — it is a
    // reconciliation problem, not a delivery problem.
    console.error("[orders:awardDeliveryPoints]", order.id, error.message);
  }
}

/**
 * Cancel, with a reason the customer will read.
 *
 * Required, not optional-in-practice: a cancellation with no explanation is
 * the single thing customers complain about most.
 */
export async function cancelOrder(orderId: string, reason: string): Promise<ActionResult> {
  const { active, profile } = await requireCapability("orders.advance");

  if (reason.trim().length < 3) {
    return { ok: false, error: "Give a reason — the customer reads it." };
  }

  const order = await loadOrder(active.restaurantId, orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (isTerminal(order.status)) return { ok: false, error: "This order is already finished." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_reason: reason.trim(),
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: "Could not cancel the order." };

  await recordHistory(orderId, "cancelled", { name: profile.name, email: profile.email }, reason.trim());

  refreshOrderScreens();
  revalidatePath(`/m/orders/${orderId}`);
  return { ok: true };
}

/* ── Table-side ordering ───────────────────────────────────────────────── */

export interface TableOrderLine {
  menuItemId: string;
  quantity: number;
  /** Chosen option names, display only — the price is recomputed server-side. */
  optionIds: string[];
}

/**
 * Create a dine-in order from the waiter screen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WRITES THE SAME ROWS AS AN ONLINE ORDER. Same `orders`, same `order_items`
 *  snapshots, same history. Kitchen, tickets, stock and reports work
 *  unchanged because nothing downstream can tell the difference.
 *
 *  PRICES COME FROM THE DATABASE, NEVER FROM THE CLIENT. The client sends
 *  item ids and quantities; name, price and option deltas are read fresh
 *  here. A tampered request can order a lot of food — it cannot reprice it.
 *
 *  Born `confirmed`, not `pending`: the waiter standing at the table IS the
 *  restaurant accepting the order, so it goes straight to the kitchen queue.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function createTableOrder(input: {
  tableId: string;
  lines: TableOrderLine[];
  notes?: string;
}): Promise<ActionResult & { orderId?: string; reference?: string }> {
  const { active, profile } = await requireCapability("orders.advance");
  const supabase = createAdminClient();

  if (input.lines.length === 0) return { ok: false, error: "The ticket is empty." };

  // The table must be this branch's. Its number is snapshotted onto the order.
  const { data: table } = await supabase
    .from("restaurant_tables")
    .select("id, number, status")
    .eq("id", input.tableId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!table) return { ok: false, error: "No such table at this branch." };
  if (table.status === "out_of_service") return { ok: false, error: "That table is out of service." };

  // ── Reprice every line from the database ────────────────────────────────
  const itemIds = [...new Set(input.lines.map((l) => l.menuItemId))];
  const { data: menuRows } = await supabase
    .from("menu_items")
    .select("id, name, price, is_available, track_stock, stock_quantity")
    .eq("restaurant_id", active.restaurantId)
    .in("id", itemIds);

  const menu = new Map(
    ((menuRows ?? []) as {
      id: string;
      name: string;
      price: number;
      is_available: boolean;
      track_stock: boolean;
      stock_quantity: number | null;
    }[]).map((m) => [m.id, m]),
  );

  const optionIds = [...new Set(input.lines.flatMap((l) => l.optionIds))];
  const { data: optionRows } = optionIds.length
    ? await supabase.from("menu_options").select("id, name, price_delta").in("id", optionIds)
    : { data: [] };
  const options = new Map(
    ((optionRows ?? []) as { id: string; name: string; price_delta: number }[]).map((o) => [o.id, o]),
  );

  let subtotal = 0;
  const itemInserts: Record<string, unknown>[] = [];

  for (const line of input.lines) {
    const item = menu.get(line.menuItemId);
    if (!item) return { ok: false, error: "A dish on the ticket no longer exists." };
    if (!item.is_available) return { ok: false, error: `"${item.name}" is sold out.` };
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50) {
      return { ok: false, error: "Invalid quantity." };
    }
    if (item.track_stock && item.stock_quantity !== null && item.stock_quantity < line.quantity) {
      return { ok: false, error: `Only ${item.stock_quantity} of "${item.name}" left in stock.` };
    }

    const chosen = line.optionIds.map((id) => options.get(id)).filter(Boolean) as {
      name: string;
      price_delta: number;
    }[];
    const unitPrice = item.price + chosen.reduce((sum, o) => sum + o.price_delta, 0);
    if (unitPrice < 0) return { ok: false, error: "Invalid price." };

    subtotal += unitPrice * line.quantity;
    itemInserts.push({
      menu_item_id: line.menuItemId,
      name: item.name,
      unit_price: unitPrice,
      quantity: line.quantity,
      options_label: chosen.map((o) => o.name).join(" · ") || null,
    });
  }

  // Service charge from settings — the platform rule, not a hardcoded 5.
  const { data: chargeSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "service_charge_percent")
    .maybeSingle();
  const chargePercent = Number(chargeSetting?.value ?? 5) || 0;
  const serviceCharge = Math.round((subtotal * chargePercent) / 100);

  const reference = `CMD-${randomUUID().slice(0, 6).toUpperCase()}`;

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      reference,
      restaurant_id: active.restaurantId,
      type: "dine_in",
      status: "confirmed",
      subtotal,
      service_charge_percent: chargePercent,
      service_charge: serviceCharge,
      total: subtotal + serviceCharge,
      table_number: table.number,
      payment_method: "pay_at_restaurant",
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .single();

  if (error || !order) {
    console.error("[orders:createTableOrder]", error?.message);
    return { ok: false, error: "Could not create the order." };
  }

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(itemInserts.map((i) => ({ ...i, order_id: order.id })));

  if (itemsError) {
    // An order without its items is worse than no order: the kitchen would see
    // an empty ticket. Roll the header back.
    console.error("[orders:createTableOrder] items", itemsError.message);
    await supabase.from("orders").delete().eq("id", order.id);
    return { ok: false, error: "Could not save the ticket lines." };
  }

  // Decrement tracked stock. Non-fatal: the sale already happened at the
  // table; a failed counter update must not void it.
  for (const line of input.lines) {
    const item = menu.get(line.menuItemId)!;
    if (item.track_stock && item.stock_quantity !== null) {
      await supabase
        .from("menu_items")
        .update({ stock_quantity: Math.max(0, item.stock_quantity - line.quantity) })
        .eq("id", item.id);
    }
  }

  await supabase
    .from("restaurant_tables")
    .update({ status: "occupied" })
    .eq("id", table.id)
    .eq("status", "available");

  await recordHistory(order.id, "confirmed", { name: profile.name, email: profile.email }, `Table ${table.number}`);

  refreshOrderScreens();
  revalidatePath("/m/tables");
  return { ok: true, orderId: order.id, reference };
}
