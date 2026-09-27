"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import { getTranslator } from "@/lib/i18n/locale-server";
import { notify } from "@/lib/notify";
import { isMissingColumn } from "./missing-column";
import { loadBookingConfig, loadFloorPlan, loadHoldingBookings } from "./booking-rules";
import { notifyWaitlist } from "./waitlist";
import { getReservationDuration } from "@/lib/reservations/duration-server";
import { chooseTables, seatPartyAt } from "@/lib/reservations/tables";
import { ABSOLUTE_MAX_PARTY, closureOn, OCCASIONS } from "@/lib/reservations/rules";
import type { ActionResult } from "./admin-actions";

/**
 * The back office's booking tools that came with 0068 — change requests,
 * phone bookings, guest notes, table suggestions, and the restaurant's own
 * booking rules (maximum party, arrivals per slot, closures, tips).
 *
 * Every action re-checks its capability: a Server Action is a public POST
 * endpoint and never passes through the page that shows the button.
 */

const uuid = z.string().uuid();

function whenLabel(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Douala", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

/** Accept or decline a customer's request to move a confirmed booking. */
export async function decideReservationChange(
  reservationId: string,
  accept: boolean,
  reason?: string,
): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("reservations.decide");
  if (!uuid.safeParse(reservationId).success) return { ok: false, error: t("ecu.reservationNotFound") };
  const supabase = createAdminClient();
  const { data: booking } = await supabase
    .from("reservations")
    .select("id, reference, customer_id, status, reserved_for, party_size, pending_change")
    .eq("id", reservationId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();
  const change = (booking?.pending_change ?? null) as { reservedFor?: string; partySize?: number } | null;
  if (!booking || !change?.reservedFor) return { ok: false, error: t("ons.err.noChangePending") };

  if (!accept) {
    await supabase.from("reservations").update({ pending_change: null }).eq("id", booking.id);
  } else {
    const newStart = new Date(change.reservedFor);
    const partySize = Math.max(1, Math.min(ABSOLUTE_MAX_PARTY, Number(change.partySize ?? booking.party_size)));
    // The slot is checked again: the floor may have filled since the request.
    const durationMin = await getReservationDuration(active.restaurantId, supabase);
    const [floor, holding] = await Promise.all([
      loadFloorPlan(active.restaurantId).catch(() => null),
      loadHoldingBookings(active.restaurantId, newStart, newStart, durationMin),
    ]);
    if (!floor || !holding) return { ok: false, error: t("ecu.availabilityFailed") };
    if (floor.length > 0) {
      const seat = seatPartyAt({
        tables: floor,
        bookings: holding.filter((h) => h.id !== booking.id),
        at: newStart,
        durationMin,
        partySize,
      });
      if (!seat) return { ok: false, error: t("ecu.slotFull") };
    }
    const { data: moved, error } = await supabase
      .from("reservations")
      .update({ reserved_for: newStart.toISOString(), party_size: partySize, pending_change: null, table_id: null })
      .eq("id", booking.id)
      .in("status", ["awaiting_payment", "confirmed"])
      .select("id")
      .maybeSingle();
    if (error || !moved) return { ok: false, error: t("est.reservationChangedDeciding") };
    // New time, new tables: the old assignment no longer holds.
    await supabase.from("reservation_tables").delete().eq("reservation_id", booking.id);
    await notifyWaitlist(active.restaurantId, booking.reserved_for);
  }

  if (booking.customer_id) {
    await notify({
      event: "reservation_decision",
      tone: accept ? "success" : "warning",
      customerId: booking.customer_id,
      href: "/reservations",
      params: {
        reference: booking.reference,
        restaurantName: active.restaurantName,
        reservationUpdate: accept ? "change_accepted" : "change_declined",
        whenLabel: accept ? whenLabel(change.reservedFor) : undefined,
        reason: accept ? undefined : reason?.trim().slice(0, 300) || undefined,
      },
    });
  }
  revalidatePath("/m/reservations");
  revalidatePath("/reservations");
  return { ok: true };
}

const PhoneBookingSchema = z.object({
  guestName: z.string().trim().min(2).max(80),
  guestPhone: z.string().trim().max(20).optional().default(""),
  partySize: z.coerce.number().int().min(1).max(ABSOLUTE_MAX_PARTY),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().max(500).optional().default(""),
  occasion: z.enum(OCCASIONS).optional().nullable(),
  tableIds: z.array(z.string().uuid()).max(12).optional().default([]),
});

/**
 * A booking taken by telephone or at the counter.
 *
 * The restaurant is the one agreeing, so it is created CONFIRMED, with no
 * online deposit (anything asked is collected at the restaurant). It still
 * gets a voucher code and holds its tables like any other booking, so the
 * online form cannot sell the same table twice.
 */
export async function createPhoneReservation(input: z.input<typeof PhoneBookingSchema>): Promise<ActionResult & { voucherCode?: string | null }> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("reservations.decide");
  const parsed = PhoneBookingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("ecu.checkReservation") };
  const data = parsed.data;
  const when = new Date(`${data.date}T${data.time}:00+01:00`);
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 30 * 60_000) {
    return { ok: false, error: t("ecu.chooseFutureDate") };
  }

  const supabase = createAdminClient();
  // The restaurant may take a booking outside the online grid (it knows its
  // room), but never on a day it declared closed.
  const config = await loadBookingConfig(active.restaurantId);
  if (closureOn(data.date, config.closures)) return { ok: false, error: t("ons.err.closedOnDate") };

  const durationMin = await getReservationDuration(active.restaurantId, supabase);
  const reference = `RES-${randomUUID().slice(0, 4).toUpperCase()}`;
  const row = {
    reference,
    restaurant_id: active.restaurantId,
    customer_id: null,
    guest_name: data.guestName,
    // Kept for the restaurant's own records; never shown to anyone else.
    guest_phone: data.guestPhone,
    party_size: data.partySize,
    reserved_for: when.toISOString(),
    duration_min: durationMin,
    status: "confirmed",
    deposit_amount: 0,
    notes: data.notes.trim() || null,
    decided_by: profile.email,
    decided_at: new Date().toISOString(),
    table_id: data.tableIds[0] ?? null,
  };
  let insert = await supabase
    .from("reservations")
    .insert({ ...row, source: "phone", occasion: data.occasion ?? null, is_group_request: data.partySize > config.maxParty })
    .select("id, voucher_code")
    .single();
  if (insert.error && isMissingColumn(insert.error)) {
    insert = await supabase.from("reservations").insert(row).select("id").single() as typeof insert;
  }
  if (insert.error || !insert.data) {
    console.error("[booking:phone]", insert.error?.code ?? "", insert.error?.message);
    return { ok: false, error: t("ecu.requestNotSent") };
  }
  if (data.tableIds.length) {
    await supabase.from("reservation_tables").insert(
      data.tableIds.map((tableId) => ({ reservation_id: insert.data!.id, table_id: tableId })),
    );
  }
  revalidatePath("/m/reservations");
  return { ok: true, voucherCode: (insert.data as { voucher_code?: string | null }).voucher_code ?? null };
}

