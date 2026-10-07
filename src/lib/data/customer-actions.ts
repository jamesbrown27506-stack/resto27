"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { canCustomerCancel, type OrderStatus } from "@/lib/format/order-status";
import { notify } from "@/lib/notify";
import { localizeUploadError, saveUpload, type UploadKind } from "@/lib/uploads";
import { awardDeliveryPoints } from "@/lib/orders/award-points";
import { releaseOrderHoldings } from "@/lib/orders/cancellation-effects";
import { orderDeadline } from "@/lib/orders/deadline";
import { getTimeLimits } from "@/lib/orders/time-limit-settings";
import { defaultServiceAreaId, resolveOrCreateQuartier } from "./quartiers";
import { anyPushWanted, toStoredJson } from "@/lib/notifications/customer-topics";
import { floorSeats, slotVerdict } from "@/lib/reservations/tables";
import {
  ABSOLUTE_MAX_PARTY,
  closureOn,
  isGroupRequest,
  OCCASIONS,
  withinHorizon,
} from "@/lib/reservations/rules";
import { loadBookingConfig, loadFloorPlan, loadHoldingBookings } from "./booking-rules";
import { getSettingsMap, settingNumber } from "@/lib/settings-map";
import { paymentFee } from "@/lib/dining/bill";
import { notifyWaitlist } from "./waitlist";
import { isMissingColumn as isMissingSchema } from "./missing-column";
import { rateLimit } from "@/lib/rate-limit";
import { getReservationDuration } from "@/lib/reservations/duration-server";
import { slotsForDate } from "@/lib/reservations/slots";
import { serviceDateAndTime } from "@/lib/restaurant/service-hours";
import { getTranslator } from "@/lib/i18n/locale-server";
import { firstIssueMessage } from "@/lib/i18n/issue-message";
import { paymentErrorMessage } from "@/lib/payments/payment-error";
import {
  depositChargedNow,
  normaliseDepositType,
  type DepositConfig,
} from "@/lib/reservations/deposit";
import {
  canCustomerCancelReservation,
  isUpcomingReservation,
} from "@/lib/reservations/lifecycle";
import {
  checkPaymentAttempt,
  initiatePaymentAttempt,
  orderPaymentInFlight,
  releaseUndialledAttempt,
  settlePayment,
} from "@/lib/payments/collect";
import type { ActionResult } from "./admin-actions";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";
import { normalisePhone } from "@/lib/payments/camerpay/client";
import { settleRefundPayout, startRefundPayout } from "@/lib/payments/refund-payouts";
import type { CustomerPreferences } from "./customer";
import type { UploadActionResult } from "./profile-actions";

/**
 * Customer-side mutations.
 *
 * Every action starts from `requireUser()` — the profile is the identity, and
 * every filter is scoped to `profile.id`. An id from a URL or a form field can
 * refer to a row that exists; it can never refer to a row that belongs to
 * someone else.
 */

/* ── Orders ─────────────────────────────────────────────────────────────── */

/**
 * Cancel your own order, but only where the state machine allows it (§4) —
 * once the kitchen has committed to the food, the restaurant decides.
 */
export async function cancelOwnOrder(orderId: string): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();
  const supabase = createAdminClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, customer_id, restaurant_id, reference, status, is_paid, payment_method")
    .eq("id", orderId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (error || !order) return { ok: false, error: t("ecu.orderNotFound") };
  if (!canCustomerCancel(order.status as CustomerStatus)) {
    return { ok: false, error: t("ecu.orderNotCancellable") };
  }
  // A PAID order is refunded, not just cancelled — that goes through the
  // restaurant and Resto237, never a one-tap that loses the customer's money.
  if (order.is_paid) {
    return { ok: false, error: t("ecu.orderPaidContactRestaurant") };
  }
  // A prompt still open on the customer's phone may yet be approved: cancelling
  // now would leave them charged for an order that no longer exists.
  if (order.payment_method === "mobile_money" && (await orderPaymentInFlight(order.id))) {
    return {
      ok: false,
      error: t("ecu.orderPaymentInFlight"),
    };
  }
  const now = new Date().toISOString();
  const { data: cancelled, error: updateError } = await supabase
    .from("orders")
    .update({ status: "cancelled", cancelled_reason: "Annulée par le client", cancelled_at: now })
    .eq("id", orderId)
    .eq("status", order.status)
    .eq("is_paid", false)
    .select("id")
    .maybeSingle();

  if (updateError) return { ok: false, error: t("ecu.cancelFailed") };
  // Paid or moved by the restaurant a moment ago — the refresh shows why.
  if (!cancelled) return { ok: false, error: t("ecu.orderChanged") };

  // Only the caller that won the cancellation gives back stock and points.
  await releaseOrderHoldings(orderId);

  await supabase.from("order_status_history").insert({
    order_id: orderId,
    status: "cancelled",
    by_name: user.name,
    note: "Cancelled by customer",
  });

  // The branch needs to know the order they were about to cook is gone.
  await notify({
    event: "order_cancelled",
    tone: "warning",
    restaurantId: order.restaurant_id,
    href: `/m/orders/${orderId}`,
    params: { reference: order.reference, cancelledBy: "customer" },
  });

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/account");
  return { ok: true };
}

type CustomerStatus = OrderStatus;

/**
 * Past the time limit (0059) an accepted order is waiting for the order-nag
 * sweep to cancel it; starting a payment in that gap would only produce a
 * refund. Same rule as the countdown on the order page.
 */
