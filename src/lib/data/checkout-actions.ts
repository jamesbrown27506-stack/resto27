"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { getCartConfig } from "@/lib/orders/cart-config";
import { discountFor } from "@/lib/orders/promotions";
import { computeTotals } from "@/lib/orders/totals";


/**
 * PLACING AN ORDER — the one path by which a customer's basket becomes a row.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE CLIENT SENDS IDS AND QUANTITIES. NOTHING ELSE IS BELIEVED.
 *
 *  Not the price, not the dish name, not the discount, not the total. Every
 *  one of those is re-read from the database here, exactly as
 *  `createTableOrder` does for a waiter. A Server Action is a public POST
 *  endpoint: whatever the basket component computed is a suggestion from an
 *  attacker-controlled process, and the only figures that reach `orders` are
 *  the ones this function derived.
 *
 *  A tampered request can order a lot of food. It cannot reprice it.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * GUESTS MAY ORDER (§2). `customer_id` is null for them and the delivery name
 * and phone carry the identity — forcing registration before someone can buy
 * is the single biggest drop-off in food ordering.
 */

export interface CheckoutLine {
  menuItemId: string;
  quantity: number;
  optionIds: string[];
  notes?: string | null;
}

export interface CheckoutInput {
  restaurantId: string;
  type: "delivery" | "pickup";
  lines: CheckoutLine[];

  /** Required for delivery, ignored for pickup. */
  addressId?: string | null;
  deliveryName?: string;
  deliveryPhone?: string;
  deliveryAddress?: string;
  deliveryQuartier?: string | null;
  deliveryLandmark?: string | null;

  promoCode?: string | null;
  loyaltyPoints?: number;
  paymentMethod?: string;
  notes?: string | null;
}

/** Reason CODES, not prose — checkout is bilingual and the client translates. */
export type CheckoutResult =
  | { ok: true; orderId: string; reference: string }
  | { ok: false; reason: string; detail?: string };

const MAX_QTY_PER_LINE = 50;

