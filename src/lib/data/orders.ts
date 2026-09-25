import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import type { OrderStatus, OrderType, PaymentMethod } from "@/lib/format/order-status";

/**
 * Order reads for the restaurant dashboard.
 *
 * Every function takes a restaurantId and filters on it — the tenant boundary,
 * same rule as lib/data/manager.ts. These run with the service-role key, so
 * the `.eq("restaurant_id", …)` IS the security, not a convenience.
 */

export interface OrderItemRow {
  id: string;
  /** SNAPSHOTS. The dish may have been renamed or deleted since (§12 rule 7). */
  name: string;
  unitPrice: number;
  quantity: number;
  optionsLabel: string | null;
  notes: string | null;
}

export interface OrderEvent {
  status: string;
  byName: string | null;
  note: string | null;
  createdAt: string;
}

export interface ManagerOrder {
  id: string;
  reference: string;
  status: OrderStatus;
  type: OrderType;
  paymentMethod: PaymentMethod;
  isPaid: boolean;

  subtotal: number;
  discountAmount: number;
  serviceCharge: number;
  /** QUOTED, not calculated (§4). 0 until the restaurant sets it on confirm. */
  deliveryFee: number;
  deliveryFeeSetAt: string | null;
  total: number;

  deliveryName: string | null;
  deliveryPhone: string | null;
  deliveryAddress: string | null;
  deliveryQuartier: string | null;
  deliveryLandmark: string | null;
  tableNumber: string | null;

  notes: string | null;
  cancelledReason: string | null;
  createdAt: string;

  /** ISO timestamp for a scheduled order, null for ASAP (checkout page). */
  scheduledFor: string | null;

  /**
   * When the restaurant accepted (the first `awaiting_customer` history row).
   * The customer's pay-by clock starts here (lib/orders/deadline). Read only
   * for orders currently awaiting payment; null otherwise.
   */
  acceptedAt: string | null;
  /**
   * When the order became `confirmed` — i.e. was PAID (payment first). The
   * kitchen's timer counts from here: the minutes an order spent waiting for
   * the customer's Mobile Money are not minutes the kitchen was late.
   * Filled by the kitchen queue only.
   */
  confirmedAt: string | null;

  items: OrderItemRow[];
}

const ORDER_COLUMNS =
  "id, reference, status, type, payment_method, is_paid, subtotal, discount_amount, service_charge, delivery_fee, delivery_fee_set_at, total, delivery_name, delivery_phone, delivery_address, delivery_quartier, delivery_landmark, table_number, notes, cancelled_reason, scheduled_for, created_at";

interface DbOrder {
  id: string;
  reference: string;
  status: string;
  type: string;
  payment_method: string;
  is_paid: boolean;
  subtotal: number;
  discount_amount: number;
  service_charge: number;
  delivery_fee: number;
  delivery_fee_set_at: string | null;
  total: number;
  delivery_name: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_quartier: string | null;
  delivery_landmark: string | null;
  table_number: string | null;
  notes: string | null;
  cancelled_reason: string | null;
  scheduled_for: string | null;
  created_at: string;
}

/*
  ─────────────────────────────────────────────────────────────────────────
   THE CUSTOMER'S NUMBER — ONLY WHILE THE FOOD IS ON ITS WAY.

   Platform rule (Sep 2026): restaurants and customers talk through the
   in-app chat, never by phone — a number the rider keeps is a number used to
   take the next order off the platform. The ONE exception the owner allows
   is a delivery in progress: a rider at the gate whose customer does not
   answer the chat must be able to call. So the number is released for a
   PAID delivery that is confirmed, preparing or out for delivery, and blanked
   again the moment it is delivered or cancelled. Blanked here, at the one
   place every manager read passes through.
  ─────────────────────────────────────────────────────────────────────────
*/
export function phoneVisibleToRestaurant(o: { type: string; is_paid: boolean; status: string }): boolean {
  return o.type === "delivery" && o.is_paid && ["confirmed", "preparing", "shipped"].includes(o.status);
}

function shape(o: DbOrder, items: OrderItemRow[], times: StatusTimes = {}): ManagerOrder {
  return {
    id: o.id,
    reference: o.reference,
    status: o.status as OrderStatus,
    type: o.type as OrderType,
    paymentMethod: o.payment_method as ManagerOrder["paymentMethod"],
    isPaid: o.is_paid,
    subtotal: o.subtotal,
    discountAmount: o.discount_amount,
    serviceCharge: o.service_charge,
    deliveryFee: o.delivery_fee,
    deliveryFeeSetAt: o.delivery_fee_set_at,
    total: o.total,
    deliveryName: o.delivery_name,
    deliveryPhone: phoneVisibleToRestaurant(o) ? o.delivery_phone : null,
    deliveryAddress: o.delivery_address,
    deliveryQuartier: o.delivery_quartier,
    deliveryLandmark: o.delivery_landmark,
    tableNumber: o.table_number,
    notes: o.notes,
    cancelledReason: o.cancelled_reason,
    scheduledFor: o.scheduled_for,
    createdAt: o.created_at,
    acceptedAt: times.awaiting_customer ?? null,
    confirmedAt: times.confirmed ?? null,
    items,
  };
}