async function paymentWindowClosed(orderId: string, createdAt: string): Promise<boolean> {
  const supabase = createAdminClient();
  const [{ orderMinutes }, { data: accepted }] = await Promise.all([
    getTimeLimits(),
    supabase
      .from("order_status_history")
      .select("created_at")
      .eq("order_id", orderId)
      .eq("status", "awaiting_customer")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const deadline = orderDeadline(
    { status: "awaiting_customer", createdAt, acceptedAt: (accepted?.created_at as string | undefined) ?? null },
    orderMinutes,
  );
  return Boolean(deadline && deadline.getTime() <= Date.now());
}

/** Start or resume the signed-in customer's Mobile Money order payment. */
export async function payOwnOrder(
  orderId: string,
  phone: string,
): Promise<ActionResult & { status?: "succeeded" | "pending"; attemptId?: string; instruction?: PaymentInstruction }> {
  const t = await getTranslator();
  const user = await requireUser();
  const supabase = createAdminClient();

  if (!z.string().uuid().safeParse(orderId).success) {
    return { ok: false, error: t("ecu.orderNotFound") };
  }
  if (!phone.trim()) return { ok: false, error: t("ecu.momoRequired") };
  const requestedPhone = normalisePhone(phone);
  if (!requestedPhone) return { ok: false, error: t("ecu.momoInvalid") };

  const { data } = await supabase
    .from("orders")
    .select("id, reference, restaurant_id, customer_id, status, type, total, is_paid, payment_method, delivery_fee_set_at, created_at")
    .eq("id", orderId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (!data) return { ok: false, error: t("ecu.orderNotFound") };
  if (data.is_paid) return { ok: true, status: "succeeded" };
  if (
    (data.payment_method !== "mobile_money" && data.payment_method !== "wallet") ||
    data.status !== "awaiting_customer"
  ) {
    return { ok: false, error: t("ecu.notAwaitingOnlinePayment") };
  }
  if (data.type === "delivery" && !data.delivery_fee_set_at) {
    return { ok: false, error: t("ecu.deliveryFeeFirst") };
  }
  if (await paymentWindowClosed(data.id, data.created_at as string)) {
    return { ok: false, error: t("ecu.paymentDeadlinePassed") };
  }

  /*
    A WALLET ORDER MAY BE PAID BY MOBILE MONEY INSTEAD.

    The customer chose the wallet at checkout; by the time the restaurant
    accepts, the balance may no longer cover it (another order, a refund not
    yet in). Leaving "wallet" as the only way to pay made that order a dead
    end. Switching is guarded on the state it was read in, so it cannot race
    a wallet payment landing at the same moment.
  */
  if (data.payment_method === "wallet") {
    const { data: switched } = await supabase
      .from("orders")
      .update({ payment_method: "mobile_money" })
      .eq("id", data.id)
      .eq("customer_id", user.id)
      .eq("payment_method", "wallet")
      .eq("status", "awaiting_customer")
      .eq("is_paid", false)
      .select("id")
      .maybeSingle();
    if (!switched) return { ok: false, error: t("ecu.orderChanged") };
  }

  // Order attempts carry the order id in `raw_response.orderId`: the column
  // `payment_attempts.order_id` does not exist on the live database, and
  // filtering on it made every payment fail before a charge was ever sent.
  const { data: attempts, error: attemptsError } = await supabase
    .from("payment_attempts")
    .select("id, status, transaction_id, phone")
    .eq("raw_response->>orderId", data.id)
    .in("status", ["pending", "succeeded"])
    .is("settled_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  if (attemptsError) return { ok: false, error: t("ecu.paymentCheckFailed") };

  const open = (attempts ?? []).find(
    (attempt) => attempt.status === "succeeded" || Boolean(attempt.transaction_id),
  );
  if (open?.status === "succeeded") {
    const settled = await settlePayment(open.id as string);
    if (!settled.ok) return { ok: false, error: paymentErrorMessage(settled, t, "ecu.paymentNotApplied") };
    return { ok: true, status: "succeeded" };
  }
  if (open?.status === "pending" && open.transaction_id) {
    // Resolve first so an expired/failed Orange try cannot silently swallow a
    // later MTN submission. A still-live request is resumed only for the same
    // handset; changing numbers while it is active would risk two real charges.
    const current = await checkPaymentAttempt(open.id as string);
    if (current.status === "succeeded") {
      return { ok: true, status: "succeeded" };
    }
    if (current.status === "pending") {
      if (normalisePhone(String(open.phone ?? "")) === requestedPhone) {
        return {
          ok: true,
          status: "pending",
          attemptId: open.id as string,
          instruction: current.instruction,
        };
      }
      // An Orange code nobody dialled holds no money: it is given up so the
      // customer can pay from the other number. Anything else stays blocked.
      const released =
        current.instruction?.customerInitiated === true &&
        !current.instruction.received &&
        (await releaseUndialledAttempt(open.id as string));
      if (!released) {
        return {
          ok: false,
          error:
            t("ecu.otherMomoActive"),
        };
      }
    }
  }

  const initiated = await initiatePaymentAttempt({
    kind: "order",
    restaurantId: data.restaurant_id,
    orderId: data.id,
    reference: data.reference,
    phone: requestedPhone,
    amount: Number(data.total),
    // A hosted payment page (SasPay) brings the customer back to this order.
    returnPath: `/orders/${data.id}`,
    customer: { name: user.name, email: user.email },
  });

  if (!initiated.ok || !initiated.attemptId) {
    return { ok: false, error: paymentErrorMessage(initiated, t, "ecu.paymentFailed") };
  }
  if (initiated.status === "pending") {
    return { ok: true, status: "pending", attemptId: initiated.attemptId, instruction: initiated.instruction };
  }

  const settled = await settlePayment(initiated.attemptId);
  if (!settled.ok) return { ok: false, error: paymentErrorMessage(settled, t, "ecu.paymentNotApplied") };
  revalidatePath("/orders");
  revalidatePath("/orders/" + orderId);
  revalidatePath("/account");
  return { ok: true, status: "succeeded" };
}

/** Pay an accepted order with the signed-in customer's wallet. */
export async function payOwnOrderWithWallet(
  orderId: string,
): Promise<ActionResult & { status?: "succeeded" }> {
  const t = await getTranslator();
  const user = await requireUser();
  const supabase = createAdminClient();
  if (!z.string().uuid().safeParse(orderId).success) return { ok: false, error: t("ecu.orderNotFound") };

  const { data: order } = await supabase
    .from("orders")
    .select("id, reference, restaurant_id, delivery_name, is_paid, payment_method, status, total, created_at")
    .eq("id", orderId)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (!order) return { ok: false, error: t("ecu.orderNotFound") };
  if (order.is_paid) return { ok: true, status: "succeeded" };
  if (
    (order.payment_method !== "wallet" && order.payment_method !== "mobile_money") ||
    order.status !== "awaiting_customer"
  ) {
    return { ok: false, error: t("ecu.notAwaitingOnlinePayment") };
  }
  if (await paymentWindowClosed(order.id, order.created_at as string)) {
    return { ok: false, error: t("ecu.paymentDeadlinePassed") };
  }
  // The other direction of the switch: never while a Mobile Money prompt is
  // open on the phone, or the customer could pay twice.
  if (order.payment_method === "mobile_money") {
    if (await orderPaymentInFlight(order.id)) {
      return { ok: false, error: t("ecu.momoInProgress") };
    }
    const { data: switched } = await supabase
      .from("orders")
      .update({ payment_method: "wallet" })
      .eq("id", order.id)
      .eq("customer_id", user.id)
      .eq("payment_method", "mobile_money")
      .eq("status", "awaiting_customer")
      .eq("is_paid", false)
      .select("id")
      .maybeSingle();
    if (!switched) return { ok: false, error: t("ecu.orderChanged") };
  }

  const { error } = await supabase.rpc("customer_wallet_pay_order", {
    p_profile_id: user.id,
    p_order_id: order.id,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("insufficient_customer_wallet")
        ? t("ecu.walletInsufficient")
        : t("ecu.walletPaymentFailed"),
    };
  }

  await notify({
    event: "new_order",
    tone: "success",
    restaurantId: order.restaurant_id,
    href: "/m/orders/" + order.id,
    params: {
      reference: order.reference,
      customerName: order.delivery_name ?? undefined,
      amount: Number(order.total),
      paid: true,
    },
  });
  revalidatePath("/orders");
  revalidatePath("/orders/" + orderId);
  revalidatePath("/account");
  return { ok: true, status: "succeeded" };
}

/** Poll an order payment owned by the signed-in customer. */
export async function checkOwnOrderPayment(
  attemptId: string,
): Promise<ActionResult & { status?: "succeeded" | "pending" | "failed"; instruction?: PaymentInstruction }> {
  const t = await getTranslator();
  const user = await requireUser();
  const supabase = createAdminClient();
  const { data: attempt } = await supabase
    .from("payment_attempts")
    .select("raw_response")
    .eq("id", attemptId)
    .maybeSingle();

  const raw = (attempt?.raw_response ?? null) as { orderId?: unknown } | null;
  const paidOrderId = typeof raw?.orderId === "string" ? raw.orderId : null;
  if (!paidOrderId) return { ok: false, error: t("ecu.paymentNotFound") };

  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("id", paidOrderId)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (!order) return { ok: false, error: t("ecu.paymentNotFound") };

  const result = await checkPaymentAttempt(attemptId);
  if (!result.ok) return { ok: false, error: paymentErrorMessage(result, t, "ecu.paymentNotFound") };
  if (result.status === "succeeded") {
    revalidatePath("/orders");
    revalidatePath("/orders/" + paidOrderId);
    revalidatePath("/account");
  }
  return { ok: true, status: result.status, instruction: result.instruction };
}
/**
 * "I HAVE MY FOOD." — the customer closing their own order.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE PERSON WHO KNOWS IS THE PERSON HOLDING THE BAG.
 *
 *  `delivered` could previously only be set by the restaurant, from four
 *  staff-side screens. But the restaurant does not know when the food
 *  arrived — the rider does, and the rider is not in this system. So the
 *  final state was a guess made by whoever remembered to press the button:
 *  some orders closed the moment the bike left, others sat in `shipped`
 *  overnight and tripped the stuck-delivery sweep.
 *
 *  It matters beyond tidiness. `delivered` is what awards loyalty points,
 *  what unlocks the review, and what the delivery monitor measures against.
 *  A customer who has eaten and cannot say so is a customer whose points and
 *  review are held hostage by someone else's admin.
 *
 *  ONLY FROM `shipped`, and only forwards. Confirming receipt of food that
 *  has not left the kitchen is not a thing to support — and the guard is a
 *  status equality in the UPDATE, so two people pressing at once cannot both
 *  win and double-award the points.
 *
 *  The restaurant KEEPS its own button. This is an additional hand on the
 *  same lever, not a transfer of it: a customer who never opens the app
 *  still gets their order closed.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function confirmOwnDelivery(orderId: string): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();
  const supabase = createAdminClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, customer_id, restaurant_id, reference, status, type, subtotal")
    .eq("id", orderId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (error || !order) return { ok: false, error: t("ecu.orderNotFound") };

  if (order.status !== "shipped") {
    return {
      ok: false,
      error:
        order.status === "delivered"
          ? t("ecu.alreadyReceived")
          : t("ecu.confirmWhenShipped"),
    };
  }


  /*
    A pickup used to need the restaurant to "request" the confirmation
    first, so a customer holding their bag still waited on the counter's
    admin to close their own order. Since 2026-10 the customer closes it
    whenever it is ready (`shipped`), exactly like a delivery. The
    restaurant's request button still works — it just is no longer a gate.
  */
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: "delivered", delivered_at: now })
    .eq("id", orderId)
    // Optimistic concurrency: if the restaurant closed it a second earlier,
    // this matches nothing rather than stamping a second delivered_at.
    .eq("status", "shipped");

  if (updateError) {
    console.error("[customer:confirmOwnDelivery]", orderId, updateError.message);
    return { ok: false, error: t("ecu.confirmFailed") };
  }

  await supabase.from("order_status_history").insert({
    order_id: orderId,
    status: "delivered",
    by_name: user.name,
    note: "Confirmed received by customer",
  });

  // The SAME award the restaurant's own "delivered" runs. Closing your own
  // order must not cost you the points closing it any other way would earn.
  await awardDeliveryPoints({
    id: order.id,
    subtotal: Number(order.subtotal) || 0,
    reference: order.reference,
    customer_id: order.customer_id,
    restaurant_id: order.restaurant_id,
  });

  // The restaurant's queue should stop showing this as out for delivery.
  await notify({
    event: "order_status",
    tone: "success",
    restaurantId: order.restaurant_id,
    href: `/m/orders/${orderId}`,
    params: { reference: order.reference, status: "delivered", customerName: user.name },
  });

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/account");
  revalidatePath("/loyalty");
  return { ok: true };
}

/** 1–5 stars on a delivered order's delivery experience. */
export async function rateOwnDelivery(orderId: string, rating: number): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: t("ecu.ratingRange") };
  }

  const supabase = createAdminClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, type")
    .eq("id", orderId)
    .eq("customer_id", user.id)
    .eq("status", "delivered")
    .maybeSingle();

  if (error || !order || order.type !== "delivery") {
    return { ok: false, error: t("ecu.cannotRate") };
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({ delivery_rating: rating })
    .eq("id", orderId);

  if (updateError) return { ok: false, error: t("ecu.saveFailed") };

  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

/* ── Reviews ────────────────────────────────────────────────────────────── */

/**
 * Write the review for a delivered order.
 *
 * One review per order, scoped to its restaurant — and only after the food
 * arrived. Rating 1–5, body at least 10 characters, exactly what the dialog
 * asks for.
 */
/**
 * Upload one review photo and hand back its URL. The review is written
 * separately — a photo uploaded and then abandoned is an orphan, not a
 * broken review. Files validated by bytes, like every upload (§9).
 */
export async function uploadReviewPhoto(formData: FormData): Promise<UploadActionResult> {
  const t = await getTranslator();
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: t("ecu.noFile") };

  const result = await saveUpload(file, "reviews" satisfies UploadKind, user.id);
  if (!result.ok) return { ok: false, error: localizeUploadError(result, t) };

  return { ok: true, url: result.url };
}

