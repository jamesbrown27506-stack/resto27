"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { canCustomerCancel } from "@/lib/format/order-status";
import { notify } from "@/lib/notify";
import { saveUpload, type UploadKind } from "@/lib/uploads";
import { awardDeliveryPoints } from "@/lib/orders/award-points";
import { defaultServiceAreaId, resolveOrCreateQuartier } from "./quartiers";
import { anyPushWanted, toStoredJson } from "@/lib/notifications/customer-topics";
import {
  depositChargedNow,
  normaliseDepositType,
  type DepositConfig,
} from "@/lib/reservations/deposit";
import {
  checkPaymentAttempt,
  initiatePaymentAttempt,
  settlePayment,
} from "@/lib/payments/collect";
import type { ActionResult } from "./admin-actions";
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
  const user = await requireUser();
  const supabase = createAdminClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, customer_id, restaurant_id, reference, status")
    .eq("id", orderId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (error || !order) return { ok: false, error: "Commande introuvable." };
  if (!canCustomerCancel(order.status as CustomerStatus)) {
    return { ok: false, error: "Cette commande ne peut plus être annulée." };
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: "cancelled", cancelled_reason: "Annulée par le client", cancelled_at: now })
    .eq("id", orderId)
    .eq("status", order.status);

  if (updateError) return { ok: false, error: "L'annulation a échoué." };

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

type CustomerStatus = "pending" | "confirmed" | "preparing" | "shipped" | "delivered" | "cancelled";

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
  const user = await requireUser();
  const supabase = createAdminClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, customer_id, restaurant_id, reference, status, type, subtotal")
    .eq("id", orderId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (error || !order) return { ok: false, error: "Commande introuvable." };

  if (order.status !== "shipped") {
    return {
      ok: false,
      error:
        order.status === "delivered"
          ? "Cette commande est déjà marquée comme reçue."
          : "Vous pourrez confirmer la réception dès que la commande sera en route.",
    };
  }

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
    return { ok: false, error: "La confirmation a échoué. Réessayez." };
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
  const user = await requireUser();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Note entre 1 et 5." };
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
    return { ok: false, error: "Cette commande ne peut pas être notée." };
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({ delivery_rating: rating })
    .eq("id", orderId);

  if (updateError) return { ok: false, error: "L'enregistrement a échoué." };

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
  await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file received." };

  const result = await saveUpload(file, "reviews" satisfies UploadKind);
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, url: result.url };
}

export async function submitOwnReview(
  orderId: string,
  rating: number,
  body: string,
  photoUrls: string[] = [],
): Promise<ActionResult> {
  const user = await requireUser();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Note entre 1 et 5." };
  }
  if (body.trim().length < 10) return { ok: false, error: "Votre avis doit faire au moins 10 caractères." };

  const supabase = createAdminClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, restaurant_id, status, reference")
    .eq("id", orderId)
    .eq("customer_id", user.id)
    .eq("status", "delivered")
    .maybeSingle();

  if (error || !order) return { ok: false, error: "Commande introuvable." };

  const { data: existing, error: dupError } = await supabase
    .from("reviews")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();

  if (dupError) return { ok: false, error: "Un avis existe déjà pour cette commande." };
  if (existing) return { ok: false, error: "Un avis existe déjà pour cette commande." };

  // Photos are capped at three and must be URLs on our own storage — a
  // review must not embed arbitrary external content.
  const photos = photoUrls
    .filter((url): url is string => typeof url === "string" && url.includes("/storage/v1/object/public/"))
    .slice(0, 3);

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

  if (insertError || !created) return { ok: false, error: "La publication a échoué." };

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
    params: { rating, customerName: user.name },
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
  const user = await requireUser();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Note entre 1 et 5." };
  }
  if (body.trim().length < 10) return { ok: false, error: "Votre avis doit faire au moins 10 caractères." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("reviews")
    .update({ rating, body: body.trim() })
    .eq("id", reviewId)
    .eq("customer_id", user.id);

  if (error) return { ok: false, error: "La mise à jour a échoué." };

  revalidatePath("/reviews");
  revalidatePath("/restaurants");
  return { ok: true };
}

