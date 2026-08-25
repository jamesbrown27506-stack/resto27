import "server-only";
import {
  customerTopicDefaults,
  readTopicPreferences,
  type CustomerTopicPreferences,
} from "@/lib/notifications/customer-topics";
import { createAdminClient } from "@/lib/supabase/server";
import type { OrderStatus, OrderType, PaymentMethod } from "@/lib/format/order-status";

/**
 * Customer-side reads — one signed-in diner's orders, reservations, reviews,
 * loyalty, addresses and favourites.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  EVERY FUNCTION HERE TAKES A profileId AND FILTERS ON IT.
 *
 *  Same rule as lib/data/manager.ts: these run with the service-role key,
 *  which bypasses RLS entirely, so the `.eq("customer_id"|"profile_id", …)`
 *  is the only thing standing between one customer and another's orders. The
 *  id must come from the SESSION (`requireUser()`), never from a URL.
 * ─────────────────────────────────────────────────────────────────────────
 */

/* ── Orders ────────────────────────────────────────────────────────────── */

export interface CustomerOrderItem {
  id: string;
  /** SNAPSHOT (§3): the dish as it was when ordered, whatever the menu says today. */
  name: string;
  quantity: number;
  /** Whole XAF, options included. */
  unitPrice: number;
  optionsLabel: string | null;
  notes: string | null;
}

export interface CustomerOrder {
  id: string;
  reference: string;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  status: OrderStatus;
  type: OrderType;
  paymentMethod: PaymentMethod | "mobile_money";
  isPaid: boolean;

  subtotal: number;
  discountAmount: number;
  serviceChargePercent: number;
  serviceCharge: number;
  deliveryFee: number;
  deliveryFeeSetAt: string | null;
  loyaltyValue: number;
  total: number;

  deliveryName: string | null;
  deliveryPhone: string | null;
  deliveryAddress: string | null;
  deliveryQuartier: string | null;
  deliveryLandmark: string | null;
  tableNumber: string | null;
  notes: string | null;
  promoCode: string | null;
  cancelledReason: string | null;
  deliveryRating: number | null;
  /** ISO timestamp for a scheduled order, null for ASAP. */
  scheduledFor: string | null;

  items: CustomerOrderItem[];
  history: { status: string; at: string; byName: string | null }[];
  createdAt: string;
}

const ORDER_COLUMNS =
  "id, reference, restaurant_id, customer_id, status, type, payment_method, is_paid, subtotal, discount_amount, service_charge_percent, service_charge, delivery_fee, delivery_fee_set_at, loyalty_value, total, delivery_name, delivery_phone, delivery_address, delivery_quartier, delivery_landmark, table_number, notes, promo_code, cancelled_reason, delivery_rating, scheduled_for, created_at, restaurants ( name, slug )";

interface DbOrder {
  id: string;
  reference: string;
  restaurant_id: string;
  customer_id: string | null;
  status: string;
  type: string;
  payment_method: string;
  is_paid: boolean;
  subtotal: number;
  discount_amount: number;
  service_charge_percent: number;
  service_charge: number;
  delivery_fee: number;
  delivery_fee_set_at: string | null;
  loyalty_value: number;
  total: number;
  delivery_name: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_quartier: string | null;
  delivery_landmark: string | null;
  table_number: string | null;
  notes: string | null;
  promo_code: string | null;
  cancelled_reason: string | null;
  delivery_rating: number | null;
  scheduled_for: string | null;
  created_at: string;
  restaurants: { name: string; slug: string }[] | null;
}

function shapeOrder(
  o: DbOrder,
  items: CustomerOrderItem[],
  history: CustomerOrder["history"],
): CustomerOrder {
  return {
    id: o.id,
    reference: o.reference,
    restaurantId: o.restaurant_id,
    restaurantName: o.restaurants?.[0]?.name ?? "",
    restaurantSlug: o.restaurants?.[0]?.slug ?? "",
    status: o.status as OrderStatus,
    type: o.type as OrderType,
    paymentMethod: o.payment_method as CustomerOrder["paymentMethod"],
    isPaid: o.is_paid,
    subtotal: o.subtotal,
    discountAmount: o.discount_amount,
    serviceChargePercent: Number(o.service_charge_percent),
    serviceCharge: o.service_charge,
    deliveryFee: o.delivery_fee,
    deliveryFeeSetAt: o.delivery_fee_set_at,
    loyaltyValue: o.loyalty_value,
    total: o.total,
    deliveryName: o.delivery_name,
    deliveryPhone: o.delivery_phone,
    deliveryAddress: o.delivery_address,
    deliveryQuartier: o.delivery_quartier,
    deliveryLandmark: o.delivery_landmark,
    tableNumber: o.table_number,
    notes: o.notes,
    promoCode: o.promo_code,
    cancelledReason: o.cancelled_reason,
    deliveryRating: o.delivery_rating,
    scheduledFor: o.scheduled_for,
    items,
    history,
    createdAt: o.created_at,
  };
}