export async function placeOrder(input: CheckoutInput): Promise<CheckoutResult> {
  const supabase = createAdminClient();

  if (!input.lines?.length) return { ok: false, reason: "emptyBasket" };
  if (input.type !== "delivery" && input.type !== "pickup") {
    return { ok: false, reason: "badType" };
  }

  // ── The restaurant must actually be open for business ───────────────────
  const { data: restaurantRow } = await supabase
    .from("restaurants")
    .select("id, name, status, is_accepting_orders, accepts_delivery, accepts_pickup, minimum_order")
    .eq("id", input.restaurantId)
    .maybeSingle();

  const restaurant = restaurantRow as {
    id: string;
    name: string;
    status: string;
    is_accepting_orders: boolean;
    accepts_delivery: boolean;
    accepts_pickup: boolean;
    minimum_order: number;
  } | null;

  if (!restaurant || restaurant.status !== "active") return { ok: false, reason: "restaurantUnavailable" };
  if (!restaurant.is_accepting_orders) return { ok: false, reason: "notAcceptingOrders" };
  if (input.type === "delivery" && !restaurant.accepts_delivery) return { ok: false, reason: "noDelivery" };
  if (input.type === "pickup" && !restaurant.accepts_pickup) return { ok: false, reason: "noPickup" };

  // ── Reprice every line from the database ────────────────────────────────
  const itemIds = [...new Set(input.lines.map((l) => l.menuItemId))];
  const { data: menuRows } = await supabase
    .from("menu_items")
    .select("id, name, price, is_available, track_stock, stock_quantity")
    // Scoped to THIS restaurant: without it, an id from another tenant's menu
    // would be priced and sold by a kitchen that has never heard of it.
    .eq("restaurant_id", input.restaurantId)
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

  const optionIds = [...new Set(input.lines.flatMap((l) => l.optionIds ?? []))];
  const { data: optionRows } = optionIds.length
    ? await supabase
        .from("menu_options")
        // Only options belonging to this restaurant's menu items, proven by the
        // join — menu_options has no restaurant_id of its own.
        .select("id, name, price_delta, is_available, group_id, menu_option_groups!inner(menu_item_id)")
        .in("id", optionIds)
    : { data: [] };

  const options = new Map(
    ((optionRows ?? []) as unknown as {
      id: string;
      name: string;
      price_delta: number;
      is_available: boolean;
      menu_option_groups: { menu_item_id: string };
    }[]).map((o) => [o.id, o]),
  );

  let subtotal = 0;
  const itemInserts: Record<string, unknown>[] = [];

  for (const line of input.lines) {
    const item = menu.get(line.menuItemId);
    if (!item) return { ok: false, reason: "itemGone" };
    if (!item.is_available) return { ok: false, reason: "itemSoldOut", detail: item.name };

    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QTY_PER_LINE) {
      return { ok: false, reason: "badQuantity" };
    }
    if (item.track_stock && item.stock_quantity !== null && item.stock_quantity < line.quantity) {
      return { ok: false, reason: "notEnoughStock", detail: item.name };
    }

    const chosen: { name: string; price_delta: number }[] = [];
    for (const id of line.optionIds ?? []) {
      const option = options.get(id);
      // An option that does not exist, is unavailable, or belongs to a
      // DIFFERENT dish is refused rather than silently dropped — dropping it
      // would serve a customer something other than what they chose.
      if (!option) return { ok: false, reason: "optionGone" };
      if (!option.is_available) return { ok: false, reason: "optionUnavailable", detail: option.name };
      if (option.menu_option_groups?.menu_item_id !== line.menuItemId) {
        return { ok: false, reason: "optionMismatch" };
      }
      chosen.push({ name: option.name, price_delta: option.price_delta });
    }

    const unitPrice = item.price + chosen.reduce((sum, o) => sum + o.price_delta, 0);
    if (unitPrice < 0) return { ok: false, reason: "badPrice" };

    subtotal += unitPrice * line.quantity;
    itemInserts.push({
      menu_item_id: line.menuItemId,
      // Snapshotted (§12): the receipt still reads correctly after the dish is
      // renamed, repriced or deleted.
      name: item.name,
      unit_price: unitPrice,
      quantity: line.quantity,
      options_label: chosen.map((o) => o.name).join(" · ") || null,
      notes: line.notes?.trim() || null,
    });
  }

  if (subtotal <= 0) return { ok: false, reason: "emptyBasket" };

  // The restaurant's own floor, checked on food only — a minimum that a
  // delivery fee could satisfy is not a minimum.
  if (restaurant.minimum_order > 0 && subtotal < restaurant.minimum_order) {
    return { ok: false, reason: "belowMinimum", detail: String(restaurant.minimum_order) };
  }

  // ── Promotion, re-validated ─────────────────────────────────────────────
  let discount = 0;
  let promoCode: string | null = null;
  let promoId: string | null = null;

  if (input.promoCode?.trim()) {
    const code = input.promoCode.trim().toUpperCase();
    const { data: promoRow } = await supabase
      .from("promotions")
      .select("id, code, discount_type, discount_value, min_order, max_discount, starts_at, ends_at, usage_limit, used_count, is_active")
      .eq("restaurant_id", input.restaurantId)
      .eq("code", code)
      .maybeSingle();

    const promo = promoRow as {
      id: string;
      code: string;
      discount_type: string;
      discount_value: number;
      min_order: number;
      max_discount: number | null;
      starts_at: string | null;
      ends_at: string | null;
      usage_limit: number | null;
      used_count: number;
      is_active: boolean;
    } | null;

    // Refused, not ignored. Dropping an invalid code and charging full price
    // is how someone pays more than the screen told them they would.
    if (!promo || !promo.is_active) return { ok: false, reason: "promoInvalid" };

    const now = Date.now();
    if (promo.starts_at && now < new Date(promo.starts_at).getTime()) return { ok: false, reason: "promoInvalid" };
    if (promo.ends_at && now > new Date(promo.ends_at).getTime()) return { ok: false, reason: "promoExpired" };
    if (promo.usage_limit !== null && promo.used_count >= promo.usage_limit) {
      return { ok: false, reason: "promoUsedUp" };
    }
    if (subtotal < promo.min_order) return { ok: false, reason: "promoMinimum", detail: String(promo.min_order) };

    discount = discountFor(promo, subtotal);
    promoCode = promo.code;
    promoId = promo.id;
  }

  // ── Loyalty, re-validated ───────────────────────────────────────────────
  const config = await getCartConfig();
  const profile = await getCurrentProfile();

  let pointsUsed = 0;
  let loyaltyValue = 0;

  if (config.loyaltyEnabled && profile && (input.loyaltyPoints ?? 0) > 0) {
    const requested = Math.floor(input.loyaltyPoints ?? 0);
    const { data: balanceData } = await supabase.rpc("loyalty_balance", { p_profile: profile.id });
    const balance = Number(balanceData ?? 0);

    if (requested > balance) return { ok: false, reason: "notEnoughPoints" };
    if (requested < config.minRedeem) return { ok: false, reason: "belowMinPoints", detail: String(config.minRedeem) };

    // Capped at the food value: points must not pay the service charge or the
    // rider, and must never drive the total below zero.
    const netFood = Math.max(0, subtotal - discount);
    loyaltyValue = Math.min(requested * config.pointValue, netFood);
    pointsUsed = config.pointValue > 0 ? Math.ceil(loyaltyValue / config.pointValue) : 0;
  }

  const totals = computeTotals({
    subtotal,
    discount,
    serviceChargePercent: config.serviceChargePercent,
    // Quoted by the restaurant when it confirms (§4). Never guessed here.
    deliveryFee: 0,
    loyaltyValue,
  });

  // ── Delivery details ────────────────────────────────────────────────────
  let deliveryName = input.deliveryName?.trim() ?? profile?.name ?? "";
  let deliveryPhone = input.deliveryPhone?.trim() ?? profile?.phone ?? "";
  let addressLine = input.deliveryAddress?.trim() ?? "";
  let quartier = input.deliveryQuartier?.trim() || null;
  let landmark = input.deliveryLandmark?.trim() || null;

  if (input.type === "delivery" && input.addressId && profile) {
    // A saved address is re-read rather than trusted from the form, and scoped
    // to the person asking — an id from someone else's account must not
    // resolve into this order.
    const { data: saved } = await supabase
      .from("customer_addresses")
      .select("recipient_name, phone, address_line, landmark, quartiers ( name )")
      .eq("id", input.addressId)
      .eq("profile_id", profile.id)
      .maybeSingle();

    const row = saved as unknown as {
      recipient_name: string | null;
      phone: string | null;
      address_line: string;
      landmark: string | null;
      quartiers: { name: string }[] | null;
    } | null;

    if (!row) return { ok: false, reason: "addressNotFound" };

    deliveryName = row.recipient_name?.trim() || deliveryName;
    deliveryPhone = row.phone?.trim() || deliveryPhone;
    addressLine = row.address_line;
    quartier = row.quartiers?.[0]?.name ?? quartier;
    landmark = row.landmark ?? landmark;
  }

  if (!deliveryName) return { ok: false, reason: "nameRequired" };
  if (!deliveryPhone) return { ok: false, reason: "phoneRequired" };
  if (input.type === "delivery" && !addressLine) return { ok: false, reason: "addressRequired" };

  // ── Write ───────────────────────────────────────────────────────────────
  const reference = `CMD-${randomUUID().slice(0, 6).toUpperCase()}`;

  const { data: created, error } = await supabase
    .from("orders")
    .insert({
      reference,
      restaurant_id: input.restaurantId,
      customer_id: profile?.id ?? null,
      type: input.type,
      // PENDING, not confirmed. The restaurant accepts it — that is what §4's
      // whole flow is about, and it is where the delivery fee gets quoted.
      status: "pending",
      subtotal: totals.subtotal,
      discount_amount: totals.discount,
      service_charge_percent: config.serviceChargePercent,
      service_charge: totals.serviceCharge,
      loyalty_points_used: pointsUsed,
      loyalty_value: totals.loyaltyValue,
      total: totals.total,
      delivery_fee: 0,
      promo_code: promoCode,
      delivery_name: deliveryName,
      delivery_phone: deliveryPhone,
      delivery_address: input.type === "delivery" ? addressLine : null,
      delivery_quartier: input.type === "delivery" ? quartier : null,
      delivery_landmark: input.type === "delivery" ? landmark : null,
      payment_method: input.paymentMethod === "mobile_money" ? "mobile_money" : "cash_on_delivery",
      notes: input.notes?.trim() || null,
    })
    .select("id, reference")
    .single();

  if (error || !created) {
    console.error("[checkout:placeOrder]", error?.message);
    return { ok: false, reason: "failed" };
  }

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(itemInserts.map((i) => ({ ...i, order_id: created.id })));

  if (itemsError) {
    // An order without its lines is worse than no order: the kitchen would see
    // an empty ticket and the customer would be charged for it. Roll back.
    console.error("[checkout:placeOrder] items", itemsError.message);
    await supabase.from("orders").delete().eq("id", created.id);
    return { ok: false, reason: "failed" };
  }

  // ── Everything below is non-fatal ───────────────────────────────────────
  // The order exists and the customer has been told so. A failed counter or
  // ledger row must never retract a placed order; it is a reconciliation
  // problem, not a checkout problem.

  await supabase.from("order_status_history").insert({
    order_id: created.id,
    status: "pending",
    by_name: deliveryName,
    note: "Order placed",
  });

  for (const line of input.lines) {
    const item = menu.get(line.menuItemId);
    if (item?.track_stock && item.stock_quantity !== null) {
      await supabase
        .from("menu_items")
        .update({ stock_quantity: Math.max(0, item.stock_quantity - line.quantity) })
        .eq("id", line.menuItemId)
        .eq("restaurant_id", input.restaurantId);
    }
  }

  if (promoId) {
    await supabase.from("promotion_redemptions").insert({
      promotion_id: promoId,
      order_id: created.id,
      customer_id: profile?.id ?? null,
      amount: totals.discount,
    });

    // The counter `usage_limit` is checked against. Without this increment the
    // limit is decorative — a single-use code would be redeemable for ever.
    // Read-then-write rather than an atomic bump because PostgREST has no
    // expression update; two simultaneous redemptions of the last use is a
    // narrow race worth accepting over a stored procedure for this.
    const { data: current } = await supabase
      .from("promotions")
      .select("used_count")
      .eq("id", promoId)
      .maybeSingle();

    await supabase
      .from("promotions")
      .update({ used_count: ((current?.used_count as number | undefined) ?? 0) + 1 })
      .eq("id", promoId);
  }

  if (pointsUsed > 0 && profile) {
    await supabase.from("loyalty_ledger").insert({
      profile_id: profile.id,
      order_id: created.id,
      restaurant_id: input.restaurantId,
      points: -pointsUsed,
      kind: "redeem",
      note: `Commande ${created.reference}`,
    });
  }

  /**
   * POINTS ARE EARNED ON DELIVERY, NOT HERE.
   *
   * Awarding them at checkout would pay for orders that are later cancelled,
   * and the natural exploit is to order, collect, cancel, repeat. The earn row
   * belongs to whatever marks an order `delivered`.
   */

  revalidatePath("/orders");
  revalidatePath("/account");

  return { ok: true, orderId: created.id, reference: created.reference };
}