/** The tables the seating rule would give this booking now (the confirm sheet's suggestion). */
export async function suggestTablesFor(reservationId: string): Promise<{ ok: boolean; tableIds: string[] }> {
  const { active } = await requireCapability("reservations.view");
  if (!uuid.safeParse(reservationId).success) return { ok: false, tableIds: [] };
  const supabase = createAdminClient();
  const { data: booking } = await supabase
    .from("reservations")
    .select("id, reserved_for, duration_min, party_size, seating_preference")
    .eq("id", reservationId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();
  if (!booking) return { ok: false, tableIds: [] };
  const start = new Date(booking.reserved_for as string);
  const [floor, holding] = await Promise.all([
    loadFloorPlan(active.restaurantId).catch(() => null),
    loadHoldingBookings(active.restaurantId, start, start, Number(booking.duration_min) || 60),
  ]);
  if (!floor || !holding) return { ok: false, tableIds: [] };
  const others = holding.filter((h) => h.id !== booking.id);
  const seat = seatPartyAt({
    tables: floor,
    bookings: others,
    at: start,
    durationMin: Number(booking.duration_min) || 60,
    partySize: Number(booking.party_size) || 1,
    zone: (booking as { seating_preference?: string | null }).seating_preference ?? null,
  }) ?? chooseTables(floor, Number(booking.party_size) || 1);
  return { ok: true, tableIds: (seat ?? []).map((table) => table.id) };
}

/** A private note about a regular guest, seen by this restaurant's staff only. */
export async function saveGuestNote(customerId: string, note: string): Promise<ActionResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("reservations.decide");
  if (!uuid.safeParse(customerId).success) return { ok: false, error: t("ons.err.noteFailed") };
  const text = note.trim().slice(0, 1000);
  const supabase = createAdminClient();
  // Only a guest who actually booked here can be written about.
  const { count } = await supabase.from("reservations").select("id", { count: "exact", head: true })
    .eq("restaurant_id", active.restaurantId).eq("customer_id", customerId);
  if (!count) return { ok: false, error: t("ons.err.noteFailed") };
  const { error } = text
    ? await supabase.from("restaurant_guest_notes").upsert({
        restaurant_id: active.restaurantId, customer_id: customerId, note: text,
        updated_by: profile.id, updated_at: new Date().toISOString(),
      }, { onConflict: "restaurant_id,customer_id" })
    : await supabase.from("restaurant_guest_notes").delete().eq("restaurant_id", active.restaurantId).eq("customer_id", customerId);
  if (error) {
    console.error("[booking:guest-note]", error.code ?? "", error.message);
    return { ok: false, error: isMissingColumn(error) ? t("ons.err.migration0068") : t("ons.err.noteFailed") };
  }
  revalidatePath("/m/reservations");
  return { ok: true };
}