async function fetchItemsFor(ids: string[]): Promise<Map<string, CustomerOrderItem[]>> {
  const map = new Map<string, CustomerOrderItem[]>();
  if (ids.length === 0) return map;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("order_items")
    .select("id, order_id, name, unit_price, quantity, options_label, notes")
    .in("order_id", ids)
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

async function fetchHistoryFor(ids: string[]): Promise<Map<string, CustomerOrder["history"]>> {
  const map = new Map<string, CustomerOrder["history"]>();
  if (ids.length === 0) return map;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("order_status_history")
    .select("order_id, status, by_name, created_at")
    .in("order_id", ids)
    .order("created_at");

  for (const h of (data ?? []) as {
    order_id: string;
    status: string;
    by_name: string | null;
    created_at: string;
  }[]) {
    const list = map.get(h.order_id) ?? [];
    list.push({ status: h.status, at: h.created_at, byName: h.by_name });
    map.set(h.order_id, list);
  }

  return map;
}

/** This customer's orders, newest first — capped like the manager's working list. */
export async function fetchCustomerOrders(
  profileId: string,
  limit = 100,
): Promise<CustomerOrder[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("customer_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[customer:fetchCustomerOrders]", error.message);
    return [];
  }

  const rows = (data ?? []) as DbOrder[];
  const [items, history] = await Promise.all([
    fetchItemsFor(rows.map((r) => r.id)),
    fetchHistoryFor(rows.map((r) => r.id)),
  ]);

  return rows.map((r) =>
    shapeOrder(r, items.get(r.id) ?? [], history.get(r.id) ?? []),
  );
}

/** One of this customer's orders, or null. */
export async function fetchCustomerOrder(
  profileId: string,
  orderId: string,
): Promise<CustomerOrder | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .eq("customer_id", profileId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as DbOrder;
  const [items, history] = await Promise.all([
    fetchItemsFor([row.id]),
    fetchHistoryFor([row.id]),
  ]);

  return {
    ...shapeOrder(row, items.get(row.id) ?? [], history.get(row.id) ?? []),
  };
}

/* ── Reservations ──────────────────────────────────────────────────────── */

export type CustomerReservationStatus = import("@/lib/format/reservation-status").CustomerReservationStatus;

export interface CustomerReservation {
  id: string;
  reference: string;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  /** UTC ISO. Rendered in Africa/Douala (§16). */
  reservedFor: string;
  /** How long the table remains active after its start time. */
  durationMin: number;
  partySize: number;
  tableNumber: string | null;
  status: CustomerReservationStatus;
  /**
   * What is owed to hold the table, snapshotted at booking (0025) — a total,
   * so a per-seat fee is already multiplied by the party size. Read alongside
   * `awaiting_payment` to show the customer what they are being asked for.
   */
  depositAmount: number;
  depositPaid: boolean;
  /** Latest unsettled CamerPay attempt, so a reload resumes the pending UI. */
  paymentAttemptId: string | null;
  /** The Mobile Money line used for that attempt (may differ from the profile). */
  paymentPhone: string | null;
  notes: string | null;
  createdAt: string;
}

export {
  RESERVATION_STATUS_TONE,
} from "@/lib/format/reservation-status";