/** Remove one of your own reviews — the customer's word, not the manager's. */
export async function deleteOwnReview(reviewId: string): Promise<ActionResult> {
  const user = await requireUser();

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("reviews")
    .delete()
    .eq("id", reviewId)
    .eq("customer_id", user.id);

  if (error) return { ok: false, error: "La suppression a échoué." };

  revalidatePath("/reviews");
  revalidatePath("/restaurants");
  return { ok: true };
}

/* ── Reservations ───────────────────────────────────────────────────────── */

const ReservationSchema = z.object({
  restaurantId: z.string().uuid(),
  reservedFor: z.string().datetime(),
  partySize: z.coerce.number().int().min(1).max(20),
  notes: z.string().max(500).optional().default(""),
  /** Mobile Money number — required only when the restaurant charges a fixed
   *  reservation fee, which the customer pays online at booking. */
  phone: z.string().optional().default(""),
});

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
function isMissingColumn(error: { code?: string; message?: string } | null, column: string) {
  if (!error) return false;
  const known = error.code === "42703" || error.code === "PGRST204";
  return known && (error.message ?? "").includes(column);
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
): Promise<ActionResult & { status?: "succeeded" | "pending"; attemptId?: string }> {
  const user = await requireUser();

  const parsed = ReservationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Vérifiez les informations de la réservation." };

  const { restaurantId, reservedFor, partySize, notes, phone } = parsed.data;
  const when = new Date(reservedFor);
  if (when.getTime() <= Date.now()) return { ok: false, error: "Choisissez une date à venir." };

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
    .select("id, status")
    .eq("id", restaurantId)
    .eq("status", "active")
    .maybeSingle();

  if (restaurantError) {
    console.error(
      "[customer:createOwnReservation] restaurant lookup",
      restaurantError.code ?? "",
      restaurantError.message,
    );
    return { ok: false, error: "La disponibilité n'a pas pu être vérifiée. Réessayez." };
  }
  if (!restaurant) return { ok: false, error: "Restaurant introuvable." };

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

  const slotStart = new Date(when.getTime() - 30 * 60_000).toISOString();
  const slotEnd = new Date(when.getTime() + 90 * 60_000).toISOString();

  const { count: tableCount } = await supabase
    .from("restaurant_tables")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId);

  const capacity = tableCount ?? 0;
  if (capacity > 0) {
    const { data: overlapping, error: overlapError } = await supabase
      .from("reservations")
      .select("id")
      .eq("restaurant_id", restaurantId)
      // `awaiting_payment` counts: the restaurant has committed the seat and
      // is waiting to be paid for it, so it must not be sold twice meanwhile.
      .in("status", ["pending", "awaiting_payment", "confirmed", "seated"])
      .gte("reserved_for", slotStart)
      .lte("reserved_for", slotEnd);

    if (overlapError) return { ok: false, error: "La disponibilité n'a pas pu être vérifiée." };
    if ((overlapping ?? []).length >= capacity) {
      return { ok: false, error: "Plus de table disponible sur ce créneau." };
    }
  }

  const reference = `RES-${randomUUID().slice(0, 4).toUpperCase()}`;
  /*
    `deposit_percent` is kept OUT of the base row and added on top, so the
    retry below has something to fall back to that was never assembled with
    it — rather than destructuring the key back out of an object that has it.
  */
  const baseRow = {
    reference,
    restaurant_id: restaurantId,
    customer_id: user.id,
    guest_name: user.name,
    guest_phone: phone.trim() || user.phone || "",
    party_size: partySize,
    reserved_for: reservedFor,
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

  let inserted: { id: string } | null = null;
  let insertError = null as { code?: string; message?: string } | null;

  {
    const attempt = await supabase.from("reservations").insert(row).select("id").single();
    inserted = attempt.data as { id: string } | null;
    insertError = attempt.error;

    // Same skipped migration as the deposit read above: `deposit_percent` is
    // 0031's column on `reservations`. Without it the whole insert is refused,
    // so the booking is retried without the snapshot — a request that reaches
    // the restaurant beats one lost to a column the fee never used anyway.
    if (isMissingColumn(insertError, "deposit_percent")) {
      console.warn(
        "[customer:createOwnReservation] reservations.deposit_percent is missing — run migration 0031 (or 0033_catch_up). Booking saved without the percentage snapshot.",
      );
      const retry = await supabase.from("reservations").insert(baseRow).select("id").single();
      inserted = retry.data as { id: string } | null;
      insertError = retry.error;
    }
  }

  if (insertError || !inserted) {
    console.error(
      "[customer:createOwnReservation] insert",
      insertError?.code ?? "",
      insertError?.message ?? "no row returned",
    );
    return { ok: false, error: "La demande n'a pas pu être envoyée." };
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

  // A booking request is only real once someone at the restaurant has seen it.
  await notify({
    event: "reservation",
    tone: "info",
    restaurantId,
    href: "/m/reservations",
    params: { reference, customerName: user.name, partySize },
  });

  revalidatePath("/reservations");
  revalidatePath("/account");
  return { ok: true, status: "succeeded" };
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
): Promise<ActionResult & { status?: "succeeded" | "pending"; attemptId?: string }> {
  const user = await requireUser();

  if (!z.string().uuid().safeParse(reservationId).success) {
    return { ok: false, error: "Réservation introuvable." };
  }
  if (!phone.trim()) {
    return { ok: false, error: "Numéro Mobile Money requis pour régler l'acompte." };
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("reservations")
    .select("id, reference, restaurant_id, status, deposit_amount, deposit_paid")
    .eq("id", reservationId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[customer:payReservationDeposit] lookup", error.message);
    return { ok: false, error: "La réservation n'a pas pu être vérifiée. Réessayez." };
  }
  if (!data) return { ok: false, error: "Réservation introuvable." };

  const booking = data as {
    id: string;
    reference: string;
    restaurant_id: string;
    status: string;
    deposit_amount: number | null;
    deposit_paid: boolean | null;
  };

  if (booking.deposit_paid) return { ok: false, error: "Cet acompte a déjà été réglé." };
  if (booking.status !== "awaiting_payment") {
    // Either the restaurant has not decided yet, or it declined, or the table
    // is already confirmed. None of them is a bill.
    return { ok: false, error: "Cette réservation n'attend pas de paiement." };
  }

  const amount = Number(booking.deposit_amount ?? 0);
  if (amount <= 0) return { ok: false, error: "Aucun acompte n'est dû pour cette réservation." };

  const initiated = await initiatePaymentAttempt({
    kind: "reservation",
    restaurantId: booking.restaurant_id,
    reservationId: booking.id,
    reference: booking.reference,
    phone,
    amount,
  });

  if (!initiated.ok || !initiated.attemptId) {
    // The booking is NOT deleted on a failed charge, unlike the old
    // pay-at-booking path: the restaurant has already agreed to it, and
    // throwing away an accepted table because a payment did not go through
    // would lose the thing the customer is trying to keep. They can try again.
    return { ok: false, error: initiated.error ?? "Le paiement de l'acompte a échoué." };
  }

  if (initiated.status === "pending") {
    // Live mode: the customer must approve on their handset. The client polls
    // checkReservationPayment, and the CamerPay webhook settles it even if the
    // page is closed.
    return { ok: true, status: "pending", attemptId: initiated.attemptId };
  }

  // Sandbox: the attempt is already 'succeeded' — settle now. settlePayment
  // credits the restaurant's wallet, marks the deposit paid, and promotes the
  // booking to `confirmed`.
  const settled = await settlePayment(initiated.attemptId);
  if (!settled.ok) {
    console.error("[customer:payReservationDeposit] settle", settled.error);
    return { ok: false, error: settled.error ?? "L'acompte n'a pas pu être appliqué." };
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
): Promise<ActionResult & { status?: "succeeded" | "pending" | "failed" }> {
  const user = await requireUser();
  const supabase = createAdminClient();

  const { data: attempt } = await supabase
    .from("payment_attempts")
    .select("reservation_id")
    .eq("id", attemptId)
    .maybeSingle();

  if (!attempt?.reservation_id) return { ok: false, error: "Paiement introuvable." };

  const { data: reservation } = await supabase
    .from("reservations")
    .select("id")
    .eq("id", attempt.reservation_id)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (!reservation) return { ok: false, error: "Paiement introuvable." };

  const result = await checkPaymentAttempt(attemptId);
  if (!result.ok) return { ok: false, error: result.error ?? "Paiement introuvable." };

  if (result.status === "succeeded") {
    revalidatePath("/reservations");
    revalidatePath("/account");
  }
  return { ok: true, status: result.status };
}

/** Cancel one of your own pending/confirmed reservations. */
export async function cancelOwnReservation(reservationId: string): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = createAdminClient();

  const { data: reservation, error } = await supabase
    .from("reservations")
    .select("id, status")
    .eq("id", reservationId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (error || !reservation) return { ok: false, error: "Réservation introuvable." };
  if (reservation.status !== "pending" && reservation.status !== "confirmed") {
    return { ok: false, error: "Cette réservation ne peut plus être annulée." };
  }

  const { error: updateError } = await supabase
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("id", reservationId)
    .eq("status", reservation.status);

  if (updateError) return { ok: false, error: "L'annulation a échoué." };

  revalidatePath("/reservations");
  revalidatePath("/account");
  return { ok: true };
}

/* ── Favourites ─────────────────────────────────────────────────────────── */

/** Add or remove a favourite — the same button both ways. */
export async function toggleFavorite(restaurantId: string): Promise<ActionResult> {
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

  if (error) return { ok: false, error: "La mise à jour des favoris a échoué." };

  revalidatePath("/browse");
  revalidatePath("/favorites");
  revalidatePath("/account");
  return { ok: true };
}

/* ── Addresses ──────────────────────────────────────────────────────────── */

const AddressSchema = z.object({
  label: z.string().trim().min(1, "Donnez un libellé.").max(40),
  recipientName: z.string().trim().min(1, "Nom du destinataire requis.").max(120),
  phone: z.string().trim().min(1, "Téléphone requis.").max(30),
  addressLine: z.string().trim().min(1, "Adresse requise.").max(200),
  quartierName: z.string().trim().min(1, "Quartier requis."),
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
  const user = await requireUser();

  const parsed = AddressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Vérifiez le formulaire." };

  const quartierId = await resolveQuartierId(parsed.data.quartierName);
  if (!quartierId) return { ok: false, error: "Impossible d'enregistrer ce quartier. Réessayez." };

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

  if (error) return { ok: false, error: "L'adresse n'a pas pu être enregistrée." };

  revalidatePath("/addresses");
  revalidatePath("/checkout");
  return { ok: true };
}

/** Update one of this customer's addresses. */
export async function updateOwnAddress(
  addressId: string,
  input: z.infer<typeof AddressSchema>,
): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = AddressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Vérifiez le formulaire." };

  const quartierId = await resolveQuartierId(parsed.data.quartierName);
  if (!quartierId) return { ok: false, error: "Impossible d'enregistrer ce quartier. Réessayez." };

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

  if (error) return { ok: false, error: "L'adresse n'a pas pu être mise à jour." };

  revalidatePath("/addresses");
  revalidatePath("/checkout");
  return { ok: true };
}

/** Delete one of this customer's addresses. */
export async function deleteOwnAddress(addressId: string): Promise<ActionResult> {
  const user = await requireUser();

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("customer_addresses")
    .delete()
    .eq("id", addressId)
    .eq("profile_id", user.id);

  if (error) return { ok: false, error: "L'adresse n'a pas pu être supprimée." };

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
    return { ok: false, error: "Les préférences n'ont pas pu être enregistrées." };
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

  if (error) return { ok: false, error: "La suppression du compte a échoué." };

  const { error: deleteError } = await supabase.auth.admin.deleteUser(user.authUserId);
  if (deleteError) {
    // The profile is already anonymised, so the account is unusable. Worth
    // knowing about, not worth failing the whole operation over.
    console.error("[customer:deleteOwnAccount] auth user deletion failed", deleteError.message);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}