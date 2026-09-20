"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import { awardDeliveryPoints } from "@/lib/orders/award-points";
import { nextStatus, isTerminal, type OrderStatus } from "@/lib/format/order-status";
import { notify } from "@/lib/notify";
import { orderPaymentInFlight } from "@/lib/payments/collect";
import { PICKUP_RECEIPT_CONFIRMATION_NOTE } from "@/lib/orders/pickup-receipt";
import { onsiteOrdersAllowed } from "@/lib/billing/plan-access";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";
import { fetchTableAccess } from "./table-access";
import { canCloseDiningOrder } from "@/lib/dining/access";

/**
 * The statuses `notify` has copy for. `awaiting_customer` is included: the
 * customer needs to hear that a fee is waiting on them more than they need to
 * hear about any other step.
 */
type NotifyOrderStatus = "awaiting_customer" | "confirmed" | "preparing" | "shipped" | "delivered";
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
    .select("id, status, type, total, delivery_fee, delivery_fee_set_at, is_paid, payment_method, subtotal, reference, customer_id, restaurant_id, table_number")
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
    is_paid: boolean;
    payment_method: string;
    subtotal: number;
    reference: string;
    customer_id: string | null;
    restaurant_id: string;
    table_number: string | null;
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
  revalidatePath("/m/tables");
}

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

  if (next === "delivered" && order.type === "dine_in") {
    // Separate read keeps pre-0054 databases compatible: a missing dining_sessions
    // table behaves like an ordinary waiter-entered dine-in order.
    const { data: diningSession } = await supabase
      .from("dining_sessions")
      .select("id")
      .eq("order_id", order.id)
      .in("status", ["open", "payment_requested"])
      .maybeSingle();
    if (!canCloseDiningOrder(Boolean(diningSession), order.is_paid)) {
      return { ok: false, error: "Collect or request payment before closing this table." };
    }
  }

  if (next === "delivered" && order.type === "pickup") {
    return {
      ok: false,
      error: "Ask the customer to confirm collection instead of closing this pickup directly.",
    };
  }

  let target: OrderStatus = next;
  let quotedFee: number | undefined;

  if (next === "awaiting_customer" && order.type === "delivery" && order.delivery_fee_set_at === null) {
    const fee = input.deliveryFee;
    // Zero is a legitimate quote ("we deliver free nearby") — only absence and
    // nonsense are refused. XAF is zero-decimal: whole francs or it is wrong.
    if (fee === undefined || !Number.isInteger(fee) || fee < 0) {
      return { ok: false, error: "Quote the delivery fee before confirming." };
    }

    const { data: band } = await supabase
      .from("restaurants")
      .select("max_delivery_fee")
      .eq("id", active.restaurantId)
      .maybeSingle();

    const ceiling = Number(band?.max_delivery_fee) || 0;
    if (ceiling > 0 && fee > ceiling) {
      return {
        ok: false,
        error: `Your advertised maximum is ${ceiling.toLocaleString("fr-CM")} FCFA. Quote that amount or less.`,
      };
    }

    quotedFee = fee;

    // Restaurant acceptance creates the final payable amount. It never starts
    // preparation; only a confirmed customer payment moves this order forward.
    target = "awaiting_customer";
  }

  const patch: Record<string, unknown> = { status: target };

  if (quotedFee !== undefined) {
    patch.delivery_fee = quotedFee;
    patch.delivery_fee_set_at = new Date().toISOString();
    // The total is raised as soon as the fee is quoted, whether or not the
    // customer has accepted yet — the Accept screen has to show the real
    // number, and a declined order is cancelled rather than reverted.
    patch.total = order.total + quotedFee;
  }

  if (target === "delivered") {
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

  // The meal is over — the table goes back to the floor, unless another
  // party is still mid-service on it (releaseTableIfFree re-checks).
  if (target === "delivered" && order.type === "dine_in") {
    await releaseTableIfFree(supabase, active.restaurantId, order.table_number);
  }

  await recordHistory(orderId, target, { name: profile.name, email: profile.email });

  if (target === "delivered") await awardDeliveryPoints(order);

  // The customer hears about every step — and about the quoted fee, which
  // changed the total they committed to.
  if (order.customer_id) {
    await notify({
      event: "order_status",
      // A pickup order turning "ready" is the one push asking the customer
      // to stand up — it earns the success tone the moment it happens.
      tone:
        target === "delivered" || (target === "shipped" && order.type === "pickup")
          ? "success"
          : "info",
      customerId: order.customer_id,
      href: `/orders/${order.id}`,
      params: {
        status: target as NotifyOrderStatus,
        reference: order.reference,
        restaurantName: active.restaurantName,
        deliveryFee: quotedFee,
        orderType: order.type as "delivery" | "pickup" | "dine_in",
      },
    });
  }

  refreshOrderScreens();
  revalidatePath(`/m/orders/${orderId}`);
  revalidatePath("/loyalty");
  revalidatePath("/account");
  return { ok: true, status: target };
}