export async function fetchCustomerReservations(
  profileId: string,
): Promise<CustomerReservation[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("reservations")
    .select(
      "id, reference, restaurant_id, reserved_for, duration_min, party_size, status, deposit_amount, deposit_paid, notes, created_at, restaurants ( name, slug ), restaurant_tables ( number )",
    )
    .eq("customer_id", profileId)
    .order("reserved_for", { ascending: false });

  if (error) {
    console.error("[customer:fetchCustomerReservations]", error.message);
    return [];
  }

  const reservations = ((data ?? []) as unknown as {
    id: string;
    reference: string;
    restaurant_id: string;
    reserved_for: string;
    duration_min: number;
    party_size: number;
    status: string;
    deposit_amount: number | null;
    deposit_paid: boolean | null;
    notes: string | null;
    created_at: string;
    restaurants: { name: string; slug: string }[] | null;
    restaurant_tables: { number: string }[] | null;
  }[]).map((r) => ({
    id: r.id,
    reference: r.reference,
    restaurantId: r.restaurant_id,
    restaurantName: r.restaurants?.[0]?.name ?? "",
    restaurantSlug: r.restaurants?.[0]?.slug ?? "",
    reservedFor: r.reserved_for,
    durationMin: Number(r.duration_min ?? 90),
    partySize: r.party_size,
    tableNumber: r.restaurant_tables?.[0]?.number ?? null,
    status: r.status as CustomerReservationStatus,
    depositAmount: Number(r.deposit_amount ?? 0),
    depositPaid: r.deposit_paid === true,
    paymentAttemptId: null,
    paymentPhone: null,
    notes: r.notes,
    createdAt: r.created_at,
  }));

  if (reservations.length === 0) return reservations;

  const { data: attempts, error: attemptsError } = await supabase
    .from("payment_attempts")
    .select("id, reservation_id, status, transaction_id, phone, created_at")
    .in("reservation_id", reservations.map((reservation) => reservation.id))
    .in("status", ["pending", "succeeded"])
    .is("settled_at", null)
    .order("created_at", { ascending: false });

  if (attemptsError) {
    console.error("[customer:fetchCustomerReservations] payment attempts", attemptsError.message);
    return reservations;
  }

  const latestByReservation = new Map<string, { id: string; phone: string | null }>();
  for (const attempt of attempts ?? []) {
    // A pending row without CamerPay's tracking id represents an inconclusive
    // transport error. The paying action deliberately permits a retry for it;
    // surfacing it as an active charge here would lock the customer forever.
    const trackable = attempt.status === "succeeded" || Boolean(attempt.transaction_id);
    if (
      trackable &&
      attempt.reservation_id &&
      !latestByReservation.has(attempt.reservation_id)
    ) {
      latestByReservation.set(attempt.reservation_id, {
        id: attempt.id,
        phone: attempt.phone,
      });
    }
  }

  return reservations.map((reservation) => {
    const attempt = latestByReservation.get(reservation.id);
    return {
      ...reservation,
      paymentAttemptId: attempt?.id ?? null,
      paymentPhone: attempt?.phone ?? null,
    };
  });
}

/* ── Reviews ───────────────────────────────────────────────────────────── */

export interface OwnReview {
  id: string;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  rating: number;
  body: string;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

/** The reviews this customer wrote, newest first. */
export async function fetchOwnReviews(profileId: string): Promise<OwnReview[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("reviews")
    .select(
      "id, restaurant_id, rating, body, reply, replied_at, created_at, restaurants ( name, slug )",
    )
    .eq("customer_id", profileId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[customer:fetchOwnReviews]", error.message);
    return [];
  }

  return ((data ?? []) as unknown as {
    id: string;
    restaurant_id: string;
    rating: number;
    body: string;
    reply: string | null;
    replied_at: string | null;
    created_at: string;
    restaurants: { name: string; slug: string }[] | null;
  }[]).map((r) => ({
    id: r.id,
    restaurantId: r.restaurant_id,
    restaurantName: r.restaurants?.[0]?.name ?? "",
    restaurantSlug: r.restaurants?.[0]?.slug ?? "",
    rating: r.rating,
    body: r.body,
    reply: r.reply,
    repliedAt: r.replied_at,
    createdAt: r.created_at,
  }));
}

/* ── Loyalty ───────────────────────────────────────────────────────────── */

export interface LoyaltyEntry {
  id: string;
  points: number;
  kind: "earn" | "redeem" | "adjust" | "expire" | "refund";
  /** Snapshot of why — shown verbatim on the history page. */
  note: string;
  orderId: string | null;
  orderReference: string | null;
  createdAt: string;
}

/** The append-only ledger (§3). Balance is SUM(points), never a stored counter. */
export async function fetchLoyaltyLedger(profileId: string): Promise<LoyaltyEntry[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("loyalty_ledger")
    .select("id, points, kind, note, order_id, created_at, orders ( reference )")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[customer:fetchLoyaltyLedger]", error.message);
    return [];
  }

  return ((data ?? []) as unknown as {
    id: string;
    points: number;
    kind: string;
    note: string;
    order_id: string | null;
    created_at: string;
    orders: { reference: string } | null;
  }[]).map((e) => ({
    id: e.id,
    points: e.points,
    kind: e.kind as LoyaltyEntry["kind"],
    note: e.note,
    orderId: e.order_id,
    orderReference: e.orders?.reference ?? null,
    createdAt: e.created_at,
  }));
}