export async function submitOwnReview(
  orderId: string,
  rating: number,
  body: string,
  photoUrls: string[] = [],
): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: t("ecu.ratingRange") };
  }
  if (body.trim().length < 10) return { ok: false, error: t("ecu.reviewTooShort") };

  const supabase = createAdminClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, restaurant_id, status, reference")
    .eq("id", orderId)
    .eq("customer_id", user.id)
    .eq("status", "delivered")
    .maybeSingle();

  if (error || !order) return { ok: false, error: t("ecu.orderNotFound") };

  const { data: existing, error: dupError } = await supabase
    .from("reviews")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();

  if (dupError) return { ok: false, error: t("ecu.reviewExists") };
  if (existing) return { ok: false, error: t("ecu.reviewExists") };

  // Photos are capped at three and must be URLs on our own storage — a
  // review must not embed arbitrary external content.
  if (!Array.isArray(photoUrls) || photoUrls.length > 3 || photoUrls.some((url) => typeof url !== "string")) {
    return { ok: false, error: t("ecu.publishFailed") };
  }
  const photos = [...new Set(photoUrls)];
  if (photos.length) {
    const { data: owned, error: ownershipError } = await supabase.from("customer_uploads").select("public_url")
      .eq("profile_id", user.id).eq("kind", "reviews").eq("ready", true).in("public_url", photos);
    if (ownershipError || owned?.length !== photos.length) return { ok: false, error: t("ecu.publishFailed") };
  }

  const { data: created, error: insertError } = await supabase
    .from("reviews")
    .insert({
      restaurant_id: order.restaurant_id,
      customer_id: user.id,
      order_id: orderId,
      customer_name: user.name,
      rating,
      body: body.trim(),
    })
    .select("id")
    .single();

  if (insertError || !created) return { ok: false, error: t("ecu.publishFailed") };

  if (photos.length > 0) {
    const { error: photoError } = await supabase.from("review_photos").insert(
      photos.map((url, i) => ({ review_id: created.id, url, sort_order: i })),
    );
    if (photoError) console.error("[customer:submitOwnReview] photos", photoError.message);
  }

  // A review is a public word about the restaurant — the manager should hear
  // about it the moment it lands.
  await notify({
    event: "review",
    tone: "info",
    restaurantId: order.restaurant_id,
    href: "/m/reviews",
    // The order id keys the push collapse tag — two reviews arriving in the
    // same hour are two banners, not one replacing the other.
    params: { rating, customerName: user.name, reference: orderId },
  });

  revalidatePath("/reviews");
  revalidatePath("/restaurants");
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

/** Edit one of your own reviews. */
export async function updateOwnReview(
  reviewId: string,
  rating: number,
  body: string,
): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: t("ecu.ratingRange") };
  }
  if (body.trim().length < 10) return { ok: false, error: t("ecu.reviewTooShort") };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("reviews")
    .update({ rating, body: body.trim() })
    .eq("id", reviewId)
    .eq("customer_id", user.id);

  if (error) return { ok: false, error: t("ecu.updateFailed") };

  revalidatePath("/reviews");
  revalidatePath("/restaurants");
  return { ok: true };
}

/** Remove one of your own reviews — the customer's word, not the manager's. */
export async function deleteOwnReview(reviewId: string): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("reviews")
    .delete()
    .eq("id", reviewId)
    .eq("customer_id", user.id);

  if (error) return { ok: false, error: t("ecu.deleteFailed") };

  revalidatePath("/reviews");
  revalidatePath("/restaurants");
  return { ok: true };
}

/* ── Reservations ───────────────────────────────────────────────────────── */

const ReservationSchema = z.object({
  restaurantId: z.string().uuid(),
  reservedFor: z.string().datetime(),
  /**
   * Up to the absolute ceiling: above the restaurant's own maximum the booking
   * is still sent, as a group request the restaurant arranges by hand (0068).
   */
  partySize: z.coerce.number().int().min(1).max(ABSOLUTE_MAX_PARTY),
  notes: z.string().max(500).optional().default(""),
  /** Mobile Money number — required only when the restaurant charges a fixed
   *  reservation fee, which the customer pays online at booking. */
  phone: z.string().optional().default(""),
  /** Optional (0068): birthday, business… shown to the restaurant. */
  occasion: z.enum(OCCASIONS).optional().nullable(),
  /** Optional (0068): a table zone ("Terrasse") — a preference, not a condition. */
  seatingPreference: z.string().trim().max(40).optional().nullable(),
});

/** The columns 0068 added to `reservations` — dropped on a database without it. */
const BOOKING_0068_COLUMNS = ["occasion", "seating_preference", "is_group_request", "source", "pending_change"];

/**
 * "That column does not exist" — the shape a skipped migration takes, and it
 * has TWO shapes depending on which way the data was going.
 *
 *   42703    — Postgres itself, raised when a SELECT names an unknown column.
 *   PGRST204 — PostgREST, raised before the query is ever sent, when an INSERT
 *              or UPDATE body names a column missing from its schema cache.
 *              The message reads "Could not find the 'x' column of 'y' in the
 *              schema cache" and there is no Postgres code at all.
 *
 * Checking only 42703 meant every retry here was dead on the write path — the
 * exact path they exist for. Both mention the column by name, which is what
 * keeps this from swallowing an unrelated failure.
 */
function isMissingColumn(error: { code?: string; message?: string } | null, column?: string) {
  return isMissingSchema(error, column);
}

/**
 * The reservation fee, read so a database that skipped migration 0031 still
 * takes bookings.
 *
 * `deposit_type` splits a fee into "FCFA charged online now" and "percentage
 * of the final bill, collected on site". Before 0031 there was only the first
 * kind, so its absence has an exact meaning — every fee is fixed — and that is
 * what this returns rather than refusing the booking. A restaurant that has
 * not run the migration also cannot have set a percentage fee, so nothing is
 * being guessed at.
 */
async function readDepositConfig(
  supabase: ReturnType<typeof createAdminClient>,
  restaurantId: string,
): Promise<DepositConfig> {
  const withType = await supabase
    .from("restaurants")
    .select("deposit_amount, deposit_type")
    .eq("id", restaurantId)
    .maybeSingle();

  if (!withType.error) {
    const row = withType.data as { deposit_amount?: number; deposit_type?: string } | null;
    return {
      amount: Number(row?.deposit_amount ?? 0),
      type: normaliseDepositType(row?.deposit_type),
    };
  }

  if (!isMissingColumn(withType.error, "deposit_type")) {
    console.error("[customer:readDepositConfig]", withType.error.message);
    return { amount: 0, type: "fixed" };
  }

  console.warn(
    "[customer:readDepositConfig] restaurants.deposit_type is missing — run migration 0038. Treating every reservation fee as a flat amount.",
  );

  const { data } = await supabase
    .from("restaurants")
    .select("deposit_amount")
    .eq("id", restaurantId)
    .maybeSingle();

  return { amount: Number((data as { deposit_amount?: number } | null)?.deposit_amount ?? 0), type: "fixed" };
}

/**
 * Request a table.
 *
 * Availability is a real check, not a decorative grid: a confirmed seat is
 * counted against the restaurant's tables, and the slot is refused when the
 * last table for that hour is taken. A restaurant with no tables configured
 * never blocks — a walk-in place has no capacity ceiling to enforce.
 */
