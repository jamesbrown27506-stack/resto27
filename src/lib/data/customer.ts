import "server-only";
import {
  customerTopicDefaults,
  readTopicPreferences,
  type CustomerTopicPreferences,
} from "@/lib/notifications/customer-topics";
import { createAdminClient } from "@/lib/supabase/server";
import type { OrderStatus, OrderType, PaymentMethod } from "@/lib/format/order-status";
import { orderDeadline } from "@/lib/orders/deadline";
import { getTimeLimits } from "@/lib/orders/time-limit-settings";
import { isReviewReaction, type ReviewReaction } from "@/lib/reviews/attention";

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
  /** The live dish this line came from — null when the dish was deleted. Reorder uses it. */
  menuItemId: string | null;
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
  paymentMethod: PaymentMethod;
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
  history: { status: string; at: string; byName: string | null; note: string | null }[];
  createdAt: string;

  /** The restaurant's advertised delivery estimate, minutes (ETA after payment). */
  deliveryEstimateMin: number | null;
  /**
   * Filled only by fetchCustomerOrder (the detail page): the time limit this
   * order's current wait runs out at (0059), the refund of a cancelled paid
   * order, the payment attempt still live on the customer's phone, and the
   * wallet balance that decides whether "pay with wallet" is offered.
   */
  deadline?: string | null;
  refund?: { amount: number; status: "pending" | "completed" | "rejected"; destination: "mobile_money" | "customer_wallet" } | null;
  openPayment?: { attemptId: string; phone: string | null } | null;
  walletBalance?: number;
}

const ORDER_COLUMNS =
  "id, reference, restaurant_id, customer_id, status, type, payment_method, is_paid, subtotal, discount_amount, service_charge_percent, service_charge, delivery_fee, delivery_fee_set_at, loyalty_value, total, delivery_name, delivery_phone, delivery_address, delivery_quartier, delivery_landmark, table_number, notes, promo_code, cancelled_reason, delivery_rating, scheduled_for, created_at, restaurants ( name, slug, delivery_estimate_min )";

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
  restaurants: { name: string; slug: string; delivery_estimate_min?: number | null }[] | { name: string; slug: string; delivery_estimate_min?: number | null } | null;
}

/** PostgREST returns a to-one embed as an object, older typings as an array. */
function embedded(o: DbOrder) {
  return Array.isArray(o.restaurants) ? o.restaurants[0] : o.restaurants;
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
    restaurantName: embedded(o)?.name ?? "",
    restaurantSlug: embedded(o)?.slug ?? "",
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
    deliveryEstimateMin: Number(embedded(o)?.delivery_estimate_min) || null,
  };
}

