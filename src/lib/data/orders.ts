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
  paymentMethod: PaymentMethod | "mobile_money";
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

  items: OrderItemRow[];
}

const ORDER_COLUMNS =
  "id, reference, status, type, payment_method, is_paid, subtotal, discount_amount, service_charge, delivery_fee, delivery_fee_set_at, total, delivery_name, delivery_phone, delivery_address, delivery_quartier, delivery_landmark, table_number, notes, cancelled_reason, created_at";

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
  created_at: string;
}

function shape(o: DbOrder, items: OrderItemRow[]): ManagerOrder {
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
    deliveryPhone: o.delivery_phone,
    deliveryAddress: o.delivery_address,
    deliveryQuartier: o.delivery_quartier,
    deliveryLandmark: o.delivery_landmark,
    tableNumber: o.table_number,
    notes: o.notes,
    cancelledReason: o.cancelled_reason,
    createdAt: o.created_at,
    items,
  };
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
  const items = await fetchItemsFor(rows.map((r) => r.id));
  return rows.map((r) => shape(r, items.get(r.id) ?? []));
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

  return {
    ...shape(data as DbOrder, items.get(orderId) ?? []),
    history: ((history ?? []) as { status: string; by_name: string | null; note: string | null; created_at: string }[]).map(
      (h) => ({ status: h.status, byName: h.by_name, note: h.note, createdAt: h.created_at }),
    ),
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
  const items = await fetchItemsFor(rows.map((r) => r.id));
  return rows.map((r) => shape(r, items.get(r.id) ?? []));
}