/** SUM of the ledger — the one number the account header and basket need. */
export async function fetchLoyaltyBalance(profileId: string): Promise<number> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("loyalty_balance", { p_profile: profileId });
  if (error) {
    console.error("[customer:fetchLoyaltyBalance]", error.message);
    return 0;
  }
  return Number(data ?? 0);
}

/* ── Addresses ─────────────────────────────────────────────────────────── */

export interface CustomerAddress {
  id: string;
  label: string;
  recipientName: string | null;
  phone: string | null;
  addressLine: string;
  /** Denormalised at read time — the quartier's display name. */
  quartier: string;
  quartierId: string | null;
  landmark: string | null;
  isDefault: boolean;
}

/** This customer's saved delivery addresses, default first. */
export async function fetchCustomerAddresses(profileId: string): Promise<CustomerAddress[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("customer_addresses")
    .select("id, label, recipient_name, phone, address_line, quartier_id, landmark, is_default")
    .eq("profile_id", profileId)
    .order("created_at");

  if (error) {
    console.error("[customer:fetchCustomerAddresses]", error.message);
    return [];
  }

  const rows = (data ?? []) as {
    id: string;
    label: string;
    recipient_name: string | null;
    phone: string | null;
    address_line: string;
    quartier_id: string | null;
    landmark: string | null;
    is_default: boolean;
  }[];

  const quartierIds = [...new Set(rows.map((r) => r.quartier_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (quartierIds.length > 0) {
    const { data: quartiers } = await supabase
      .from("quartiers")
      .select("id, name")
      .in("id", quartierIds);
    for (const q of (quartiers ?? []) as { id: string; name: string }[]) {
      names.set(q.id, q.name);
    }
  }

  return rows
    .map((r) => ({
      id: r.id,
      label: r.label,
      recipientName: r.recipient_name,
      phone: r.phone,
      addressLine: r.address_line,
      quartier: r.quartier_id ? (names.get(r.quartier_id) ?? "") : "",
      quartierId: r.quartier_id,
      landmark: r.landmark,
      isDefault: r.is_default,
    }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/* ── Favourites ────────────────────────────────────────────────────────── */

/** The restaurants this customer has favourited, as the public sees them. */
export async function fetchFavoriteRestaurantIds(profileId: string): Promise<string[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("favorites")
    .select("restaurant_id")
    .eq("profile_id", profileId);

  if (error) {
    console.error("[customer:fetchFavoriteRestaurantIds]", error.message);
    return [];
  }

  return ((data ?? []) as { restaurant_id: string }[]).map((f) => f.restaurant_id);
}

/* ── Preferences ───────────────────────────────────────────────────────── */

/**
 * One customer's answers: every topic, every channel.
 *
 * This was four flat booleans plus one account-wide push flag, where each
 * boolean meant "in-app AND email together". A customer could not stop being
 * emailed about an order without also stopping being told about it — which is
 * the complaint this shape exists to answer. The catalogue and the merge rules
 * live in lib/notifications/customer-topics, which the settings screen imports
 * too so both sides read one definition.
 */
export type CustomerPreferences = CustomerTopicPreferences;

export const CUSTOMER_PREFERENCES_DEFAULT: CustomerPreferences = customerTopicDefaults();

/** The stored notification prefs, or the defaults when no row exists yet. */
export async function fetchCustomerPreferences(
  profileId: string,
): Promise<CustomerPreferences> {
  const supabase = createAdminClient();

  /*
    ONLY `notification_json` IS ASKED FOR, AND THAT IS THE FIX.

    This selected `notification_json, push_enabled`, and `push_enabled` — added
    by migration 0018 — is absent from the live database. PostgREST answers a
    select naming a column that does not exist with 42703 for every row, so
    this function returned the defaults on EVERY load while quietly discarding
    whatever the customer had actually chosen. The matching upsert failed the
    same way, which is why the table is empty: no customer preference has ever
    been stored.

    Nothing needs the column any more. The per-topic push answer lives inside
    notification_json, and the legacy fallback below only matters for rows in
    the old boolean shape — of which there are none here, and on a database
    that does have some, `true` reproduces the default they were running under.
  */
  const { data, error } = await supabase
    .from("customer_preferences")
    .select("notification_json")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    console.error("[customer:fetchCustomerPreferences]", error.message);
    return customerTopicDefaults();
  }
  if (!data) return customerTopicDefaults();

  return readTopicPreferences((data as { notification_json: unknown }).notification_json, true);
}
