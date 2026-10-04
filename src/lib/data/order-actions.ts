"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { releaseTableIfFree } from "@/lib/orders/table-release";
import { requireCapability } from "@/lib/auth/branch";
import { awardDeliveryPoints } from "@/lib/orders/award-points";
import { nextStatus, isTerminal, type OrderStatus } from "@/lib/format/order-status";
import { notify } from "@/lib/notify";
import { orderPaymentInFlight } from "@/lib/payments/collect";
import { cancelPaidOrder } from "@/lib/payments/order-refunds";
import { releaseOrderHoldings } from "@/lib/orders/cancellation-effects";
import { getTimeLimits } from "@/lib/orders/time-limit-settings";
import { PICKUP_RECEIPT_CONFIRMATION_NOTE } from "@/lib/orders/pickup-receipt";
import { onsiteOrdersAllowed } from "@/lib/billing/plan-access";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale, getTranslator } from "@/lib/i18n/locale-server";
import { fetchTableAccess } from "./table-access";
import { canCloseDiningOrder } from "@/lib/dining/access";
import { computeTotals } from "@/lib/orders/totals";
import { isPriceInRange } from "@/lib/menu/custom-price";

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
/**
 * The confirmed prices of an order's customizable dishes (0069), checked and
 * turned into the new order figures. Null when nothing is to confirm.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Acceptance is the one moment this can happen: the customer has not paid
 *  yet (payment-first, 0059), so the total they are asked for is the
 *  confirmed one. Every price must be inside the range the line was sold
 *  under — the same promise as the delivery fee ceiling — and the new total
 *  comes from computeTotals, the one money function, with the order's own
 *  snapshotted discount, service-charge rate and loyalty value.
 * ─────────────────────────────────────────────────────────────────────────
 */
async function confirmCustomPrices(
  orderId: string,
  prices: Record<string, number> | undefined,
): Promise<
  | { ok: true; lines: { id: string; price: number }[]; subtotal: number; serviceCharge: number; total: number }
  | { ok: true; lines: null }
  | { ok: false; key: "est.customPricesRequired" | "est.customPriceOutOfRange" }
> {
  const supabase = createAdminClient();
  const [{ data: items, error }, { data: order }] = await Promise.all([
    supabase
      .from("order_items")
      .select("id, unit_price, quantity, price_to_confirm, price_min, price_max, price_confirmed_at")
      .eq("order_id", orderId),
    supabase
      .from("orders")
      .select("discount_amount, service_charge_percent, loyalty_value")
      .eq("id", orderId)
      .maybeSingle(),
  ]);
  // No 0069 columns: nothing can be to confirm.
  if (error || !items) return { ok: true, lines: null };
  const rows = items as {
    id: string; unit_price: number; quantity: number; price_to_confirm: boolean | null;
    price_min: number | null; price_max: number | null; price_confirmed_at: string | null;
  }[];
  const pending = rows.filter((row) => row.price_to_confirm && !row.price_confirmed_at);
  if (pending.length === 0) return { ok: true, lines: null };

  const lines: { id: string; price: number }[] = [];
  for (const row of pending) {
    const price = Math.round(Number(prices?.[row.id]));
    if (!Number.isFinite(price)) return { ok: false, key: "est.customPricesRequired" };
    if (!isPriceInRange(price, row.price_min ?? row.unit_price, row.price_max)) {
      return { ok: false, key: "est.customPriceOutOfRange" };
    }
    lines.push({ id: row.id, price });
  }

  const byId = new Map(lines.map((line) => [line.id, line.price]));
  const subtotal = rows.reduce((sum, row) => sum + (byId.get(row.id) ?? row.unit_price) * row.quantity, 0);
  const snapshot = (order ?? {}) as { discount_amount?: number; service_charge_percent?: number; loyalty_value?: number };
  const totals = computeTotals({
    subtotal,
    discount: Number(snapshot.discount_amount ?? 0),
    serviceChargePercent: Number(snapshot.service_charge_percent ?? 0),
    // The delivery fee is paid in cash to the rider and never in the online total (0059).
    deliveryFee: 0,
    loyaltyValue: Number(snapshot.loyalty_value ?? 0),
  });
  return { ok: true, lines, subtotal: totals.subtotal, serviceCharge: totals.serviceCharge, total: totals.total };
}