export async function createOwnReservation(
  input: z.infer<typeof ReservationSchema>,
): Promise<ActionResult & { status?: "succeeded" | "pending"; attemptId?: string; instruction?: PaymentInstruction }> {
  const t = await getTranslator();
  const user = await requireUser();

  const parsed = ReservationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("ecu.checkReservation") };

  const { restaurantId, reservedFor, partySize, notes, phone, occasion, seatingPreference } = parsed.data;
  const when = new Date(reservedFor);
  if (when.getTime() <= Date.now()) return { ok: false, error: t("ecu.chooseFutureDate") };

  const supabase = createAdminClient();

  /*
    ─────────────────────────────────────────────────────────────────────────
     "Restaurant introuvable." FOR A RESTAURANT YOU CAN ORDER FROM.

     This lookup used to be one query — `select id, status, deposit_amount,
     deposit_type` — and one `if (restaurantError || !restaurant)` collapsing
     both outcomes into "restaurant not found". They are not the same thing.

     `restaurants.deposit_type` is added by migration 0031 (or its catch-up,
     0033). On a database that never ran it, PostgREST answers that select
     with 42703 — column does not exist — for EVERY restaurant. So the row was
     found, the restaurant was active, its menu was orderable in the next tab,
     and the booking form still said it did not exist. The message named the
     one thing that was not wrong, which is why it sent people looking at the
     restaurant instead of at the schema.

     Split in two, so each failure says what it is:
       · the existence check reads only columns that have existed since 0003;
       · the fee is read separately, and a database missing the column falls
         back to a fixed fee of zero rather than failing the booking.
    ─────────────────────────────────────────────────────────────────────────
  */
  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants")
    .select("id, status, name")
    .eq("id", restaurantId)
    .eq("status", "active")
    .maybeSingle();

  if (restaurantError) {
    console.error(
      "[customer:createOwnReservation] restaurant lookup",
      restaurantError.code ?? "",
      restaurantError.message,
    );
    return { ok: false, error: t("ecu.availabilityRetry") };
  }
  if (!restaurant) return { ok: false, error: t("ecu.restaurantNotFound") };

  // The form's slot list is advisory; enforce the same opening-hours rule
  // here so stale tabs and direct Server Action calls cannot reserve a closed time.
  const { data: hoursRows, error: hoursError } = await supabase.from("restaurant_hours")
    .select("weekday, opens_at, closes_at").eq("restaurant_id", restaurantId);
  if (hoursError) return { ok: false, error: t("ecu.hoursCheckFailed") };
  const localSlot = serviceDateAndTime(when);
  const hours = ((hoursRows ?? []) as { weekday: number; opens_at: string | null; closes_at: string | null }[])
    .map((row) => ({ weekday: row.weekday, opensAt: row.opens_at, closesAt: row.closes_at }));
  if (!localSlot || !slotsForDate(hours, localSlot.date).slots.includes(localSlot.time)) {
    return { ok: false, error: t("ecu.slotOutsideHours") };
  }

  /*
    ─────────────────────────────────────────────────────────────────────────
     THE RESTAURANT'S OWN BOOKING RULES (0068).

     How far ahead (admin setting), closures, the largest party it seats
     itself, and how many arrivals it can greet in one half-hour. Above the
     maximum party the request is still sent, as a GROUP REQUEST: the
     restaurant arranges the tables by hand, so no capacity test is run.
    ─────────────────────────────────────────────────────────────────────────
  */
  const config = await loadBookingConfig(restaurantId);
  if (!withinHorizon(localSlot.date, config.horizonDays)) {
    return { ok: false, error: t("ons.err.tooFarAhead", { days: config.horizonDays }) };
  }
  if (closureOn(localSlot.date, config.closures)) return { ok: false, error: t("ons.err.closedOnDate") };
  const groupRequest = isGroupRequest(partySize, config.maxParty);

  const deposit = await readDepositConfig(supabase, restaurantId);
  const depositType = deposit.type;
  const depositPercent = depositType === "percent" ? deposit.amount : 0;

  /*
    THE AMOUNT IS COMPUTED, NOT COPIED.

    A `per_seat` fee is the per-guest rate multiplied by the party size, so
    what the customer will owe is not the number stored on the restaurant. It
    goes through the same `depositChargedNow` the booking form used to show
    them their total — one expression, so the figure they were quoted and the
    figure they are eventually asked for cannot drift apart.

    `partySize` is the SERVER's validated copy from the schema above, never a
    total posted by the client: an amount derived from a client-supplied total
    is an amount the client can choose.
  */
  const depositDue = depositChargedNow(deposit, partySize);

  /*
    THE SAME RULE THE BOOKING FORM DRAWS ITS GREYED SLOTS FROM.

    A party is seated on one table when one fits and on several when not
    (lib/reservations/tables — a simulation of the whole floor, 0068), and
    the arrivals cap is part of the same verdict. The form asks
    fetchDayAvailability, which calls slotVerdict too: one definition of
    "full", on both sides.
  */
  // The restaurant's sitting length (0060, default one hour) — snapshotted
  // onto the booking below, and the length every overlap test uses for it.
  const durationMin = await getReservationDuration(restaurantId, supabase);

  if (!groupRequest) {
    const floor = await loadFloorPlan(restaurantId).catch(() => null);
    if (!floor) return { ok: false, error: t("ecu.availabilityFailed") };
    // No configured floor means the restaurant manages capacity manually.
    if (floor.length > 0 && floorSeats(floor) < partySize) {
      return { ok: false, error: t("ecu.noTableForParty") };
    }
    const holding = await loadHoldingBookings(restaurantId, when, when, durationMin);
    if (!holding) return { ok: false, error: t("ecu.availabilityFailed") };
    if (slotVerdict({ tables: floor, bookings: holding, at: when, durationMin, partySize, maxArrivals: config.maxArrivals }) !== "ok") {
      return { ok: false, error: t("ecu.slotFull") };
    }
  }

  const reference = `RES-${randomUUID().slice(0, 4).toUpperCase()}`;
  /*
    `deposit_percent` is kept OUT of the base row and added on top, so the
    retry below has something to fall back to that was never assembled with
    it — rather than destructuring the key back out of an object that has it.
    The 0068 details ride on top again, dropped first if the database lacks them.
  */
  const baseRow = {
    reference,
    restaurant_id: restaurantId,
    customer_id: user.id,
    guest_name: user.name,
    guest_phone: phone.trim() || user.phone || "",
    party_size: partySize,
    reserved_for: reservedFor,
    // The sitting length at booking time (0060). A snapshot, like the deposit:
    // a restaurant shortening its sittings tonight must not shrink the
    // bookings it already accepted.
    duration_min: durationMin,
    status: "pending",
    // Snapshotted from the restaurant's price at booking time (0025) — a
    // price change after the customer booked must not rewrite their booking.
    // The percentage is snapshotted too (0031) so the board still reads the
    // value the customer booked under.
    //
    // For a per-seat fee this is the TOTAL due, not the per-guest rate: the
    // board is reading "what does this customer owe", and the rate alone
    // would answer a question nobody asked.
    deposit_amount: depositDue,
    notes: notes.trim() || null,
  };
  const row = { ...baseRow, deposit_percent: depositPercent };
  const fullRow = {
    ...row,
    occasion: occasion ?? null,
    seating_preference: seatingPreference?.trim() || null,
    is_group_request: groupRequest,
  };

  let inserted: { id: string; created_at: string } | null = null;
  let insertError = null as { code?: string; message?: string } | null;

  {
    let attempt = await supabase.from("reservations").insert(fullRow).select("id, created_at").single();
    if (attempt.error && BOOKING_0068_COLUMNS.some((column) => isMissingColumn(attempt.error, column))) {
      console.warn("[customer:createOwnReservation] 0068 booking columns missing — saved without occasion / preference.");
      attempt = await supabase.from("reservations").insert(row).select("id, created_at").single();
    }
    inserted = attempt.data as { id: string; created_at: string } | null;
    insertError = attempt.error;

    // Same skipped migration as the deposit read above: `deposit_percent` is
    // 0031's column on `reservations`. Without it the whole insert is refused,
    // so the booking is retried without the snapshot — a request that reaches
    // the restaurant beats one lost to a column the fee never used anyway.
    if (isMissingColumn(insertError, "deposit_percent")) {
      console.warn(
        "[customer:createOwnReservation] reservations.deposit_percent is missing — run migration 0031 (or 0033_catch_up). Booking saved without the percentage snapshot.",
      );
      const retry = await supabase.from("reservations").insert(baseRow).select("id, created_at").single();
      inserted = retry.data as { id: string; created_at: string } | null;
      insertError = retry.error;
    }
  }

  if (insertError || !inserted) {
    console.error(
      "[customer:createOwnReservation] insert",
      insertError?.code ?? "",
      insertError?.message ?? "no row returned",
    );
    return { ok: false, error: t("ecu.requestNotSent") };
  }

  /*
    THE LAST TABLE, REQUESTED TWICE AT ONCE.

    The capacity check above and the insert are two statements, so two
    customers can both pass the check for the same last table. Re-reading
    after the insert and yielding to whichever request got in first settles it
    without a lock: only bookings created BEFORE ours count against it, so of
    two racing requests exactly the later one withdraws. A failed re-read keeps
    the booking — the restaurant still decides it.
  */
  if (!groupRequest) {
    const floor = await loadFloorPlan(restaurantId).catch(() => null);
    const after = floor ? await loadHoldingBookings(restaurantId, when, when, durationMin) : null;
    if (floor && after) {
      const mine = inserted;
      const mineAt = Date.parse(mine.created_at);
      const earlier = after.filter((other) => {
        if (other.id === mine.id) return false;
        const at = Date.parse(other.createdAt);
        return at < mineAt || (at === mineAt && other.id < mine.id);
      });
      const verdict = slotVerdict({ tables: floor, bookings: earlier, at: when, durationMin, partySize, maxArrivals: config.maxArrivals });
      if (verdict !== "ok") {
        await supabase.from("reservations").delete().eq("id", mine.id).eq("status", "pending");
        return { ok: false, error: t("ecu.slotFull") };
      }
    }
  }

  /*
    ─────────────────────────────────────────────────────────────────────────
     NOTHING IS CHARGED HERE. THAT IS THE POINT OF THIS FUNCTION NOW.

     This used to take the customer's Mobile Money the moment they pressed the
     button — while the request was still `pending`, before anyone at the
     restaurant had seen it. So a restaurant that was full declined a booking
     it had never agreed to, and the customer had already paid for it. What
     was left was a refund to chase for a table that never existed: a support
     cost on every decline, and the worst possible first experience of the
     platform.

     The order is now request → decide → pay. `decideReservation` moves an
     approved booking with a deposit due to `awaiting_payment` and tells the
     customer; `payReservationDeposit` below takes the money and turns it into
     `confirmed`. A decline costs nobody anything, because nothing was taken.

     `deposit_amount` is still written here, and still snapshotted at booking
     time (0025): it is the amount that will be DUE, fixed at the moment the
     customer asked, so a restaurant raising its fee afterwards cannot rewrite
     what an existing request owes.
    ─────────────────────────────────────────────────────────────────────────
  */

  // A waitlist spot the customer booked from is used up (0068; tolerated if absent).
  await supabase
    .from("reservation_waitlist")
    .update({ status: "booked" })
    .eq("restaurant_id", restaurantId)
    .eq("customer_id", user.id)
    .eq("wanted_date", localSlot.date)
    .in("status", ["waiting", "notified"]);

  // A booking request is only real once someone at the restaurant has seen it.
  await notify({
    event: "reservation",
    tone: groupRequest ? "warning" : "info",
    restaurantId,
    href: "/m/reservations",
    params: {
      reference,
      customerName: user.name,
      partySize,
      detail: groupRequest ? "Demande de groupe — tables à attribuer à la main" : undefined,
    },
  });

  /*
    THE CUSTOMER GETS A RECEIPT TOO. Orders confirm both ways at placement;
    bookings told only the restaurant, and the customer held nothing that
    said their request existed. Same collapse tag as the decision push, so
    the answer replaces the receipt on the lock screen when it comes.
  */
  await notify({
    event: "reservation_decision",
    tone: "info",
    customerId: user.id,
    href: "/reservations",
    params: {
      reference,
      status: "pending",
      restaurantName: (restaurant as { name?: string }).name,
      partySize,
      whenLabel: new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Africa/Douala",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(when),
    },
  });

  revalidatePath("/reservations");
  revalidatePath("/account");
  return { ok: true, status: "succeeded" };
}

