"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { canCustomerCancel } from "@/lib/format/order-status";
import { notify } from "@/lib/notify";
import { saveUpload, type UploadKind } from "@/lib/uploads";
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

  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants")
    .select("id, status, deposit_amount, deposit_type")
    .eq("id", restaurantId)
    .eq("status", "active")
    .maybeSingle();

  if (restaurantError || !restaurant) return { ok: false, error: "Restaurant introuvable." };
  const restaurantRow = restaurant as { deposit_amount?: number; deposit_type?: string };
  const depositAmount = Number(restaurantRow.deposit_amount ?? 0);
  const depositType = restaurantRow.deposit_type === "percent" ? "percent" : "fixed";
  const depositPercent = depositType === "percent" ? depositAmount : 0;

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
      .in("status", ["pending", "confirmed", "seated"])
      .gte("reserved_for", slotStart)
      .lte("reserved_for", slotEnd);

    if (overlapError) return { ok: false, error: "La disponibilité n'a pas pu être vérifiée." };
    if ((overlapping ?? []).length >= capacity) {
      return { ok: false, error: "Plus de table disponible sur ce créneau." };
    }
  }

  const reference = `RES-${randomUUID().slice(0, 4).toUpperCase()}`;
  const { data: inserted, error: insertError } = await supabase
    .from("reservations")
    .insert({
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
      deposit_amount: depositType === "fixed" ? depositAmount : 0,
      deposit_percent: depositPercent,
      notes: notes.trim() || null,
    })
    .select("id")
    .single();

  if (insertError || !inserted) return { ok: false, error: "La demande n'a pas pu être envoyée." };
  const reservationId = inserted.id as string;

  // A fixed reservation fee is paid ONLINE at booking (0031): the customer's
  // Mobile Money is charged through the platform's payment path, the money is
  // credited to the restaurant's wallet, and the booking is marked paid. The
  // fee is DEDUCTED from the customer's final bill. A percentage fee is never
  // charged here — the bill is unknown at booking — and is collected at the
  // restaurant against the real bill.
  const fixedFee = depositType === "fixed" && depositAmount > 0;

  if (fixedFee) {
    if (!phone.trim()) {
      // The booking exists but was never paid for — remove it so the request
      // fails cleanly and the customer can book again with a phone number.
      await supabase.from("reservations").delete().eq("id", reservationId);
      return { ok: false, error: "Numéro Mobile Money requis pour régler l'acompte." };
    }

    const initiated = await initiatePaymentAttempt({
      kind: "reservation",
      restaurantId,
      reservationId,
      reference,
      phone,
      amount: depositAmount,
    });

    if (!initiated.ok || !initiated.attemptId) {
      await supabase.from("reservations").delete().eq("id", reservationId);
      return { ok: false, error: initiated.error ?? "Le paiement de l'acompte a échoué." };
    }

    if (initiated.status === "pending") {
      // Live mode: the customer must approve on their handset. The booking is
      // real but unpaid; the client polls checkReservationPayment, and the
      // CamerPay webhook settles it even if the page is closed.
      return { ok: true, status: "pending", attemptId: initiated.attemptId };
    }

    // Sandbox: the attempt is already 'succeeded' — settle now (credits the
    // restaurant's wallet and marks the booking deposit paid).
    const settled = await settlePayment(initiated.attemptId);
    if (!settled.ok) {
      console.error("[customer:createOwnReservation] settle", settled.error);
      return { ok: false, error: settled.error ?? "L'acompte n'a pas pu être appliqué." };
    }
  }

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
 * history coherent. The form sends the NAME for display; it is resolved here,
 * scoped to the active service area.
 */
async function resolveQuartierId(name: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("quartiers")
    .select("id")
    .eq("name", name)
    .eq("is_active", true)
    .maybeSingle();
  return data?.id ?? null;
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
  if (!quartierId) return { ok: false, error: "Quartier inconnu." };

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
  if (!quartierId) return { ok: false, error: "Quartier inconnu." };

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
 * Persist the notification switches. The order-status switch is locked in the
 * UI, but it is stored anyway so the saved row describes the full screen.
 */
export async function saveOwnPreferences(prefs: CustomerPreferences): Promise<ActionResult> {
  const user = await requireUser();

  const clean = {
    order_status: Boolean(prefs.orderStatus),
    reservations: Boolean(prefs.reservations),
    loyalty: Boolean(prefs.loyalty),
    promotions: Boolean(prefs.promotions),
  };

  const supabase = createAdminClient();
  const { error } = await supabase.from("customer_preferences").upsert(
    {
      profile_id: user.id,
      notification_json: clean,
      push_enabled: prefs.pushEnabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" },
  );

  if (error) return { ok: false, error: "Les préférences n'ont pas pu être enregistrées." };

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