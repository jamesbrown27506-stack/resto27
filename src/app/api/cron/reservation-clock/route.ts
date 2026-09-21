import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { requireCronAuth, stampHeartbeat } from "@/lib/cron";

/**
 * The reservation clock — everything that should happen because time
 * passed, which nothing else in the system would ever do.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  1. DAY-BEFORE REMINDER (confirmed, ~24h out). Most no-shows are
 *     forgetfulness, and the platform built a whole deposit system against
 *     no-shows while having zero defense against forgetting. The reminder
 *     names the cancel path, because a cancellation at reminder time is a
 *     table someone else can still book.
 *
 *  2. SOON REMINDER (confirmed, ~2h out).
 *
 *  3. DEPOSIT NAG (awaiting_payment, slot within 6h). The single
 *     "deposit due" push is easy to miss; the table is held hostage until
 *     someone pays or a human notices. One nag, then —
 *
 *  4. AUTO-RELEASE (awaiting_payment, slot passed, deposit never paid).
 *     The hold frees itself, both sides are told honestly ("released", not
 *     "the client cancelled"), and the manual Release button becomes the
 *     safety valve instead of the mechanism. Rows with an unsettled payment
 *     attempt are skipped — money possibly in flight is never cancelled.
 *
 *  The reminder ladder is `reminder_stage` (0044): 0 = nothing sent,
 *  1 = day-before (or the deposit nag), 2 = soon. Monotonic, so each
 *  message fires once. Pre-0044 databases skip with one log line.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const dynamic = "force-dynamic";

const DAY_REMINDER_MIN_HOURS = 22;
const DAY_REMINDER_MAX_HOURS = 26;
const SOON_REMINDER_MIN_MINUTES = 30;
const SOON_REMINDER_MAX_HOURS = 2.5;
const DEPOSIT_NAG_HORIZON_HOURS = 6;

function whenLabel(iso: string, withDay: boolean): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Douala",
    ...(withDay ? { weekday: "long" as const, day: "numeric" as const, month: "long" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

interface ReservationRow {
  id: string;
  reference: string;
  customer_id: string | null;
  restaurant_id: string;
  party_size: number;
  reserved_for: string;
  reminder_stage: number;
  deposit_amount: number | null;
  guest_name: string | null;
  restaurants: { name?: string } | null;
}

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const supabase = createAdminClient();
  const now = Date.now();
  const summary = { dayReminders: 0, soonReminders: 0, depositNags: 0, released: 0, expiredRequests: 0 };

  const select =
    "id, reference, customer_id, restaurant_id, party_size, reserved_for, reminder_stage, deposit_amount, guest_name, restaurants ( name )";

  /* ── 1 + 2. Reminders for confirmed bookings ─────────────────────────── */
  const { data: confirmed, error: confirmedError } = await supabase
    .from("reservations")
    .select(select)
    .eq("status", "confirmed")
    .lt("reminder_stage", 2)
    .gte("reserved_for", new Date(now + SOON_REMINDER_MIN_MINUTES * 60 * 1000).toISOString())
    .lte("reserved_for", new Date(now + DAY_REMINDER_MAX_HOURS * 60 * 60 * 1000).toISOString());

  if (confirmedError && (confirmedError.code === "42703" || confirmedError.code === "PGRST204")) {
    console.error("[reservation-clock] reminder_stage missing — run migration 0044. Sweep skipped.");
    await stampHeartbeat("reservation-clock", { ...summary, schemaMissing: true });
    return NextResponse.json({ ...summary, schemaMissing: true });
  }
  if (confirmedError) {
    console.error("[reservation-clock] confirmed query failed", confirmedError.message);
  }

  for (const row of (confirmed ?? []) as unknown as ReservationRow[]) {
    if (!row.customer_id) continue;
    const hoursOut = (Date.parse(row.reserved_for) - now) / (60 * 60 * 1000);
    const name = row.restaurants?.name ?? undefined;

    if (hoursOut <= SOON_REMINDER_MAX_HOURS && row.reminder_stage < 2) {
      await notify({
        event: "reservation_reminder",
        tone: "info",
        customerId: row.customer_id,
        href: "/reservations",
        params: {
          reference: row.reference,
          restaurantName: name,
          partySize: row.party_size,
          stage: "soon",
          whenLabel: whenLabel(row.reserved_for, false),
        },
      });
      await supabase
        .from("reservations")
        .update({ reminder_stage: 2 })
        .eq("id", row.id)
        .eq("status", "confirmed");
      summary.soonReminders++;
    } else if (hoursOut >= DAY_REMINDER_MIN_HOURS && row.reminder_stage === 0) {
      await notify({
        event: "reservation_reminder",
        tone: "info",
        customerId: row.customer_id,
        href: "/reservations",
        params: {
          reference: row.reference,
          restaurantName: name,
          partySize: row.party_size,
          stage: "day",
          whenLabel: whenLabel(row.reserved_for, true),
        },
      });
      await supabase
        .from("reservations")
        .update({ reminder_stage: 1 })
        .eq("id", row.id)
        .eq("status", "confirmed");
      summary.dayReminders++;
    }
  }

  /* ── 3 + 4. awaiting_payment: nag, then release ──────────────────────── */
  const { data: awaiting, error: awaitingError } = await supabase
    .from("reservations")
    .select(select + ", deposit_paid")
    .eq("status", "awaiting_payment")
    .eq("deposit_paid", false)
    .lte("reserved_for", new Date(now + DEPOSIT_NAG_HORIZON_HOURS * 60 * 60 * 1000).toISOString());

  if (awaitingError) {
    console.error("[reservation-clock] awaiting query failed", awaitingError.message);
  }

  const awaitingRows = (awaiting ?? []) as unknown as (ReservationRow & { deposit_paid: boolean })[];

  // Money possibly in flight is never touched: one query for every open
  // attempt over the whole batch, not one per row.
  const openAttempts = new Set<string>();
  if (awaitingRows.length > 0) {
    const { data: attempts } = await supabase
      .from("payment_attempts")
      .select("reservation_id, status, settled_at")
      .in("reservation_id", awaitingRows.map((r) => r.id))
      .is("settled_at", null)
      .in("status", ["pending", "succeeded"]);
    for (const attempt of (attempts ?? []) as { reservation_id: string | null }[]) {
      if (attempt.reservation_id) openAttempts.add(attempt.reservation_id);
    }
  }

  for (const row of awaitingRows) {
    if (openAttempts.has(row.id)) continue;
    const slotPassed = Date.parse(row.reserved_for) < now;
    const name = row.restaurants?.name ?? undefined;

    if (slotPassed) {
      // Compare-and-swap on the status, same discipline as every other
      // reservation transition: a payment settling this instant wins.
      const { data: released } = await supabase
        .from("reservations")
        .update({ status: "cancelled" })
        .eq("id", row.id)
        .eq("status", "awaiting_payment")
        .eq("deposit_paid", false)
        .select("id")
        .maybeSingle();
      if (!released) continue;

      if (row.customer_id) {
        await notify({
          event: "reservation_decision",
          tone: "error",
          customerId: row.customer_id,
          href: "/reservations",
          params: {
            reference: row.reference,
            restaurantName: name,
            status: "cancelled",
            reason: "Acompte non réglé avant l'heure de la réservation — la table a été libérée.",
          },
        });
      }
      await notify({
        event: "reservation",
        tone: "warning",
        restaurantId: row.restaurant_id,
        href: "/m/reservations",
        params: { reference: row.reference, customerName: row.guest_name ?? undefined, status: "cancelled" },
      });
      summary.released++;
    } else if (row.reminder_stage === 0) {
      if (!row.customer_id) continue;
      await notify({
        event: "reservation_decision",
        tone: "warning",
        customerId: row.customer_id,
        href: "/reservations",
        params: {
          reference: row.reference,
          restaurantName: name,
          status: "awaiting_payment",
          amount: row.deposit_amount ?? undefined,
        },
      });
      await supabase
        .from("reservations")
        .update({ reminder_stage: 1 })
        .eq("id", row.id)
        .eq("status", "awaiting_payment");
      summary.depositNags++;
    }
  }

  /* ── 5. An unanswered, unpaid request cannot stay pending forever. ── */
  const { data: expiredRequests, error: expiredError } = await supabase
    .from("reservations")
    .select(select)
    .eq("status", "pending")
    .eq("deposit_paid", false)
    .lt("reserved_for", new Date(now).toISOString())
    .limit(100);

  if (expiredError) console.error("[reservation-clock] expired requests query failed", expiredError.message);

  for (const row of (expiredRequests ?? []) as unknown as ReservationRow[]) {
    // Preserve an unsettled payment even if an older workflow created it
    // before the restaurant accepted the request.
    const { data: openAttempt, error: attemptError } = await supabase
      .from("payment_attempts")
      .select("id")
      .eq("reservation_id", row.id)
      .is("settled_at", null)
      .in("status", ["pending", "succeeded"])
      .limit(1)
      .maybeSingle();
    if (attemptError || openAttempt) continue;

    const { data: cleared, error: clearError } = await supabase
      .from("reservations")
      .update({ status: "cancelled" })
      .eq("id", row.id)
      .eq("status", "pending")
      .eq("deposit_paid", false)
      .lt("reserved_for", new Date(now).toISOString())
      .select("id")
      .maybeSingle();
    if (clearError || !cleared) continue;

    if (row.customer_id) {
      await notify({
        event: "reservation_decision",
        tone: "warning",
        customerId: row.customer_id,
        href: "/reservations",
        params: {
          reference: row.reference,
          restaurantName: row.restaurants?.name ?? undefined,
          status: "expired",
        },
      });
    }
    await notify({
      event: "reservation",
      tone: "info",
      restaurantId: row.restaurant_id,
      href: "/m/reservations",
      params: { reference: row.reference, customerName: row.guest_name ?? undefined, status: "cancelled" },
    });
    summary.expiredRequests++;
  }

  await stampHeartbeat("reservation-clock", summary);
  return NextResponse.json(summary);
}