/**
 * Which of a day's slots are already sold out for a party of this size.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE FORM ASKS THIS BEFORE IT ASKS THE CUSTOMER FOR ANYTHING.
 *
 *  Availability used to be tested once, at submit, so a full Saturday was a
 *  dead end reached after the party size, the notes and the phone number had
 *  all been typed — and the refusal named no alternative. Every booking
 *  platform worth copying inverts that: you see the times that are genuinely
 *  free, and a full one is greyed rather than removed, because a slot that
 *  disappears reads as a bug while a greyed one reads as an answer.
 *
 *  TWO QUERIES FOR THE WHOLE DAY, not one per half-hour. The floor is read
 *  once and the day's holding bookings are read once; `fullSlots` then answers
 *  every slot from those two arrays in memory.
 *
 *  THE SLOT LIST IS DERIVED HERE, not accepted from the client. A caller that
 *  supplied its own list could ask about hours the restaurant is closed and
 *  learn the shape of the floor plan from the answers.
 *
 *  No `requireUser`: the booking form is reachable signed-out, and this
 *  reveals nothing a walk-in could not learn by telephoning.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function fetchDayAvailability(input: {
  restaurantId: string;
  /** YYYY-MM-DD in the display zone. */
  date: string;
  partySize: number;
}): Promise<{
  ok: boolean;
  slots: string[];
  full: string[];
  /** Past the admin limit on how far ahead a table can be booked (0068). */
  tooFar?: boolean;
  maxDays?: number;
  /** The restaurant is closed that day; the reason it gave, if any. */
  closed?: boolean;
  closedReason?: string | null;
  /** Above the restaurant's maximum: the request is arranged by hand. */
  groupRequest?: boolean;
  maxParty?: number;
  /** Table zones the customer may prefer ("Terrasse"…), when the floor has them. */
  zones?: string[];
}> {
  const parsed = z
    .object({
      restaurantId: z.string().uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      partySize: z.coerce.number().int().min(1).max(ABSOLUTE_MAX_PARTY),
    })
    .safeParse(input);

  if (!parsed.success) return { ok: false, slots: [], full: [] };
  const { restaurantId, date, partySize } = parsed.data;

  const supabase = createAdminClient();

  const [{ data: hoursRows, error: hoursError }, config] = await Promise.all([
    supabase.from("restaurant_hours").select("weekday, opens_at, closes_at").eq("restaurant_id", restaurantId),
    loadBookingConfig(restaurantId),
  ]);
  if (hoursError) return { ok: false, slots: [], full: [] };

  // The rules that empty the whole day come first — they are the answer.
  if (!withinHorizon(date, config.horizonDays)) {
    return { ok: true, slots: [], full: [], tooFar: true, maxDays: config.horizonDays };
  }
  const closure = closureOn(date, config.closures);
  if (closure) return { ok: true, slots: [], full: [], closed: true, closedReason: closure.reason };

  const hours = ((hoursRows ?? []) as { weekday: number; opens_at: string | null; closes_at: string | null }[]).map(
    (h) => ({ weekday: h.weekday, opensAt: h.opens_at, closesAt: h.closes_at }),
  );

  const { slots } = slotsForDate(hours, date);
  if (slots.length === 0) return { ok: true, slots: [], full: [], maxParty: config.maxParty };

  const floor = await loadFloorPlan(restaurantId).catch(() => null);
  if (!floor) return { ok: false, slots, full: [] };
  const zones = [...new Set(floor.filter((table) => table.status !== "out_of_service").map((table) => table.zone).filter((zone): zone is string => Boolean(zone)))].sort();

  // A group request is arranged by hand — every opening slot can be asked for.
  if (isGroupRequest(partySize, config.maxParty)) {
    return { ok: true, slots, full: [], groupRequest: true, maxParty: config.maxParty, zones };
  }

  // An unmanaged floor with no arrivals cap has nothing to enforce.
  if (floor.length === 0 && !config.maxArrivals) return { ok: true, slots, full: [], maxParty: config.maxParty, zones };

  // One read covers every slot of the day: back by the longest possible
  // sitting, forward by this restaurant's own.
  const dayStart = new Date(`${date}T00:00:00+01:00`);
  const dayEnd = new Date(`${date}T23:59:59+01:00`);
  const durationMin = await getReservationDuration(restaurantId, supabase);
  const holding = await loadHoldingBookings(restaurantId, dayStart, dayEnd, durationMin);
  if (!holding) return { ok: false, slots, full: [] };

  // Africa/Douala is UTC+1 with no DST, the same conversion the submit path
  // uses when it builds `reservedFor`.
  const full = slots.filter(
    (slot) =>
      slotVerdict({
        tables: floor,
        bookings: holding,
        at: new Date(`${date}T${slot}:00+01:00`),
        durationMin,
        partySize,
        maxArrivals: config.maxArrivals,
      }) !== "ok",
  );

  return { ok: true, slots, full, maxParty: config.maxParty, zones };
}

/**
 * Pay the deposit on a booking the restaurant has already agreed to.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE SECOND HALF OF request → decide → pay.
 *
 *  Only a booking in `awaiting_payment` can be paid, and only by the customer
 *  who made it. Both are checked against the SESSION, not the payload: a
 *  reservation id is guessable and a Server Action is a public POST endpoint
 *  that never passes through the page's guard, so "pay my deposit" must not be
 *  able to become "charge someone else's phone" or "pay for a booking nobody
 *  approved".
 *
 *  THE AMOUNT IS THE ROW'S, NOT THE CLIENT'S. `deposit_amount` was snapshotted
 *  when the booking was made, so this charges what the customer was quoted
 *  even if the restaurant has changed its fee since — and there is no number
 *  in the payload for anyone to tamper with.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function payReservationDeposit(
  reservationId: string,
  phone: string,
): Promise<ActionResult & { status?: "succeeded" | "pending"; attemptId?: string; instruction?: PaymentInstruction }> {
  const t = await getTranslator();
  const user = await requireUser();

  if (!z.string().uuid().safeParse(reservationId).success) {
    return { ok: false, error: t("ecu.reservationNotFound") };
  }
  if (!phone.trim()) {
    return { ok: false, error: t("ecu.momoRequiredDeposit") };
  }
  const requestedPhone = normalisePhone(phone);
  if (!requestedPhone) {
    return { ok: false, error: t("ecu.momoInvalid") };
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("reservations")
    .select("id, reference, restaurant_id, status, deposit_amount, deposit_paid, reserved_for, duration_min")
    .eq("id", reservationId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[customer:payReservationDeposit] lookup", error.message);
    return { ok: false, error: t("ecu.reservationCheckRetry") };
  }
  if (!data) return { ok: false, error: t("ecu.reservationNotFound") };

  const booking = data as {
    id: string;
    reference: string;
    restaurant_id: string;
    status: string;
    deposit_amount: number | null;
    deposit_paid: boolean | null;
    reserved_for: string;
    duration_min: number;
  };

  if (booking.deposit_paid) return { ok: false, error: t("ecu.depositAlreadyPaid") };
  if (booking.status !== "awaiting_payment") {
    // Either the restaurant has not decided yet, or it declined, or the table
    // is already confirmed. None of them is a bill.
    return { ok: false, error: t("ecu.reservationNotAwaitingPayment") };
  }
  if (
    !isUpcomingReservation({
      status: "awaiting_payment",
      reservedFor: booking.reserved_for,
      durationMin: booking.duration_min,
    })
  ) {
    return { ok: false, error: t("ecu.slotPassed") };
  }

  const deposit = Number(booking.deposit_amount ?? 0);
  if (deposit <= 0) return { ok: false, error: t("ecu.noDepositDue") };

  /*
    THE PAYMENT FEE, ON EVERY MOBILE MONEY PAYMENT (0068).

    The gateway takes its percentage of every payment that passes through
    it, so the admin's payment service fee applies to a deposit exactly as it
    does to an online order. The restaurant is credited the deposit it set
    (settlePayment splits the two), and the fee is snapshotted on the booking
    so the screen, the charge and the settlement read one figure.
  */
  const feePercent = settingNumber(await getSettingsMap(), "service_charge_percent", 0);
  const depositFee = paymentFee(deposit, feePercent);
  const amount = deposit + depositFee;
  {
    const { error: feeError } = await supabase.from("reservations").update({ deposit_fee: depositFee }).eq("id", booking.id);
    if (feeError && !isMissingColumn(feeError, "deposit_fee")) console.error("[customer:payReservationDeposit] fee", feeError.message);
  }

  /*
   * A reload or a second tap must resume the Mobile Money request already on
   * the customer's handset, not send another charge. An untracked transport
   * failure has no transaction id and is deliberately ignored so the customer
   * can retry instead of being blocked for the reconciler's abandonment window.
   */
  const { data: openAttempts, error: openAttemptsError } = await supabase
    .from("payment_attempts")
    .select("id, status, transaction_id, phone")
    .eq("reservation_id", booking.id)
    .in("status", ["pending", "succeeded"])
    .is("settled_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  if (openAttemptsError) {
    console.error("[customer:payReservationDeposit] open attempt", openAttemptsError.message);
    return {
      ok: false,
      error: t("ecu.paymentCheckRetry"),
    };
  }

  const openAttempt = (openAttempts ?? []).find(
    (attempt) => attempt.status === "succeeded" || Boolean(attempt.transaction_id),
  );

  if (openAttempt?.status === "succeeded") {
    const settled = await settlePayment(openAttempt.id as string);
    if (!settled.ok) {
      return { ok: false, error: paymentErrorMessage(settled, t, "ecu.depositNotApplied") };
    }
    revalidatePath("/reservations");
    revalidatePath("/account");
    return { ok: true, status: "succeeded" };
  }
  if (openAttempt?.status === "pending" && openAttempt.transaction_id) {
    const current = await checkPaymentAttempt(openAttempt.id as string);
    if (current.status === "succeeded") {
      revalidatePath("/reservations");
      revalidatePath("/account");
      return { ok: true, status: "succeeded" };
    }
    if (current.status === "pending") {
      if (normalisePhone(String(openAttempt.phone ?? "")) === requestedPhone) {
        return {
          ok: true,
          status: "pending",
          attemptId: openAttempt.id as string,
          instruction: current.instruction,
        };
      }
      // Same rule as an order: an undialled Orange code is given up for the
      // number the customer now wants to pay from.
      const released =
        current.instruction?.customerInitiated === true &&
        !current.instruction.received &&
        (await releaseUndialledAttempt(openAttempt.id as string));
      if (!released) {
        return {
          ok: false,
          error:
            t("ecu.otherMomoActive"),
        };
      }
    }
  }

  const initiated = await initiatePaymentAttempt({
    kind: "reservation",
    restaurantId: booking.restaurant_id,
    reservationId: booking.id,
    reference: booking.reference,
    phone: requestedPhone,
    amount,
    returnPath: "/reservations",
    customer: { name: user.name, email: user.email },
  });

  if (!initiated.ok || !initiated.attemptId) {
    // The booking is NOT deleted on a failed charge, unlike the old
    // pay-at-booking path: the restaurant has already agreed to it, and
    // throwing away an accepted table because a payment did not go through
    // would lose the thing the customer is trying to keep. They can try again.
    return { ok: false, error: paymentErrorMessage(initiated, t, "ecu.depositPaymentFailed") };
  }

  if (initiated.status === "pending") {
    // Live mode: the customer must approve on their handset. The client polls
    // checkReservationPayment, and the CamerPay webhook settles it even if the
    // page is closed.
    return { ok: true, status: "pending", attemptId: initiated.attemptId, instruction: initiated.instruction };
  }

  // Sandbox: the attempt is already 'succeeded' — settle now. settlePayment
  // credits the restaurant's wallet, marks the deposit paid, and promotes the
  // booking to `confirmed`.
  const settled = await settlePayment(initiated.attemptId);
  if (!settled.ok) {
    console.error("[customer:payReservationDeposit] settle", settled.error);
    return { ok: false, error: paymentErrorMessage(settled, t, "ecu.depositNotApplied") };
  }

  revalidatePath("/reservations");
  revalidatePath("/account");
  return { ok: true, status: "succeeded" };
}

