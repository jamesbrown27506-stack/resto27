"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import { awardDeliveryPoints } from "@/lib/orders/award-points";
import { nextStatus, isTerminal, type OrderStatus } from "@/lib/format/order-status";
import { notify } from "@/lib/notify";

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
    .select("id, status, type, total, delivery_fee, delivery_fee_set_at, subtotal, reference, customer_id, restaurant_id, table_number")
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

  let target: OrderStatus = next;
  let quotedFee: number | undefined;

  if (next === "confirmed" && order.type === "delivery" && order.delivery_fee_set_at === null) {
    const fee = input.deliveryFee;
    // Zero is a legitimate quote ("we deliver free nearby") — only absence and
    // nonsense are refused. XAF is zero-decimal: whole francs or it is wrong.
    if (fee === undefined || !Number.isInteger(fee) || fee < 0) {
      return { ok: false, error: "Quote the delivery fee before confirming." };
    }

    /*
      THE ADVERTISED CEILING IS ENFORCED HERE, NOT ONLY IN THE DIALOG.

      The restaurant page and checkout now tell the customer "delivery
      1 000 – 3 000 FCFA" (migration 0035). A promise the customer read
      before ordering, that the confirmation screen can then ignore, is
      worse than never having made it — so the refusal lives on the server,
      where the dialog's own check cannot be the only thing standing between
      a customer and a fee they were told could not happen.

      Only the CEILING is enforced. Quoting BELOW the advertised minimum is
      a restaurant choosing to charge a customer less than it promised to,
      which needs no protection.
    */
    const { data: band } = await supabase
      .from("restaurants")
      .select("max_delivery_fee")
      .eq("id", active.restaurantId)
      .maybeSingle();

    const ceiling = Number(band?.max_delivery_fee) || 0;
    if (ceiling > 0 && fee > ceiling) {
      return {
        ok: false,
        error: `Your advertised maximum is ${ceiling.toLocaleString("fr-CM")} FCFA. The customer saw that before ordering — raise it in your profile first, or quote ${ceiling.toLocaleString("fr-CM")} FCFA or less.`,
      };
    }

    quotedFee = fee;

    /*
      ─────────────────────────────────────────────────────────────────────
       A FEE ABOVE ZERO STOPS HERE FOR THE CUSTOMER TO ACCEPT (0040).

       The customer committed to a total that did not include delivery, so
       raising it is a change to the deal they agreed to. Confirming straight
       through applied that change unilaterally AND told the kitchen to start
       — which meant food was cooked for orders customers then cancelled over
       the price. The refusal and the wasted dish were the same event.

       `awaiting_customer` is where it waits. `acceptDeliveryFee` moves it to
       `confirmed`, which is still the signal the kitchen starts on, so the
       kitchen only ever starts on an agreed price.

       A fee of zero skips the gate: "we deliver free" changes nothing the
       customer agreed to, so there is nothing to accept.
      ─────────────────────────────────────────────────────────────────────
    */
    if (fee > 0) target = "awaiting_customer";
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
      tone: target === "delivered" ? "success" : "info",
      customerId: order.customer_id,
      href: `/orders/${order.id}`,
      params: {
        status: target as NotifyOrderStatus,
        reference: order.reference,
        restaurantName: active.restaurantName,
        deliveryFee: quotedFee,
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
  const supabase = createAdminClient();

  if (input.lines.length === 0) return { ok: false, error: "The ticket is empty." };

  // The table must be this branch's. Its number is snapshotted onto the order.
  const { data: table } = await supabase
    .from("restaurant_tables")
    .select("id, number, status, capacity")
    .eq("id", input.tableId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!table) return { ok: false, error: "No such table at this branch." };
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
          params: { itemName: item.name, count: remaining },
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