/**
 * Ask the signed-in pickup customer to confirm that the food was handed over.
 * The status stays shipped: only that customer can close the order as collected.
 */
export async function requestPickupReceiptConfirmation(orderId: string): Promise<ActionResult> {
  const { active, profile } = await requireCapability("orders.advance");
  const supabase = createAdminClient();
  const order = await loadOrder(active.restaurantId, orderId);

  if (!order) return { ok: false, error: "Order not found." };
  if (order.type !== "pickup") return { ok: false, error: "Only pickup orders need collection confirmation." };
  if (order.status !== "shipped") {
    return { ok: false, error: "Mark the pickup ready before asking the customer to confirm collection." };
  }
  if (!order.customer_id) {
    return {
      ok: false,
      error: "This pickup was placed without a customer account, so Resto237 cannot request an in-app confirmation.",
    };
  }

  const { data: existing } = await supabase
    .from("order_status_history")
    .select("id")
    .eq("order_id", order.id)
    .eq("status", "shipped")
    .eq("note", PICKUP_RECEIPT_CONFIRMATION_NOTE)
    .limit(1)
    .maybeSingle();

  if (existing) return { ok: true };

  await recordHistory(order.id, "shipped", { name: profile.name, email: profile.email }, PICKUP_RECEIPT_CONFIRMATION_NOTE);

  await notify({
    event: "order_status",
    tone: "info",
    customerId: order.customer_id,
    href: "/orders/" + order.id,
    params: {
      status: "shipped",
      reference: order.reference,
      restaurantName: active.restaurantName,
      orderType: "pickup",
      pickupReceiptConfirmation: true,
    },
  });

  refreshOrderScreens();
  revalidatePath("/m/orders/" + orderId);
  revalidatePath("/orders");
  revalidatePath("/orders/" + orderId);
  return { ok: true };
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

  /*
    A PAID ORDER IS NOT THE RESTAURANT'S TO CANCEL ALONE.

    Its money is already in the wallet, and there is no automated refund yet:
    cancelling here would keep the customer's payment and send them nothing.
    Support cancels it and refunds the customer. And while a prompt is still
    open on the customer's phone, the payment may land a second after the
    cancellation — so that waits too.
  */
  if (order.payment_method === "mobile_money" && order.is_paid) {
    return {
      ok: false,
      error: "This order is paid online, so the customer must be refunded. Contact Resto237 support to cancel it.",
    };
  }
  if (order.payment_method === "mobile_money" && (await orderPaymentInFlight(orderId))) {
    return { ok: false, error: "The customer is paying right now. Wait a few minutes before cancelling." };
  }

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

  // The customer reads the reason on the order page; the notification is how
  // they know to look.
  if (order.customer_id) {
    await notify({
      event: "order_cancelled",
      tone: "error",
      customerId: order.customer_id,
      href: `/orders/${order.id}`,
      params: {
        reference: order.reference,
        restaurantName: active.restaurantName,
        cancelledBy: "restaurant",
        reason: reason.trim(),
      },
    });
  }

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
  /** People sitting at the table — 1..capacity. Optional: a walk-in waiter
   *  who never asks still gets a valid order. */
  guests?: number;
}): Promise<ActionResult & { orderId?: string; reference?: string }> {
  const { active, profile } = await requireCapability("orders.advance");
  if (!onsiteOrdersAllowed(active)) {
    return { ok: false, error: DICTIONARIES[await getLocale()]["mgate.onsiteRequired"] };
  }
  const supabase = createAdminClient();

  if (input.lines.length === 0) return { ok: false, error: "The ticket is empty." };

  // The table must be this branch's. Its number is snapshotted onto the order.
  const access = await fetchTableAccess(active.restaurantId).catch(() => null);
  if (!access) return { ok: false, error: DICTIONARIES[await getLocale()]["tbl.accessError"] };
  const table = access.tables.find((table) => table.id === input.tableId);

  if (!table) return { ok: false, error: "No such table at this branch." };
  if (table.planLocked) return { ok: false, error: DICTIONARIES[await getLocale()]["tbl.frozenError"] };
  if (table.status === "out_of_service") return { ok: false, error: "That table is out of service." };

  const guests = input.guests ?? null;
  if (guests !== null && (!Number.isInteger(guests) || guests < 1 || guests > table.capacity)) {
    return { ok: false, error: `Party size must be between 1 and ${table.capacity}.` };
  }

  // ── Reprice every line from the database ────────────────────────────────
  const itemIds = [...new Set(input.lines.map((l) => l.menuItemId))];
  const { data: menuRows } = await supabase
    .from("menu_items")
    .select("id, name, price, is_available, track_stock, stock_quantity, low_stock_threshold")
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
      low_stock_threshold: number | null;
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

  // Cash / pay-at-restaurant does not pass through the payment gateway.
  // The online service fee is added only if staff later requests Mobile Money.
  const chargePercent = 0;
  const serviceCharge = 0;

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
      party_size: guests,
      payment_method: "pay_at_restaurant",
      notes: input.notes?.trim() || null,
    })
    .select("id, total")
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
  const lowStockNotified = new Set<string>();
  for (const line of input.lines) {
    const item = menu.get(line.menuItemId)!;
    if (item.track_stock && item.stock_quantity !== null) {
      const remaining = Math.max(0, item.stock_quantity - line.quantity);
      await supabase
        .from("menu_items")
        .update({ stock_quantity: remaining })
        .eq("id", item.id);

      if (
        item.low_stock_threshold !== null &&
        remaining <= item.low_stock_threshold &&
        item.stock_quantity > item.low_stock_threshold &&
        !lowStockNotified.has(item.id)
      ) {
        lowStockNotified.add(item.id);
        await notify({
          event: "low_stock",
          tone: "warning",
          restaurantId: active.restaurantId,
          href: "/m/menu",
          // Item name keys the collapse tag — two dishes, two banners.
          params: { itemName: item.name, count: remaining, reference: item.name },
        });
      }
    }
  }

  await supabase
    .from("restaurant_tables")
    .update({ status: "occupied" })
    .eq("id", table.id)
    .eq("status", "available");

  await recordHistory(order.id, "confirmed", { name: profile.name, email: profile.email }, `Table ${table.number}`);

  // The kitchen queue is fed by the same rows as online orders; the
  // notification is the same "new order" the branch would get from a customer.
  await notify({
    event: "new_order",
    tone: "info",
    restaurantId: active.restaurantId,
    href: `/m/orders/${order.id}`,
    params: { reference, customerName: `Table ${table.number}`, amount: order.total },
  });

  refreshOrderScreens();
  revalidatePath("/m/tables");
  return { ok: true, orderId: order.id, reference };
}