/**
 * Poll a pending reservation-deposit payment.
 *
 * Verifies the attempt belongs to one of the customer's OWN reservations
 * before touching it — an attempt id alone must not let a customer watch
 * somebody else's money move.
 */
export async function checkReservationPayment(
  attemptId: string,
): Promise<ActionResult & { status?: "succeeded" | "pending" | "failed"; instruction?: PaymentInstruction }> {
  const t = await getTranslator();
  const user = await requireUser();
  const supabase = createAdminClient();

  const { data: attempt } = await supabase
    .from("payment_attempts")
    .select("reservation_id")
    .eq("id", attemptId)
    .maybeSingle();

  if (!attempt?.reservation_id) return { ok: false, error: t("ecu.paymentNotFound") };

  const { data: reservation } = await supabase
    .from("reservations")
    .select("id")
    .eq("id", attempt.reservation_id)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (!reservation) return { ok: false, error: t("ecu.paymentNotFound") };

  const result = await checkPaymentAttempt(attemptId);
  if (!result.ok) return { ok: false, error: paymentErrorMessage(result, t, "ecu.paymentNotFound") };

  if (result.status === "succeeded") {
    revalidatePath("/reservations");
    revalidatePath("/account");
  }
  return { ok: true, status: result.status, instruction: result.instruction };
}

/** The financial result returned by the atomic cancellation claim. */
type ReservationCancellationResult = ActionResult & {
  status?: "cancelled" | "refund_pending" | "refunded" | "refund_failed";
  refundId?: string;
  refundAmount?: number;
  restaurantCompensation?: number;
  platformFee?: number;
};

type CancellationClaim = {
  reservationId: string;
  reference: string;
  restaurantId: string;
  refundId: string | null;
  refundAmount: number;
  restaurantCompensation: number;
  platformFee: number;
  refundStatus: "pending" | "completed" | "rejected" | null;
  phone: string | null;
  replyTo: string | null;
};

/**
 * Cancel a reservation and, when its deposit was paid, begin the Mobile Money
 * refund. The database RPC cancels the table, debits the restaurant wallet and
 * records the 70/25/5 split in one transaction. CamerPay then runs as a tracked
 * saga because an external network request cannot join a PostgreSQL transaction.
 */
export async function cancelOwnReservation(
  reservationId: string,
): Promise<ReservationCancellationResult> {
  const t = await getTranslator();
  const user = await requireUser();
  const supabase = createAdminClient();

  const { data: reservation, error } = await supabase
    .from("reservations")
    .select("id, reference, restaurant_id, guest_name, status, deposit_paid, reserved_for, duration_min")
    .eq("id", reservationId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (error || !reservation) return { ok: false, error: t("ecu.reservationNotFound") };
  if (!canCustomerCancelReservation(reservation.status)) {
    return { ok: false, error: t("ecu.reservationNotCancellable") };
  }

  // Do not race a charge still being approved on the customer's handset.
  const { data: openAttempt } = await supabase
    .from("payment_attempts")
    .select("id")
    .eq("reservation_id", reservationId)
    .in("status", ["pending", "succeeded"])
    .is("settled_at", null)
    .limit(1)
    .maybeSingle();
  if (openAttempt) {
    return {
      ok: false,
      error: t("ecu.paymentConfirming"),
    };
  }

  // A pending request whose slot passed was never accepted or paid. Let the
  // customer clear it even after it has moved from Upcoming to History.
  if (reservation.status === "pending" && !reservation.deposit_paid && Date.parse(reservation.reserved_for) <= Date.now()) {
    const { data: cleared, error: clearError } = await supabase
      .from("reservations")
      .update({ status: "cancelled" })
      .eq("id", reservationId)
      .eq("customer_id", user.id)
      .eq("status", "pending")
      .eq("deposit_paid", false)
      .lte("reserved_for", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (clearError || !cleared) return { ok: false, error: t("ecu.requestChanged") };
    await notify({
      event: "reservation",
      tone: "info",
      restaurantId: reservation.restaurant_id,
      href: "/m/reservations",
      params: {
        reference: reservation.reference,
        customerName: reservation.guest_name ?? user.name,
        status: "cancelled",
        cancelledBy: "customer",
      },
    });
    revalidatePath("/reservations");
    revalidatePath("/m/reservations");
    return { ok: true, status: "cancelled" };
  }

  if (
    !isUpcomingReservation({
      status: reservation.status,
      reservedFor: reservation.reserved_for,
      durationMin: reservation.duration_min,
    })
  ) {
    return { ok: false, error: t("ecu.slotPassed") };
  }
  const { data: claimData, error: claimError } = await supabase.rpc(
    "cancel_customer_reservation",
    {
      p_reservation_id: reservationId,
      p_customer_id: user.id,
      p_created_by: user.email,
    },
  );

  if (claimError) {
    console.error("[customer:cancelReservation]", claimError.message);
    if (claimError.message.includes("insufficient balance")) {
      return {
        ok: false,
        error: t("ecu.refundNotReserved"),
      };
    }
    if (claimError.message.includes("refund_below_provider_minimum")) {
      return {
        ok: false,
        error: t("ecu.refundBelowMin"),
      };
    }
    return { ok: false, error: t("ecu.cancelNotSaved") };
  }

  const claim = claimData as CancellationClaim;
  const resultBase = {
    refundId: claim.refundId ?? undefined,
    refundAmount: Number(claim.refundAmount ?? 0),
    restaurantCompensation: Number(claim.restaurantCompensation ?? 0),
    platformFee: Number(claim.platformFee ?? 0),
  };

  await notify({
    event: "reservation",
    tone: "error",
    restaurantId: reservation.restaurant_id,
    href: "/m/reservations",
    params: {
      reference: reservation.reference,
      customerName: reservation.guest_name ?? user.name,
      status: "cancelled",
      cancelledBy: "customer",
    },
  });
  // The table this booking held is free — the waitlist hears first (0068).
  await notifyWaitlist(reservation.restaurant_id, reservation.reserved_for);

  revalidatePath("/reservations");
  revalidatePath("/account");
  revalidatePath("/m/reservations");
  revalidatePath("/m/wallet");

  if (!claim.refundId || claim.refundAmount <= 0) {
    return { ok: true, status: "cancelled", ...resultBase };
  }
  if (claim.refundStatus === "completed") {
    return { ok: true, status: "refunded", ...resultBase };
  }
  /*
    THE SAME REFUND ENGINE AS EVERY OTHER REFUND (refund-payouts.ts).

    This used to call sendPayout() itself, with no claim — so the reconciler's
    refund sweep and this request could both send the same deposit. It also
    ignored the admin's switch (0062): startRefundPayout() claims first, then
    pays Mobile Money or credits the wallet as the admin decided, and the
    reconciler finishes whatever this request does not.
  */
  const outcome = await startRefundPayout(claim.refundId);
  return {
    ok: true,
    status: outcome === "refunded" ? "refunded" : "refund_pending",
    ...resultBase,
  };
}

/** Poll a reservation refund owned by the signed-in customer. */
export async function checkReservationRefund(
  refundId: string,
): Promise<ReservationCancellationResult> {
  const t = await getTranslator();
  const user = await requireUser();
  const supabase = createAdminClient();

  const { data: refund } = await supabase
    .from("refunds")
    .select("id, reservation_id, amount, status, phone, reply_to, restaurant_compensation, platform_fee")
    .eq("id", refundId)
    .maybeSingle();
  if (!refund?.reservation_id) return { ok: false, error: t("ecu.refundNotFound") };

  const { data: reservation } = await supabase
    .from("reservations")
    .select("id")
    .eq("id", refund.reservation_id)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (!reservation) return { ok: false, error: t("ecu.refundNotFound") };

  const resultBase = {
    refundId,
    refundAmount: Number(refund.amount),
    restaurantCompensation: Number(refund.restaurant_compensation ?? 0),
    platformFee: Number(refund.platform_fee ?? 0),
  };
  if (refund.status === "completed") return { ok: true, status: "refunded", ...resultBase };
  if (refund.status === "rejected") return { ok: true, status: "refund_failed", ...resultBase };
  const outcome = await settleRefundPayout(refundId);
  revalidatePath("/reservations");
  revalidatePath("/account");
  if (outcome === "refunded") return { ok: true, status: "refunded", ...resultBase };
  if (outcome === "failed") return { ok: true, status: "refund_failed", ...resultBase };
  return { ok: true, status: "refund_pending", ...resultBase };
}

/* ── Favourites ─────────────────────────────────────────────────────────── */

/** Add or remove a favourite — the same button both ways. */
export async function toggleFavorite(restaurantId: string): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("favorites")
    .select("restaurant_id")
    .eq("profile_id", user.id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("favorites")
        .delete()
        .eq("profile_id", user.id)
        .eq("restaurant_id", restaurantId)
    : await supabase
        .from("favorites")
        .insert({ profile_id: user.id, restaurant_id: restaurantId });

  if (error) return { ok: false, error: t("ecu.favoritesFailed") };

  revalidatePath("/browse");
  revalidatePath("/favorites");
  revalidatePath("/account");
  return { ok: true };
}

/* ── Addresses ──────────────────────────────────────────────────────────── */

// Messages are dictionary keys, translated by translateIssueMessage where the
// issue becomes the returned `error` — the schema cannot know who is reading.
const AddressSchema = z.object({
  label: z.string().trim().min(1, "ecu.v.addrLabel").max(40),
  recipientName: z.string().trim().min(1, "ecu.v.addrRecipient").max(120),
  phone: z.string().trim().min(1, "ecu.v.addrPhone").max(30),
  addressLine: z.string().trim().min(1, "ecu.v.addrLine").max(200),
  quartierName: z.string().trim().min(1, "ecu.v.addrQuartier"),
  landmark: z.string().trim().max(120).optional().default(""),
  isDefault: z.boolean().optional().default(false),
});

/**
 * Resolved quartiers are stored by id, so a renamed quartier keeps its
 * history coherent. The form sends the NAME for display; it is resolved here.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  AN UNRECOGNISED NAME IS NOW CREATED, NOT REFUSED.
 *
 *  This used to be an exact, case-sensitive, active-only lookup that returned
 *  null for anything else — and the caller turned that null into "Quartier
 *  inconnu.". A customer who lives somewhere we had not seeded could
 *  therefore not save their own address at all, which is a dead end on the
 *  one screen that has to work before they can order anything.
 *
 *  The exact-match was also wrong on its own terms: "Akwa" saved fine and
 *  "akwa" did not.
 * ─────────────────────────────────────────────────────────────────────────
 */
async function resolveQuartierId(name: string): Promise<string | null> {
  const areaId = await defaultServiceAreaId();
  if (!areaId) {
    console.error("[customer:resolveQuartierId] no service area configured");
    return null;
  }
  return resolveOrCreateQuartier(name, areaId);
}

async function clearOtherDefaults(profileId: string, keepId?: string) {
  const supabase = createAdminClient();
  let query = supabase
    .from("customer_addresses")
    .update({ is_default: false })
    .eq("profile_id", profileId)
    .eq("is_default", true);
  if (keepId) query = query.neq("id", keepId);
  await query;
}

/** Save a new delivery address for this customer. */
export async function saveOwnAddress(input: z.infer<typeof AddressSchema>): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();

  const parsed = AddressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error, t) };

  const quartierId = await resolveQuartierId(parsed.data.quartierName);
  if (!quartierId) return { ok: false, error: t("ecu.quartierFailed") };

  const supabase = createAdminClient();
  if (parsed.data.isDefault) await clearOtherDefaults(user.id);

  const { error } = await supabase.from("customer_addresses").insert({
    profile_id: user.id,
    label: parsed.data.label,
    recipient_name: parsed.data.recipientName,
    phone: parsed.data.phone,
    address_line: parsed.data.addressLine,
    quartier_id: quartierId,
    landmark: parsed.data.landmark.trim() || null,
    is_default: parsed.data.isDefault,
  });

  if (error) return { ok: false, error: t("ecu.addressSaveFailed") };

  revalidatePath("/addresses");
  revalidatePath("/checkout");
  return { ok: true };
}

