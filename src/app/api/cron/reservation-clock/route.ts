import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { requireCronAuth, stampHeartbeat } from "@/lib/cron";
import { getTimeLimits } from "@/lib/orders/time-limit-settings";
import {
  deadlinePassed,
  halfwayReached,
  paymentHoldDeadline,
  requestAnswerDeadline,
} from "@/lib/reservations/timing";

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
 *  3. DEPOSIT NAG (awaiting_payment, half the payment hold gone). The single
 *     "deposit due" push is easy to miss. One nag, naming the deadline —
 *
 *  4. AUTO-RELEASE (awaiting_payment, payment hold over). Since 2026-09 the
 *     hold is one hour after acceptance and never later than one hour before
 *     the slot (lib/reservations/timing.ts); it used to run until the slot
 *     itself had PASSED, which was the table nobody else could book all
 *     evening. Both sides are told honestly ("released", not "the client
 *     cancelled"). Rows with an unsettled payment attempt are skipped —
 *     money possibly in flight is never cancelled.
 *
 *  5. REQUEST DEADLINE (pending). The restaurant must answer within the
 *     admin's limit (`reservation_response_minutes`, default 120, 0059) and
 *     never later than one hour before the slot. Half-way through it gets ONE
 *     reminder (`request_reminded_at`, 0060 — skipped, not failed, before that
 *     migration); at the deadline the request expires and the customer is
 *     told, early enough to book elsewhere.
 *
 *  The reminder ladder is `reminder_stage` (0044): 0 = nothing sent,
 *  1 = day-before (or the deposit nag), 2 = soon. Monotonic, so each
 *  message fires once. Pre-0044 databases skip with one log line.
 *
 *  Runs every 15 minutes from pg_cron. No new route was added for the
 *  deadlines on purpose — every cron route is a Vercel invocation, and this
 *  sweep already reads the rows it needs.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const dynamic = "force-dynamic";

const DAY_REMINDER_MIN_HOURS = 22;
const DAY_REMINDER_MAX_HOURS = 26;
const SOON_REMINDER_MIN_MINUTES = 30;
const SOON_REMINDER_MAX_HOURS = 2.5;
/** Bounded per run, like every other queue. */
const SWEEP_LIMIT = 200;

const EXPIRED_REQUEST_REASON =
  "Demande expirée : le restaurant n'a pas répondu dans le délai imparti.";
const RELEASED_HOLD_REASON =
  "Acompte non réglé dans le délai — la table a été libérée.";

function whenLabel(value: string | Date, withDay: boolean): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Douala",
    ...(withDay ? { weekday: "long" as const, day: "numeric" as const, month: "long" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** A deadline's label: the time alone when it is today-ish, with the day otherwise. */
function deadlineLabel(deadline: Date, now: number): string {
  return whenLabel(deadline, deadline.getTime() - now > 12 * 60 * 60 * 1000);
}

function isMissingColumn(error: { code?: string; message?: string } | null, column: string): boolean {
  if (!error) return false;
  const known = error.code === "42703" || error.code === "PGRST204";
  return known && (error.message ?? "").includes(column);
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
  created_at: string;
  decided_at: string | null;
  request_reminded_at?: string | null;
  restaurants: { name?: string } | null;
}

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const supabase = createAdminClient();
  const now = Date.now();
  const summary = {
    dayReminders: 0,
    soonReminders: 0,
    depositNags: 0,
    released: 0,
    requestReminders: 0,
    expiredRequests: 0,
  };

  const select =
    "id, reference, customer_id, restaurant_id, party_size, reserved_for, reminder_stage, deposit_amount, guest_name, created_at, decided_at, restaurants ( name )";

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

  /*
    Money possibly in flight is never touched: one query for every open
    attempt over a whole batch, not one per row.
  */
  async function openAttemptsFor(ids: string[]): Promise<Set<string> | null> {
    const open = new Set<string>();
    if (ids.length === 0) return open;
    const { data: attempts, error } = await supabase
      .from("payment_attempts")
      .select("reservation_id")
      .in("reservation_id", ids)
      .is("settled_at", null)
      .in("status", ["pending", "succeeded"]);
    // Unknown is not "none": a failed read skips the whole batch this run.
    if (error) {
      console.error("[reservation-clock] open attempts query failed", error.message);
      return null;
    }
    for (const attempt of (attempts ?? []) as { reservation_id: string | null }[]) {
      if (attempt.reservation_id) open.add(attempt.reservation_id);
    }
    return open;
  }

  /* ── 3 + 4. awaiting_payment: nag half-way, release at the hold's end ── */
  const { data: awaiting, error: awaitingError } = await supabase
    .from("reservations")
    .select(select)
    .eq("status", "awaiting_payment")
    .eq("deposit_paid", false)
    .order("decided_at", { ascending: true })
    .limit(SWEEP_LIMIT);

  if (awaitingError) {
    console.error("[reservation-clock] awaiting query failed", awaitingError.message);
  }

  const awaitingRows = (awaiting ?? []) as unknown as ReservationRow[];
  const awaitingOpen = await openAttemptsFor(awaitingRows.map((r) => r.id));

  for (const row of awaitingOpen ? awaitingRows : []) {
    if (awaitingOpen!.has(row.id)) continue;
    const name = row.restaurants?.name ?? undefined;
    const deadline = paymentHoldDeadline({
      decidedAt: row.decided_at,
      createdAt: row.created_at,
      reservedFor: row.reserved_for,
    });
    if (!deadline) continue;

    if (deadlinePassed(deadline, now)) {
      // Compare-and-swap on the status, same discipline as every other
      // reservation transition: a payment settling this instant wins.
      const { data: released } = await supabase
        .from("reservations")
        .update({ status: "cancelled", table_id: null, decline_reason: RELEASED_HOLD_REASON })
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
            cancelledBy: "timeout",
            reason: RELEASED_HOLD_REASON,
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
    } else if (
      row.reminder_stage === 0 &&
      row.customer_id &&
      halfwayReached(row.decided_at ?? row.created_at, deadline, now)
    ) {
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
          reminder: true,
          whenLabel: deadlineLabel(deadline, now),
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

  /* ── 5. Pending requests: remind half-way, expire at the deadline ────── */
  const { reservationMinutes } = await getTimeLimits();

  let remindersEnabled = true;
  // Loosely typed on purpose: the retry below selects one column fewer.
  let pendingResult: { data: unknown[] | null; error: { code?: string; message: string } | null } =
    await supabase
    .from("reservations")
    .select(`${select}, request_reminded_at`)
    .eq("status", "pending")
    .eq("deposit_paid", false)
    .order("created_at", { ascending: true })
    .limit(SWEEP_LIMIT);

  if (isMissingColumn(pendingResult.error, "request_reminded_at")) {
    // Pre-0060: requests still expire; only the half-way reminder is skipped.
    console.warn("[reservation-clock] request_reminded_at missing — run migration 0060. Request reminders skipped.");
    remindersEnabled = false;
    pendingResult = await supabase
      .from("reservations")
      .select(select)
      .eq("status", "pending")
      .eq("deposit_paid", false)
      .order("created_at", { ascending: true })
      .limit(SWEEP_LIMIT);
  }
  if (pendingResult.error) {
    console.error("[reservation-clock] pending query failed", pendingResult.error.message);
  }

  const pendingRows = (pendingResult.data ?? []) as unknown as ReservationRow[];
  const pendingOpen = await openAttemptsFor(pendingRows.map((r) => r.id));

  for (const row of pendingOpen ? pendingRows : []) {
    const deadline = requestAnswerDeadline(
      { createdAt: row.created_at, reservedFor: row.reserved_for },
      reservationMinutes,
    );
    if (!deadline) continue;

    if (deadlinePassed(deadline, now)) {
      // Preserve an unsettled payment even if an older workflow created it
      // before the restaurant accepted the request.
      if (pendingOpen!.has(row.id)) continue;

      const { data: cleared, error: clearError } = await supabase
        .from("reservations")
        .update({ status: "cancelled", decline_reason: EXPIRED_REQUEST_REASON })
        .eq("id", row.id)
        .eq("status", "pending")
        .eq("deposit_paid", false)
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
        tone: "warning",
        restaurantId: row.restaurant_id,
        href: "/m/reservations",
        params: { reference: row.reference, customerName: row.guest_name ?? undefined, status: "expired" },
      });
      summary.expiredRequests++;
    } else if (
      remindersEnabled &&
      !row.request_reminded_at &&
      halfwayReached(row.created_at, deadline, now)
    ) {
      // Stamp first (compare-and-swap), notify second: two overlapping runs
      // can both reach this line, only one of them wins the stamp.
      const { data: stamped } = await supabase
        .from("reservations")
        .update({ request_reminded_at: new Date(now).toISOString() })
        .eq("id", row.id)
        .eq("status", "pending")
        .is("request_reminded_at", null)
        .select("id")
        .maybeSingle();
      if (!stamped) continue;

      await notify({
        event: "reservation",
        tone: "warning",
        restaurantId: row.restaurant_id,
        href: "/m/reservations",
        params: {
          reference: row.reference,
          customerName: row.guest_name ?? undefined,
          partySize: row.party_size,
          status: "pending",
          reminder: true,
          whenLabel: deadlineLabel(deadline, now),
        },
      });
      summary.requestReminders++;
    }
  }

  await stampHeartbeat("reservation-clock", summary);
  return NextResponse.json(summary);
}