async function fetchItemsFor(ids: string[]): Promise<Map<string, CustomerOrderItem[]>> {
  const map = new Map<string, CustomerOrderItem[]>();
  if (ids.length === 0) return map;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("order_items")
    .select("id, order_id, menu_item_id, name, unit_price, quantity, options_label, notes")
    .in("order_id", ids)
    .order("created_at");

  for (const row of (data ?? []) as {
    id: string;
    order_id: string;
    menu_item_id: string | null;
    name: string;
    unit_price: number;
    quantity: number;
    options_label: string | null;
    notes: string | null;
  }[]) {
    const list = map.get(row.order_id) ?? [];
    list.push({
      id: row.id,
      menuItemId: row.menu_item_id,
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
    .select("order_id, status, by_name, note, created_at")
    .in("order_id", ids)
    .order("created_at");

  for (const h of (data ?? []) as {
    order_id: string;
    status: string;
    by_name: string | null;
    note: string | null;
    created_at: string;
  }[]) {
    const list = map.get(h.order_id) ?? [];
    list.push({ status: h.status, at: h.created_at, byName: h.by_name, note: h.note });
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

  const order = shapeOrder(row, items.get(row.id) ?? [], history.get(row.id) ?? []);

  // ── Detail-only facts: deadline, refund, live payment, wallet ──────────
  const [limits, refundRow, attemptRow, walletRow] = await Promise.all([
    getTimeLimits(),
    supabase
      .from("refunds")
      .select("amount, status, raw_response")
      .eq("order_id", row.id)
      .eq("type", "refund")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    order.status === "awaiting_customer" && !order.isPaid
      ? supabase
          .from("payment_attempts")
          .select("id, phone, created_at")
          .eq("raw_response->>orderId", row.id)
          .eq("status", "pending")
          .gt("created_at", new Date(Date.now() - 5 * 60_000).toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("customer_wallets").select("balance").eq("profile_id", profileId).maybeSingle(),
  ]);

  const acceptedAt = [...order.history].reverse().find((h) => h.status === "awaiting_customer")?.at ?? null;
  const deadline = orderDeadline(
    { status: order.status, createdAt: order.createdAt, scheduledFor: order.scheduledFor, acceptedAt },
    limits.orderMinutes,
  );
  const refund = refundRow.data as { amount: number; status: string; raw_response: { destination?: string } | null } | null;
  const attempt = attemptRow.data as { id: string; phone: string | null } | null;

  return {
    ...order,
    deadline: deadline ? deadline.toISOString() : null,
    refund: refund
      ? {
          amount: Number(refund.amount),
          status: refund.status as "pending" | "completed" | "rejected",
          destination: refund.raw_response?.destination === "customer_wallet" ? "customer_wallet" : "mobile_money",
        }
      : null,
    openPayment: attempt ? { attemptId: attempt.id, phone: attempt.phone } : null,
    walletBalance: Number((walletRow.data as { balance?: number } | null)?.balance ?? 0),
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
  refundId: string | null;
  refundStatus: "pending" | "completed" | "rejected" | null;
  refundAmount: number;
  restaurantCompensation: number;
  platformFee: number;
  refundBalanceAfter: number | null;
  /** Where the refund went: the customer's wallet (customer cancel) or back to Mobile Money (restaurant cancel). */
  refundDestination: "customer_wallet" | "mobile_money" | null;
  /** The restaurant's words when it declined or cancelled the booking. */
  declineReason: string | null;
  notes: string | null;
  createdAt: string;
  /** 0068 — the booking voucher (R237-XXXX-XXXX), shown as a QR at the door. */
  voucherCode: string | null;
  voucherRedeemedAt: string | null;
  occasion: string | null;
  seatingPreference: string | null;
  isGroupRequest: boolean;
  /** A change the customer asked for that the restaurant has not answered. */
  pendingChange: { reservedFor: string; partySize: number; requestedAt: string } | null;
  /** The payment service fee paid on top of the deposit. */
  depositFee: number;
  /** Already reviewed after the visit. */
  reviewed: boolean;
  /** For "Itinéraire" — a place, never a phone number. */
  restaurantAddress: string | null;
}

export interface CustomerWaitlistEntry {
  id: string;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  date: string;
  time: string;
  partySize: number;
  status: "waiting" | "notified";
}

/** The customer's live waitlist entries (0068). Empty on a database without it. */
export async function fetchCustomerWaitlist(profileId: string): Promise<CustomerWaitlistEntry[]> {
  const { data, error } = await createAdminClient()
    .from("reservation_waitlist")
    .select("id, restaurant_id, wanted_date, wanted_time, party_size, status, restaurants ( name, slug )")
    .eq("customer_id", profileId)
    .in("status", ["waiting", "notified"])
    .gte("wanted_date", new Date().toISOString().slice(0, 10))
    .order("wanted_date");
  if (error) return [];
  return ((data ?? []) as unknown as {
    id: string; restaurant_id: string; wanted_date: string; wanted_time: string; party_size: number; status: "waiting" | "notified";
    restaurants: { name: string; slug: string } | { name: string; slug: string }[] | null;
  }[]).map((row) => {
    const restaurant = Array.isArray(row.restaurants) ? row.restaurants[0] : row.restaurants;
    return {
      id: row.id,
      restaurantId: row.restaurant_id,
      restaurantName: restaurant?.name ?? "",
      restaurantSlug: restaurant?.slug ?? "",
      date: row.wanted_date,
      time: row.wanted_time,
      partySize: row.party_size,
      status: row.status,
    };
  });
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
      "id, reference, restaurant_id, reserved_for, duration_min, party_size, status, deposit_amount, deposit_paid, notes, decline_reason, created_at, restaurants ( name, slug ), restaurant_tables ( number )",
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
    decline_reason: string | null;
    created_at: string;
    restaurants: { name: string; slug: string } | { name: string; slug: string }[] | null;
    restaurant_tables: { number: string } | { number: string }[] | null;
  }[]).map((r) => ({
    id: r.id,
    reference: r.reference,
    restaurantId: r.restaurant_id,
    // A many-to-one embed comes back as an object; older typings said array.
    restaurantName: (Array.isArray(r.restaurants) ? r.restaurants[0] : r.restaurants)?.name ?? "",
    restaurantSlug: (Array.isArray(r.restaurants) ? r.restaurants[0] : r.restaurants)?.slug ?? "",
    reservedFor: r.reserved_for,
    durationMin: Number(r.duration_min ?? 90),
    partySize: r.party_size,
    tableNumber: (Array.isArray(r.restaurant_tables) ? r.restaurant_tables[0] : r.restaurant_tables)?.number ?? null,
    status: r.status as CustomerReservationStatus,
    depositAmount: Number(r.deposit_amount ?? 0),
    depositPaid: r.deposit_paid === true,
    paymentAttemptId: null,
    paymentPhone: null,
    refundId: null,
    refundStatus: null,
    refundAmount: 0,
    restaurantCompensation: 0,
    platformFee: 0,
    refundBalanceAfter: null,
    refundDestination: null,
    declineReason: r.decline_reason ?? null,
    notes: r.notes,
    createdAt: r.created_at,
    voucherCode: null as string | null,
    voucherRedeemedAt: null as string | null,
    occasion: null as string | null,
    seatingPreference: null as string | null,
    isGroupRequest: false,
    pendingChange: null as CustomerReservation["pendingChange"],
    depositFee: 0,
    reviewed: false,
    restaurantAddress: null as string | null,
  }));

  if (reservations.length === 0) return reservations;

  /*
    THE 0068 DETAILS, READ ON THEIR OWN.

    A separate query so a database that has not run 0068 still lists every
    booking — only the voucher, occasion and change fields stay empty.
  */
  const ids = reservations.map((reservation) => reservation.id);
  const [extras, reviewRows, places] = await Promise.all([
    supabase
      .from("reservations")
      .select("id, voucher_code, voucher_redeemed_at, occasion, seating_preference, is_group_request, pending_change, deposit_fee")
      .in("id", ids),
    supabase.from("reviews").select("reservation_id").in("reservation_id", ids),
    supabase
      .from("restaurants")
      .select("id, name, address_line, quartiers ( name )")
      .in("id", [...new Set(reservations.map((reservation) => reservation.restaurantId))]),
  ]);
  const extraById = new Map(
    (extras.error ? [] : (extras.data ?? []) as {
      id: string; voucher_code: string | null; voucher_redeemed_at: string | null; occasion: string | null;
      seating_preference: string | null; is_group_request: boolean | null;
      pending_change: { reservedFor?: string; partySize?: number; requestedAt?: string } | null; deposit_fee: number | null;
    }[]).map((row) => [row.id, row]),
  );
  const reviewed = new Set(
    (reviewRows.error ? [] : (reviewRows.data ?? []) as { reservation_id: string | null }[])
      .map((row) => row.reservation_id).filter(Boolean),
  );
  const addressById = new Map(
    ((places.data ?? []) as { id: string; address_line: string | null; quartiers: { name: string } | { name: string }[] | null }[])
      .map((row) => {
        const quartier = Array.isArray(row.quartiers) ? row.quartiers[0] : row.quartiers;
        return [row.id, [row.address_line, quartier?.name].filter(Boolean).join(", ") || null] as const;
      }),
  );
  for (const reservation of reservations) {
    const extra = extraById.get(reservation.id);
    reservation.restaurantAddress = addressById.get(reservation.restaurantId) ?? null;
    reservation.reviewed = reviewed.has(reservation.id);
    if (!extra) continue;
    reservation.voucherCode = extra.voucher_code;
    reservation.voucherRedeemedAt = extra.voucher_redeemed_at;
    reservation.occasion = extra.occasion;
    reservation.seatingPreference = extra.seating_preference;
    reservation.isGroupRequest = Boolean(extra.is_group_request);
    reservation.depositFee = Number(extra.deposit_fee ?? 0);
    reservation.pendingChange = extra.pending_change?.reservedFor
      ? {
          reservedFor: extra.pending_change.reservedFor,
          partySize: Number(extra.pending_change.partySize ?? reservation.partySize),
          requestedAt: extra.pending_change.requestedAt ?? "",
        }
      : null;
  }

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

  const { data: refundRows, error: refundsError } = await supabase
    .from("refunds")
    .select("id, reservation_id, status, amount, restaurant_compensation, platform_fee, raw_response")
    .in("reservation_id", reservations.map((reservation) => reservation.id));

  if (refundsError) {
    console.error("[customer:fetchCustomerReservations] refunds", refundsError.message);
  }
  const refundByReservation = new Map(
    (refundRows ?? [])
      .filter((refund) => Boolean(refund.reservation_id))
      .map((refund) => [
        refund.reservation_id as string,
        {
          id: refund.id as string,
          status: refund.status as "pending" | "completed" | "rejected",
          amount: Number(refund.amount),
          restaurantCompensation: Number(refund.restaurant_compensation ?? 0),
          platformFee: Number(refund.platform_fee ?? 0),
          balanceAfter: typeof (refund.raw_response as { balanceAfter?: unknown } | null)?.balanceAfter === "number"
            ? Number((refund.raw_response as { balanceAfter: number }).balanceAfter)
            : null,
          destination:
            (refund.raw_response as { destination?: string } | null)?.destination === "mobile_money"
              ? ("mobile_money" as const)
              : ("customer_wallet" as const),
        },
      ]),
  );

  return reservations.map((reservation) => {
    const attempt = latestByReservation.get(reservation.id);
    const refund = refundByReservation.get(reservation.id);
    return {
      ...reservation,
      paymentAttemptId: attempt?.id ?? null,
      paymentPhone: attempt?.phone ?? null,
      refundId: refund?.id ?? null,
      refundStatus: refund?.status ?? null,
      refundAmount: refund?.amount ?? 0,
      restaurantCompensation: refund?.restaurantCompensation ?? 0,
      platformFee: refund?.platformFee ?? 0,
      refundBalanceAfter: refund?.balanceAfter ?? null,
      refundDestination: refund?.destination ?? null,
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
  /** The restaurant's one-tap reaction (0066). */
  reaction: ReviewReaction | null;
}

/** The reviews this customer wrote, newest first. */
export async function fetchOwnReviews(profileId: string): Promise<OwnReview[]> {
  const supabase = createAdminClient();

  const base = "id, restaurant_id, rating, body, reply, replied_at, created_at, restaurants ( name, slug )";
  const query = (columns: string) =>
    supabase.from("reviews").select(columns).eq("customer_id", profileId).order("created_at", { ascending: false });
  let { data, error } = await query(`${base}, restaurant_reaction`);
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    ({ data, error } = await query(base));
  }

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
    restaurant_reaction?: string | null;
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
    reaction: isReviewReaction(r.restaurant_reaction) ? r.restaurant_reaction : null,
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


export interface CustomerWalletSummary {
  balance: number;
  available: boolean;
}

/** Current customer wallet balance. Missing migration fails closed. */
export async function fetchCustomerWalletSummary(profileId: string): Promise<CustomerWalletSummary> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("customer_wallets")
    .select("balance")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) {
    console.warn("[customer:wallet]", error.message);
    return { balance: 0, available: false };
  }
  return { balance: Number(data?.balance ?? 0), available: true };
}