/** First time an order entered a status, per status. */
type StatusTimes = Partial<Record<"awaiting_customer" | "confirmed", string>>;

/**
 * The first `awaiting_customer` / `confirmed` history row per order — one
 * query for a whole list, grouped in memory. Only asked for the orders that
 * need it (awaiting payment on the queue, the kitchen's tickets), so a
 * hundred-row queue does not drag a hundred histories along.
 */
async function fetchStatusTimes(
  orderIds: string[],
  statuses: (keyof StatusTimes)[],
): Promise<Map<string, StatusTimes>> {
  const map = new Map<string, StatusTimes>();
  if (orderIds.length === 0 || statuses.length === 0) return map;

  const { data, error } = await createAdminClient()
    .from("order_status_history")
    .select("order_id, status, created_at")
    .in("order_id", orderIds)
    .in("status", statuses)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[orders:fetchStatusTimes]", error.message);
    return map;
  }

  for (const row of (data ?? []) as { order_id: string; status: keyof StatusTimes; created_at: string }[]) {
    const times = map.get(row.order_id) ?? {};
    // Ascending order: the first write wins, which is the moment it ENTERED.
    if (!times[row.status]) times[row.status] = row.created_at;
    map.set(row.order_id, times);
  }
  return map;
}

/** Items for a set of orders, one query, grouped in memory. */
async function fetchItemsFor(orderIds: string[]): Promise<Map<string, OrderItemRow[]>> {
  const map = new Map<string, OrderItemRow[]>();
  if (orderIds.length === 0) return map;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("order_items")
    .select("id, order_id, name, unit_price, quantity, options_label, notes")
    .in("order_id", orderIds)
    .order("created_at");

  for (const row of (data ?? []) as {
    id: string;
    order_id: string;
    name: string;
    unit_price: number;
    quantity: number;
    options_label: string | null;
    notes: string | null;
  }[]) {
    const list = map.get(row.order_id) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      unitPrice: row.unit_price,
      quantity: row.quantity,
      optionsLabel: row.options_label,
      notes: row.notes,
    });
    map.set(row.order_id, list);
  }

  return map;
}

/** The queue: newest first, capped — /m/orders is a working screen, not an archive. */
export async function fetchOrders(restaurantId: string, limit = 100): Promise<ManagerOrder[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[orders:fetchOrders]", error.message);
    return [];
  }

  const rows = (data ?? []) as DbOrder[];
  const awaiting = rows.filter((r) => r.status === "awaiting_customer").map((r) => r.id);
  const [items, times] = await Promise.all([
    fetchItemsFor(rows.map((r) => r.id)),
    // The pay-by countdown on the queue needs when each was accepted.
    fetchStatusTimes(awaiting, ["awaiting_customer"]),
  ]);
  return rows.map((r) => shape(r, items.get(r.id) ?? [], times.get(r.id)));
}

/** One order, scoped to the branch so an id from a URL cannot cross tenants. */
export async function fetchOrder(
  restaurantId: string,
  orderId: string,
): Promise<(ManagerOrder & { history: OrderEvent[] }) | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .eq("id", orderId)
    .maybeSingle();

  if (error || !data) return null;

  const [items, { data: history }] = await Promise.all([
    fetchItemsFor([orderId]),
    supabase
      .from("order_status_history")
      .select("status, by_name, note, created_at")
      .eq("order_id", orderId)
      .order("created_at"),
  ]);

  const events = ((history ?? []) as { status: string; by_name: string | null; note: string | null; created_at: string }[]).map(
    (h) => ({ status: h.status, byName: h.by_name, note: h.note, createdAt: h.created_at }),
  );
  // The history is already here, ordered — the status times come free.
  const times: StatusTimes = {
    awaiting_customer: events.find((e) => e.status === "awaiting_customer")?.createdAt,
    confirmed: events.find((e) => e.status === "confirmed")?.createdAt,
  };

  return {
    ...shape(data as DbOrder, items.get(orderId) ?? [], times),
    history: events,
  };
}

/**
 * The kitchen queue: confirmed + preparing, OLDEST FIRST (§14.4).
 *
 * Pending is deliberately absent — an unconfirmed order is not the kitchen's
 * yet, and for delivery it may still be missing its quoted fee.
 */
export async function fetchKitchenQueue(restaurantId: string): Promise<ManagerOrder[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .in("status", ["confirmed", "preparing"])
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[orders:fetchKitchenQueue]", error.message);
    return [];
  }

  const rows = (data ?? []) as DbOrder[];
  const ids = rows.map((r) => r.id);
  const [items, times] = await Promise.all([
    fetchItemsFor(ids),
    // The ticket timer starts at payment, not at placement — see confirmedAt.
    fetchStatusTimes(ids, ["confirmed"]),
  ]);
  return rows.map((r) => shape(r, items.get(r.id) ?? [], times.get(r.id)));
}