export async function advanceOrder(
  orderId: string,
  input: {
    deliveryFee?: number;
    /** order_items.id → confirmed unit price, for customizable dishes (0069). */
    itemPrices?: Record<string, number>;
  } = {},
): Promise<ActionResult & { status?: OrderStatus }> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("orders.advance");
  const supabase = createAdminClient();

  const order = await loadOrder(active.restaurantId, orderId);
  if (!order) return { ok: false, error: t("ecu.orderNotFound") };

  const next = nextStatus(order.status);
  if (!next) return { ok: false, error: t("est.orderFinished") };

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
      return { ok: false, error: t("est.collectBeforeClosing") };
    }
  }

  if (next === "delivered" && order.type === "pickup") {
    return {
      ok: false,
      error: t("est.askPickupConfirm"),
    };
  }

  let target: OrderStatus = next;
  let quotedFee: number | undefined;

  // Accepting an order with customizable dishes needs their prices first.
  const custom = order.status === "pending" ? await confirmCustomPrices(order.id, input.itemPrices) : null;
  if (custom && !custom.ok) return { ok: false, error: t(custom.key) };
  const confirmedPrices = custom && custom.ok && custom.lines ? custom : null;

  if (next === "awaiting_customer" && order.type === "delivery" && order.delivery_fee_set_at === null) {
    const fee = input.deliveryFee;
    // Zero is a legitimate quote ("we deliver free nearby") — only absence and
    // nonsense are refused. XAF is zero-decimal: whole francs or it is wrong.
    if (fee === undefined || !Number.isInteger(fee) || fee < 0) {
      return { ok: false, error: t("est.quoteFeeFirst") };
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
        error: t("est.feeAboveMax", { amount: ceiling.toLocaleString("fr-CM") }),
      };
    }

    quotedFee = fee;

    // Restaurant acceptance creates the final payable amount. It never starts
    // preparation; only a confirmed customer payment moves this order forward.
    target = "awaiting_customer";
  }

  const patch: Record<string, unknown> = { status: target };

  if (confirmedPrices) {
    patch.subtotal = confirmedPrices.subtotal;
    patch.service_charge = confirmedPrices.serviceCharge;
    patch.total = confirmedPrices.total;
  }

  if (quotedFee !== undefined) {
    /*
      THE DELIVERY FEE IS PAID IN CASH TO THE RIDER — NOT ONLINE (0059).

      It used to be added to `total` here, which made the customer pay it by
      Mobile Money and left wallet orders unpayable when the balance covered
      the food but not the fee. The quote is still recorded (the customer
      must know what to hand the rider, and the ticket shows what to
      collect), but `total` stays exactly the amount paid online — which is
      what settlement, refunds and the restaurant's wallet are computed on.
    */
    patch.delivery_fee = quotedFee;
    patch.delivery_fee_set_at = new Date().toISOString();
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
    return { ok: false, error: t("est.orderUpdateFailed") };
  }

  // The confirmed prices land on the lines once the order itself moved (the
  // status guard above is what stops two tabs confirming different prices).
  if (confirmedPrices?.lines) {
    const stamp = new Date().toISOString();
    for (const line of confirmedPrices.lines) {
      const { error: lineError } = await supabase
        .from("order_items")
        .update({ unit_price: line.price, price_confirmed_at: stamp })
        .eq("id", line.id)
        .eq("order_id", orderId);
      if (lineError) console.error("[orders:advanceOrder] price", line.id, lineError.message);
    }
  }
  const payableTotal = confirmedPrices?.total ?? order.total;

  // The meal is over — the table goes back to the floor, unless another
  // party is still mid-service on it (releaseTableIfFree re-checks).
  if (target === "delivered" && order.type === "dine_in") {
    await releaseTableIfFree(supabase, active.restaurantId, order.table_number);
  }

  await recordHistory(orderId, target, { name: profile.name, email: profile.email });

  if (target === "delivered") await awardDeliveryPoints(order);

  // Acceptance starts the customer's payment clock (0059): the push says
  // how much to pay and by when, so nobody learns the deadline by missing it.
  let payBy: string | undefined;
  if (target === "awaiting_customer") {
    const { orderMinutes } = await getTimeLimits();
    payBy = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Douala", hour: "2-digit", minute: "2-digit" })
      .format(new Date(Date.now() + orderMinutes * 60_000));
  }

  // The customer hears about every step — and about the quoted fee, which
  // they will hand to the rider in cash.
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
      // `?pay=1` marks "please pay": the customer's app chimes for a minute.
      href: target === "awaiting_customer" ? `/orders/${order.id}?pay=1` : `/orders/${order.id}`,
      params: {
        status: target as NotifyOrderStatus,
        reference: order.reference,
        restaurantName: active.restaurantName,
        deliveryFee: quotedFee,
        orderType: order.type as "delivery" | "pickup" | "dine_in",
        amount: target === "awaiting_customer" ? payableTotal : undefined,
        whenLabel: payBy,
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
  const t = await getTranslator();
  const { active, profile } = await requireCapability("orders.advance");
  const supabase = createAdminClient();
  const order = await loadOrder(active.restaurantId, orderId);

  if (!order) return { ok: false, error: t("ecu.orderNotFound") };
  if (order.type !== "pickup") return { ok: false, error: t("est.onlyPickupConfirm") };
  if (order.status !== "shipped") {
    return { ok: false, error: t("est.markPickupReady") };
  }
  if (!order.customer_id) {
    return {
      ok: false,
      error: t("est.pickupNoAccount"),
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
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A PAID ORDER CAN BE CANCELLED NOW — AND THE CUSTOMER IS REFUNDED.
 *
 *  It used to be refused ("contact support") because nothing could send the
 *  money back, while the customer was told "contact the restaurant": a paid
 *  order with no exit on either side. cancelPaidOrder() cancels, claws back
 *  the restaurant's credit and owes the customer the full amount in one
 *  transaction, then starts the Mobile Money payout (wallet-paid orders are
 *  credited back at once).
 *
 *  Still refused while a payment prompt is open on the customer's phone: the
 *  PIN could land a second after the cancellation. (If it does anyway, the
 *  late payment is refunded automatically — collect.ts.)
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function cancelOrder(orderId: string, reason: string): Promise<ActionResult> {
  const { active, profile } = await requireCapability("orders.cancel");
  const t = await getTranslator();

  if (reason.trim().length < 3) {
    return { ok: false, error: t("est.cancelReasonRequired") };
  }

  const order = await loadOrder(active.restaurantId, orderId);
  if (!order) return { ok: false, error: t("ecu.orderNotFound") };
  if (isTerminal(order.status)) {
    return { ok: false, error: t("est.orderFinished") };
  }

  if (order.payment_method === "mobile_money" && !order.is_paid && (await orderPaymentInFlight(orderId))) {
    return { ok: false, error: t("est.customerPayingNow") };
  }

  const paidOnline = order.is_paid && (order.payment_method === "mobile_money" || order.payment_method === "wallet");
  if (paidOnline) {
    const result = await cancelPaidOrder({
      orderId,
      actor: profile.name || profile.email,
      reason: reason.trim(),
      restaurantName: active.restaurantName,
      by: "restaurant",
    });
    if (!result.ok) {
      const error =
        result.reason === "insufficientBalance"
          ? t("est.refundBalanceShort")
          : result.reason === "migrationMissing"
            ? t("est.autoRefundDisabled")
            : t("est.orderCancelFailed");
      return { ok: false, error };
    }
    refreshOrderScreens();
    revalidatePath(`/m/orders/${orderId}`);
    revalidatePath("/m/wallet");
    return {
      ok: true,
      note: t("est.orderCancelledRefund", { amount: result.refundAmount ?? 0 }),
    };
  }

  const supabase = createAdminClient();
  const { data: cancelled, error } = await supabase
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_reason: reason.trim(),
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("restaurant_id", active.restaurantId)
    // Same guard as every other transition: a payment or another tap that
    // moved it first wins, and this cancels nothing.
    .eq("status", order.status)
    .eq("is_paid", false)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: t("est.orderCancelFailed") };
  if (!cancelled) {
    return { ok: false, error: t("est.orderChangedRetry") };
  }

  await recordHistory(orderId, "cancelled", { name: profile.name, email: profile.email }, reason.trim());
  await releaseOrderHoldings(orderId);

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
  /** Customizable dish (0069): the waiter's price, checked against its range. */
  unitPrice?: number;
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
  const t = await getTranslator();
  const { active, profile } = await requireCapability("orders.advance");
  if (!onsiteOrdersAllowed(active)) {
    return { ok: false, error: DICTIONARIES[await getLocale()]["mgate.onsiteRequired"] };
  }
  const supabase = createAdminClient();

  if (input.lines.length === 0) return { ok: false, error: t("est.ticketEmpty") };

  // The table must be this branch's. Its number is snapshotted onto the order.
  const access = await fetchTableAccess(active.restaurantId).catch(() => null);
  if (!access) return { ok: false, error: DICTIONARIES[await getLocale()]["tbl.accessError"] };
  const table = access.tables.find((table) => table.id === input.tableId);

  if (!table) return { ok: false, error: t("est.noSuchTable") };
  if (table.planLocked) return { ok: false, error: DICTIONARIES[await getLocale()]["tbl.frozenError"] };
  if (table.status === "out_of_service") return { ok: false, error: t("est.tableOutOfService") };

  const guests = input.guests ?? null;
  if (guests !== null && (!Number.isInteger(guests) || guests < 1 || guests > table.capacity)) {
    return { ok: false, error: t("est.partySize", { max: table.capacity }) };
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

  // Customizable dishes (0069): the waiter prices them on the line, in range.
  const { data: pricingRows } = await supabase
    .from("menu_items")
    .select("id, price_to_confirm, price_max")
    .eq("restaurant_id", active.restaurantId)
    .in("id", itemIds);
  const pricing = new Map(
    ((pricingRows ?? []) as { id: string; price_to_confirm: boolean | null; price_max: number | null }[])
      .map((row) => [row.id, row]),
  );

  /*
    Options are read WITH the dish they belong to, and a line may only use
    its own dish's options. Read by id alone, any option on the platform —
    another restaurant's "-5 000 F" — priced this restaurant's ticket.
  */
  const optionIds = [...new Set(input.lines.flatMap((l) => l.optionIds))];
  const { data: optionRows } = optionIds.length
    ? await supabase
        .from("menu_options")
        .select("id, name, price_delta, menu_option_groups!inner ( menu_item_id )")
        .in("id", optionIds)
    : { data: [] };
  const options = new Map(
    ((optionRows ?? []) as unknown as {
      id: string;
      name: string;
      price_delta: number;
      menu_option_groups: { menu_item_id: string } | { menu_item_id: string }[] | null;
    }[]).map((o) => {
      const group = Array.isArray(o.menu_option_groups) ? o.menu_option_groups[0] : o.menu_option_groups;
      return [o.id, { name: o.name, price_delta: o.price_delta, menuItemId: group?.menu_item_id ?? null }];
    }),
  );

  let subtotal = 0;
  const itemInserts: Record<string, unknown>[] = [];

  for (const line of input.lines) {
    const item = menu.get(line.menuItemId);
    if (!item) return { ok: false, error: t("est.dishGone") };
    if (!item.is_available) return { ok: false, error: t("est.soldOut", { name: item.name }) };
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50) {
      return { ok: false, error: t("est.invalidQuantity") };
    }
    if (item.track_stock && item.stock_quantity !== null && item.stock_quantity < line.quantity) {
      return { ok: false, error: t("est.lowStock", { count: String(item.stock_quantity), name: item.name }) };
    }

    const chosen = line.optionIds.map((id) => options.get(id));
    if (chosen.some((o) => !o || o.menuItemId !== line.menuItemId)) {
      return { ok: false, error: t("est.optionNotOnDish", { name: item.name }) };
    }
    const basePrice = item.price + chosen.reduce((sum, o) => sum + (o?.price_delta ?? 0), 0);
    if (basePrice < 0) return { ok: false, error: t("est.invalidPrice") };

    const custom = pricing.get(line.menuItemId);
    let unitPrice = basePrice;
    if (custom?.price_to_confirm) {
      const max = Math.max(basePrice, (custom.price_max ?? item.price) + (basePrice - item.price));
      unitPrice = line.unitPrice === undefined ? basePrice : Math.round(Number(line.unitPrice));
      if (!isPriceInRange(unitPrice, basePrice, max)) return { ok: false, error: t("est.customPriceOutOfRange") };
    }

    subtotal += unitPrice * line.quantity;
    itemInserts.push({
      menu_item_id: line.menuItemId,
      name: item.name,
      unit_price: unitPrice,
      quantity: line.quantity,
      options_label: chosen.map((o) => o?.name ?? "").filter(Boolean).join(" · ") || null,
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
    return { ok: false, error: t("est.orderCreateFailed") };
  }

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(itemInserts.map((i) => ({ ...i, order_id: order.id })));

  if (itemsError) {
    // An order without its items is worse than no order: the kitchen would see
    // an empty ticket. Roll the header back.
    console.error("[orders:createTableOrder] items", itemsError.message);
    await supabase.from("orders").delete().eq("id", order.id);
    return { ok: false, error: t("est.ticketLinesFailed") };
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