/** Update one of this customer's addresses. */
export async function updateOwnAddress(
  addressId: string,
  input: z.infer<typeof AddressSchema>,
): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();

  const parsed = AddressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error, t) };

  const quartierId = await resolveQuartierId(parsed.data.quartierName);
  if (!quartierId) return { ok: false, error: t("ecu.quartierFailed") };

  const supabase = createAdminClient();
  if (parsed.data.isDefault) await clearOtherDefaults(user.id, addressId);

  const { error } = await supabase
    .from("customer_addresses")
    .update({
      label: parsed.data.label,
      recipient_name: parsed.data.recipientName,
      phone: parsed.data.phone,
      address_line: parsed.data.addressLine,
      quartier_id: quartierId,
      landmark: parsed.data.landmark.trim() || null,
      is_default: parsed.data.isDefault,
    })
    .eq("id", addressId)
    .eq("profile_id", user.id);

  if (error) return { ok: false, error: t("ecu.addressUpdateFailed") };

  revalidatePath("/addresses");
  revalidatePath("/checkout");
  return { ok: true };
}

/** Delete one of this customer's addresses. */
export async function deleteOwnAddress(addressId: string): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("customer_addresses")
    .delete()
    .eq("id", addressId)
    .eq("profile_id", user.id);

  if (error) return { ok: false, error: t("ecu.addressDeleteFailed") };

  revalidatePath("/addresses");
  revalidatePath("/checkout");
  return { ok: true };
}

/* ── Preferences ────────────────────────────────────────────────────────── */

/**
 * Persist the notification grid — every topic, every channel.
 *
 * `toStoredJson` re-applies each topic's locked channels, so a client that
 * posts `order_status.inApp = false` writes `true` anyway. The disabled switch
 * on the screen is a courtesy; this is the rule.
 */
export async function saveOwnPreferences(prefs: CustomerPreferences): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();

  const clean = toStoredJson(prefs);
  const supabase = createAdminClient();

  /*
    `push_enabled` IS WRITTEN IF IT EXISTS, AND SKIPPED IF IT DOES NOT.

    It is migration 0018's column, and it is missing from the live database —
    which made this upsert fail with 42703 on EVERY save since the screen
    shipped. `customer_preferences` is empty for exactly that reason, and the
    settings page reloaded showing defaults rather than admitting nothing had
    been stored.

    Nothing in this build reads it: the per-topic push answer lives inside
    notification_json. It is still written where it exists, because it is
    `not null` in the schema and an older build against the same database
    consults it — but a preference must not be lost to a column this code does
    not need. Migration 0039 adds it back.
  */
  const row = {
    profile_id: user.id,
    notification_json: clean,
    updated_at: new Date().toISOString(),
  };

  let { error } = await supabase
    .from("customer_preferences")
    .upsert({ ...row, push_enabled: anyPushWanted(prefs) }, { onConflict: "profile_id" });

  if (isMissingColumn(error, "push_enabled")) {
    console.warn(
      "[customer:saveOwnPreferences] customer_preferences.push_enabled is missing — run migration 0039. Preferences saved without it.",
    );
    ({ error } = await supabase
      .from("customer_preferences")
      .upsert(row, { onConflict: "profile_id" }));
  }

  if (error) {
    console.error("[customer:saveOwnPreferences]", error.code ?? "", error.message);
    return { ok: false, error: t("ecu.prefsFailed") };
  }

  revalidatePath("/settings");
  return { ok: true };
}

/* ── Account deletion ───────────────────────────────────────────────────── */

/**
 * Self-service deletion — ANONYMISES, exactly like the admin's
 * `anonymiseUser`, because deleting the rows would destroy the restaurants'
 * sales history and the platform's commission record (§12 hard rule #7).
 * The identity fields are overwritten and the auth user is deleted, which
 * revokes access permanently.
 */
export async function deleteOwnAccount(): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();

  const supabase = createAdminClient();
  const suffix = user.id.slice(0, 8);

  const { error } = await supabase
    .from("profiles")
    .update({
      name: "Compte supprimé",
      email: `anonyme-${suffix}@supprime.local`,
      phone: null,
      avatar_url: null,
      status: "suspended",
      deleted_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return { ok: false, error: t("ecu.accountDeleteFailed") };

  const { error: deleteError } = await supabase.auth.admin.deleteUser(user.authUserId);
  if (deleteError) {
    // The profile is already anonymised, so the account is unusable. Worth
    // knowing about, not worth failing the whole operation over.
    console.error("[customer:deleteOwnAccount] auth user deletion failed", deleteError.message);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/* ── Waitlist, booking changes, booking reviews (0068) ──────────────────── */

const SlotSchema = z.object({
  restaurantId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z.coerce.number().int().min(1).max(ABSOLUTE_MAX_PARTY),
});

/**
 * "Tell me if a table frees up" — for a slot the form greyed out as full.
 * The customer is told once, the moment a booking that overlapped it is
 * cancelled or declined (lib/data/waitlist.ts); booking still goes through
 * the normal availability check.
 */
export async function joinWaitlist(input: z.infer<typeof SlotSchema>): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();
  const parsed = SlotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("ecu.checkReservation") };
  const { restaurantId, date, time, partySize } = parsed.data;
  const limited = await rateLimit({ key: "booking:waitlist", identifier: user.id, limit: 20, windowMs: 60 * 60_000 });
  if (!limited.ok) return { ok: false, error: t("tbg.err.tryLater") };

  const config = await loadBookingConfig(restaurantId);
  if (!withinHorizon(date, config.horizonDays)) {
    return { ok: false, error: t("ons.err.tooFarAhead", { days: config.horizonDays }) };
  }
  const { error } = await createAdminClient().from("reservation_waitlist").insert({
    restaurant_id: restaurantId,
    customer_id: user.id,
    wanted_date: date,
    wanted_time: time,
    party_size: partySize,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: t("ons.err.alreadyWaiting") };
    console.error("[customer:joinWaitlist]", error.code ?? "", error.message);
    return { ok: false, error: isMissingColumn(error) ? t("ons.err.migration0068") : t("ons.err.waitlistFailed") };
  }
  revalidatePath("/reservations");
  return { ok: true };
}

export async function leaveWaitlist(entryId: string): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();
  if (!z.string().uuid().safeParse(entryId).success) return { ok: false, error: t("ons.err.waitlistFailed") };
  const { error } = await createAdminClient()
    .from("reservation_waitlist")
    .update({ status: "cancelled" })
    .eq("id", entryId)
    .eq("customer_id", user.id);
  if (error) return { ok: false, error: t("ons.err.waitlistFailed") };
  revalidatePath("/reservations");
  return { ok: true };
}