/* ── The restaurant's own rules (Settings) ────────────────────────────── */

export async function setReservationRules(input: { maxParty: number; maxArrivals: number | null }): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("settings.manage");
  const maxParty = Math.round(Number(input.maxParty));
  const maxArrivals = input.maxArrivals === null || input.maxArrivals === undefined || Number(input.maxArrivals) <= 0
    ? null
    : Math.round(Number(input.maxArrivals));
  if (!Number.isInteger(maxParty) || maxParty < 1 || maxParty > ABSOLUTE_MAX_PARTY) return { ok: false, error: t("ons.err.maxPartyRange") };
  if (maxArrivals !== null && (maxArrivals < 1 || maxArrivals > 100)) return { ok: false, error: t("ons.err.maxArrivalsRange") };
  const { error } = await createAdminClient().from("restaurants")
    .update({ reservation_max_party: maxParty, reservation_max_arrivals: maxArrivals })
    .eq("id", active.restaurantId);
  if (error) {
    console.error("[booking:rules]", error.code ?? "", error.message);
    return { ok: false, error: isMissingColumn(error) ? t("ons.err.migration0068") : t("ons.err.settingsFailed") };
  }
  revalidatePath("/m/settings");
  return { ok: true };
}

/** Tips on table payments — each restaurant decides (0068). Off by default. */
export async function setTipsEnabled(enabled: boolean): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("settings.manage");
  const { error } = await createAdminClient().from("restaurants")
    .update({ tips_enabled: Boolean(enabled) }).eq("id", active.restaurantId);
  if (error) {
    console.error("[booking:tips]", error.code ?? "", error.message);
    return { ok: false, error: isMissingColumn(error) ? t("ons.err.migration0068") : t("ons.err.settingsFailed") };
  }
  revalidatePath("/m/settings");
  return { ok: true };
}

export async function addClosure(input: { startsOn: string; endsOn: string; reason?: string }): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("settings.manage");
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!date.test(input.startsOn) || !date.test(input.endsOn) || input.endsOn < input.startsOn) {
    return { ok: false, error: t("ons.err.closureDates") };
  }
  const { error } = await createAdminClient().from("restaurant_closures").insert({
    restaurant_id: active.restaurantId,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    reason: input.reason?.trim().slice(0, 120) || null,
  });
  if (error) {
    console.error("[booking:closure]", error.code ?? "", error.message);
    return { ok: false, error: isMissingColumn(error) ? t("ons.err.migration0068") : t("ons.err.settingsFailed") };
  }
  revalidatePath("/m/settings");
  return { ok: true };
}

export async function removeClosure(closureId: string): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("settings.manage");
  if (!uuid.safeParse(closureId).success) return { ok: false, error: t("ons.err.settingsFailed") };
  const { error } = await createAdminClient().from("restaurant_closures")
    .delete().eq("id", closureId).eq("restaurant_id", active.restaurantId);
  if (error) return { ok: false, error: t("ons.err.settingsFailed") };
  revalidatePath("/m/settings");
  return { ok: true };
}