/**
 * Move a booking to another time or party size.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A request the restaurant has NOT answered yet is simply edited (the
 *  restaurant decides the new version). One it already ACCEPTED is not
 *  rewritten behind its back: the change is parked in `pending_change` and
 *  the original booking stands until the board accepts or declines it
 *  (decideReservationChange). Either way the new slot must pass the same
 *  rules as a new booking, not counting this booking's own tables.
 *
 *  A deposit already paid stays as it is — it was for this table, and what
 *  remains of a per-seat fee is settled at the restaurant.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function requestReservationChange(
  reservationId: string,
  input: { date: string; time: string; partySize: number },
): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();
  if (!z.string().uuid().safeParse(reservationId).success) return { ok: false, error: t("ecu.reservationNotFound") };
  const supabase = createAdminClient();
  const { data: booking } = await supabase
    .from("reservations")
    .select("id, reference, restaurant_id, status, reserved_for, party_size, deposit_paid, guest_name")
    .eq("id", reservationId)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (!booking) return { ok: false, error: t("ecu.reservationNotFound") };
  if (!["pending", "awaiting_payment", "confirmed"].includes(booking.status)) {
    return { ok: false, error: t("ons.err.changeNotAllowed") };
  }
  // Changing at the last minute is a phone call to the room, not a request.
  if (Date.parse(booking.reserved_for) - Date.now() < 2 * 60 * 60_000) {
    return { ok: false, error: t("ons.err.changeTooLate") };
  }

  const parsed = SlotSchema.safeParse({ ...input, restaurantId: booking.restaurant_id });
  if (!parsed.success) return { ok: false, error: t("ecu.checkReservation") };
  const { date, time, partySize } = parsed.data;
  const when = new Date(`${date}T${time}:00+01:00`);
  if (when.getTime() <= Date.now() + 30 * 60_000) return { ok: false, error: t("ecu.chooseFutureDate") };

  const [{ data: hoursRows }, config] = await Promise.all([
    supabase.from("restaurant_hours").select("weekday, opens_at, closes_at").eq("restaurant_id", booking.restaurant_id),
    loadBookingConfig(booking.restaurant_id),
  ]);
  const hours = ((hoursRows ?? []) as { weekday: number; opens_at: string | null; closes_at: string | null }[])
    .map((row) => ({ weekday: row.weekday, opensAt: row.opens_at, closesAt: row.closes_at }));
  if (!slotsForDate(hours, date).slots.includes(time)) return { ok: false, error: t("ecu.slotOutsideHours") };
  if (!withinHorizon(date, config.horizonDays)) return { ok: false, error: t("ons.err.tooFarAhead", { days: config.horizonDays }) };
  if (closureOn(date, config.closures)) return { ok: false, error: t("ons.err.closedOnDate") };

  const groupRequest = isGroupRequest(partySize, config.maxParty);
  if (!groupRequest) {
    const durationMin = await getReservationDuration(booking.restaurant_id, supabase);
    const [floor, holding] = await Promise.all([
      loadFloorPlan(booking.restaurant_id).catch(() => null),
      loadHoldingBookings(booking.restaurant_id, when, when, durationMin),
    ]);
    if (!floor || !holding) return { ok: false, error: t("ecu.availabilityFailed") };
    const others = holding.filter((other) => other.id !== booking.id);
    if (slotVerdict({ tables: floor, bookings: others, at: when, durationMin, partySize, maxArrivals: config.maxArrivals }) !== "ok") {
      return { ok: false, error: t("ecu.slotFull") };
    }
  }

  const whenLabel = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Douala", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(when);

  if (booking.status === "pending") {
    const deposit = await readDepositConfig(supabase, booking.restaurant_id);
    const patch: Record<string, unknown> = {
      reserved_for: when.toISOString(),
      party_size: partySize,
      is_group_request: groupRequest,
      pending_change: null,
    };
    if (!booking.deposit_paid) patch.deposit_amount = depositChargedNow(deposit, partySize);
    const { data: moved, error } = await supabase.from("reservations").update(patch)
      .eq("id", booking.id).eq("status", "pending").select("id").maybeSingle();
    if (error || !moved) {
      if (error) console.error("[customer:requestReservationChange] edit", error.code ?? "", error.message);
      return { ok: false, error: error && isMissingColumn(error) ? t("ons.err.migration0068") : t("ecu.requestChanged") };
    }
  } else {
    const { error } = await supabase.from("reservations").update({
      pending_change: { reservedFor: when.toISOString(), partySize, requestedAt: new Date().toISOString() },
    }).eq("id", booking.id).in("status", ["awaiting_payment", "confirmed"]);
    if (error) {
      console.error("[customer:requestReservationChange] park", error.code ?? "", error.message);
      return { ok: false, error: isMissingColumn(error) ? t("ons.err.migration0068") : t("ecu.requestChanged") };
    }
  }

  await notify({
    event: "reservation",
    tone: "warning",
    restaurantId: booking.restaurant_id,
    href: "/m/reservations",
    params: {
      reference: booking.reference,
      customerName: booking.guest_name ?? user.name,
      partySize,
      whenLabel,
      reservationUpdate: "change_requested",
    },
  });
  // The old slot may have freed a table.
  if (booking.status === "pending") await notifyWaitlist(booking.restaurant_id, booking.reserved_for);

  revalidatePath("/reservations");
  revalidatePath("/m/reservations");
  return { ok: true, note: booking.status === "pending" ? "moved" : "requested" };
}

/** Withdraw a change request the restaurant has not answered. */
export async function cancelReservationChange(reservationId: string): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();
  if (!z.string().uuid().safeParse(reservationId).success) return { ok: false, error: t("ecu.reservationNotFound") };
  const { error } = await createAdminClient().from("reservations").update({ pending_change: null })
    .eq("id", reservationId).eq("customer_id", user.id);
  if (error) return { ok: false, error: t("ecu.requestChanged") };
  revalidatePath("/reservations");
  revalidatePath("/m/reservations");
  return { ok: true };
}

/**
 * Rate a visit made with a booking — and, optionally, the platform itself.
 * Only after the visit (completed, or seated and its day is over), once.
 */
export async function submitReservationReview(
  reservationId: string,
  input: { rating: number; body?: string; platformRating?: number | null; platformBody?: string },
): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();
  if (!z.string().uuid().safeParse(reservationId).success) return { ok: false, error: t("ecu.reservationNotFound") };
  const rating = Math.round(Number(input.rating));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: t("ecu.ratingRange") };

  const supabase = createAdminClient();
  const { data: booking } = await supabase
    .from("reservations")
    .select("id, reference, restaurant_id, status, reserved_for")
    .eq("id", reservationId)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (!booking) return { ok: false, error: t("ecu.reservationNotFound") };
  const visited = booking.status === "completed" ||
    (booking.status === "seated" && Date.parse(booking.reserved_for) < Date.now());
  if (!visited) return { ok: false, error: t("ons.err.reviewAfterVisit") };

  const { error } = await supabase.from("reviews").insert({
    restaurant_id: booking.restaurant_id,
    customer_id: user.id,
    customer_name: user.name,
    rating,
    body: (input.body ?? "").trim().slice(0, 2000),
    reservation_id: booking.id,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: t("ons.err.alreadyReviewed") };
    console.error("[customer:submitReservationReview]", error.code ?? "", error.message);
    return { ok: false, error: isMissingColumn(error) ? t("ons.err.migration0068") : t("ecu.publishFailed") };
  }

  await savePlatformFeedback({
    source: "reservation",
    rating: input.platformRating ?? null,
    body: input.platformBody ?? "",
    restaurantId: booking.restaurant_id,
    customerId: user.id,
  });

  await notify({
    event: "review",
    tone: "info",
    restaurantId: booking.restaurant_id,
    href: "/m/reviews",
    params: { rating, customerName: user.name, reference: booking.reference },
  });
  revalidatePath("/reservations");
  revalidatePath("/restaurants");
  return { ok: true };
}

/**
 * "How do you find Resto237? What can we improve?" — optional, from any
 * signed-in customer (after an order, a booking, or on its own).
 */
export async function submitPlatformFeedback(input: {
  source: "order" | "reservation" | "other";
  rating?: number | null;
  body: string;
  restaurantId?: string | null;
}): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();
  const limited = await rateLimit({ key: "feedback:platform", identifier: user.id, limit: 5, windowMs: 60 * 60_000 });
  if (!limited.ok) return { ok: false, error: t("tbg.err.tryLater") };
  if (!input.body?.trim() && !input.rating) return { ok: false, error: t("tbg.err.writeFirst") };
  const saved = await savePlatformFeedback({
    source: ["order", "reservation", "other"].includes(input.source) ? input.source : "other",
    rating: input.rating ?? null,
    body: input.body,
    restaurantId: input.restaurantId && z.string().uuid().safeParse(input.restaurantId).success ? input.restaurantId : null,
    customerId: user.id,
  });
  return saved ? { ok: true } : { ok: false, error: t("ons.err.feedbackFailed") };
}

async function savePlatformFeedback(input: {
  source: "order" | "reservation" | "other";
  rating: number | null;
  body: string;
  restaurantId: string | null;
  customerId: string;
}): Promise<boolean> {
  const body = input.body.trim().slice(0, 2000);
  const rating = Number(input.rating);
  const validRating = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
  if (!body && !validRating) return true;
  const { error } = await createAdminClient().from("platform_feedback").insert({
    source: input.source,
    rating: validRating,
    body: body || "—",
    restaurant_id: input.restaurantId,
    customer_id: input.customerId,
  });
  if (error) console.error("[customer:platformFeedback]", error.code ?? "", error.message);
  return !error;
}
