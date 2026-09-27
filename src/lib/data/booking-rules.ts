import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { getSettingsMap, settingNumber } from "@/lib/settings-map";
import { fetchTableAccess } from "./table-access";
import { isMissingColumn } from "./missing-column";
import {
  DEFAULT_BOOKING_MAX_DAYS,
  DEFAULT_MAX_PARTY,
  DEFAULT_ORDER_SCHEDULE_MAX_DAYS,
  horizonDays,
  type Closure,
} from "@/lib/reservations/rules";
import { HOLDING_STATUSES, overlapQueryRange } from "@/lib/reservations/availability";
import type { PlanBooking, PlanTable } from "@/lib/reservations/tables";

/**
 * Everything a booking check reads besides the opening hours (0068).
 *
 * MIGRATION-TOLERANT on purpose: a database that has not run 0068 answers
 * with the defaults (maximum party 12, no arrivals cap, no closures, no
 * zones, no multi-table links) instead of refusing bookings — the old rules,
 * which is exactly what that database still enforces everywhere else.
 */

export interface BookingConfig {
  maxParty: number;
  maxArrivals: number | null;
  closures: Closure[];
  horizonDays: number;
  tipsEnabled: boolean;
}

export async function loadBookingConfig(restaurantId: string): Promise<BookingConfig> {
  const db = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const [settings, rules, closures] = await Promise.all([
    getSettingsMap(),
    db.from("restaurants").select("reservation_max_party, reservation_max_arrivals, tips_enabled").eq("id", restaurantId).maybeSingle(),
    db.from("restaurant_closures").select("starts_on, ends_on, reason").eq("restaurant_id", restaurantId).gte("ends_on", today).order("starts_on"),
  ]);
  const row = rules.error ? null : (rules.data as { reservation_max_party?: number; reservation_max_arrivals?: number | null; tips_enabled?: boolean } | null);
  if (rules.error && !isMissingColumn(rules.error)) console.error("[booking-rules] restaurant", rules.error.message);
  return {
    maxParty: Number(row?.reservation_max_party) > 0 ? Number(row?.reservation_max_party) : DEFAULT_MAX_PARTY,
    maxArrivals: Number(row?.reservation_max_arrivals) > 0 ? Number(row?.reservation_max_arrivals) : null,
    tipsEnabled: Boolean(row?.tips_enabled),
    closures: closures.error
      ? []
      : ((closures.data ?? []) as { starts_on: string; ends_on: string; reason: string | null }[]).map((c) => ({
          startsOn: c.starts_on,
          endsOn: c.ends_on,
          reason: c.reason,
        })),
    horizonDays: horizonDays(settingNumber(settings, "reservation_max_days_ahead", DEFAULT_BOOKING_MAX_DAYS), DEFAULT_BOOKING_MAX_DAYS),
  };
}

/** How far ahead a table may be booked (admin setting), for the booking form's date picker. */
export async function bookingMaxDays(): Promise<number> {
  const settings = await getSettingsMap();
  return horizonDays(settingNumber(settings, "reservation_max_days_ahead", DEFAULT_BOOKING_MAX_DAYS), DEFAULT_BOOKING_MAX_DAYS);
}

/** How far ahead a delivery or pickup may be scheduled (admin setting). */
export async function orderScheduleMaxDays(): Promise<number> {
  const settings = await getSettingsMap();
  return horizonDays(settingNumber(settings, "order_schedule_max_days", DEFAULT_ORDER_SCHEDULE_MAX_DAYS), DEFAULT_ORDER_SCHEDULE_MAX_DAYS);
}

/** The floor as the seating rule sees it: capacity, status, zone. Plan-locked tables are out. */
export async function loadFloorPlan(restaurantId: string): Promise<PlanTable[]> {
  const access = await fetchTableAccess(restaurantId);
  const { data: zones, error } = await createAdminClient()
    .from("restaurant_tables")
    .select("id, zone")
    .eq("restaurant_id", restaurantId);
  const zoneById = new Map(
    error ? [] : ((zones ?? []) as { id: string; zone: string | null }[]).map((z) => [z.id, z.zone]),
  );
  return access.tables.map((table) => ({
    id: (table as { id: string }).id,
    capacity: table.capacity,
    status: (table as { planLocked?: boolean }).planLocked ? "out_of_service" : table.status,
    zone: zoneById.get((table as { id: string }).id) ?? null,
  }));
}

export interface HoldingRow extends PlanBooking {
  id: string;
  createdAt: string;
}

/**
 * Every booking still holding tables that could overlap [from, to + duration),
 * with its party size and the tables it was given.
 */
export async function loadHoldingBookings(
  restaurantId: string,
  from: Date,
  to: Date,
  durationMin: number,
): Promise<HoldingRow[] | null> {
  const db = createAdminClient();
  const range = overlapQueryRange(from, to, durationMin);
  const base = "id, created_at, reserved_for, duration_min, party_size, table_id";
  let result: { data: unknown[] | null; error: { message: string } | null } = await db
    .from("reservations")
    .select(`${base}, reservation_tables ( table_id )`)
    .eq("restaurant_id", restaurantId)
    .in("status", [...HOLDING_STATUSES])
    .gt("reserved_for", range.start)
    .lt("reserved_for", range.end);
  if (result.error) {
    // 0068 missing: no link table — the single table_id is all there is.
    result = await db
      .from("reservations")
      .select(base)
      .eq("restaurant_id", restaurantId)
      .in("status", [...HOLDING_STATUSES])
      .gt("reserved_for", range.start)
      .lt("reserved_for", range.end);
  }
  if (result.error) {
    console.error("[booking-rules] holding", result.error.message);
    return null;
  }
  return ((result.data ?? []) as {
    id: string; created_at: string; reserved_for: string; duration_min: number | null; party_size: number;
    table_id: string | null; reservation_tables?: { table_id: string }[] | null;
  }[]).map((r) => {
    const linked = (r.reservation_tables ?? []).map((l) => l.table_id);
    const tableIds = linked.length ? linked : r.table_id ? [r.table_id] : [];
    return {
      id: r.id,
      createdAt: r.created_at,
      start: new Date(r.reserved_for),
      durationMin: r.duration_min,
      partySize: Number(r.party_size) || 1,
      tableIds,
    };
  });
}

/** The Settings panel's view: the rules plus closures with their ids (0068). */
export async function fetchBookingSettings(restaurantId: string): Promise<{
  maxParty: number;
  maxArrivals: number | null;
  tipsEnabled: boolean;
  closures: { id: string; startsOn: string; endsOn: string; reason: string | null }[];
  available: boolean;
}> {
  const db = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const [rules, closures] = await Promise.all([
    db.from("restaurants").select("reservation_max_party, reservation_max_arrivals, tips_enabled").eq("id", restaurantId).maybeSingle(),
    db.from("restaurant_closures").select("id, starts_on, ends_on, reason").eq("restaurant_id", restaurantId).gte("ends_on", today).order("starts_on"),
  ]);
  const row = rules.data as { reservation_max_party?: number; reservation_max_arrivals?: number | null; tips_enabled?: boolean } | null;
  return {
    maxParty: Number(row?.reservation_max_party) > 0 ? Number(row?.reservation_max_party) : DEFAULT_MAX_PARTY,
    maxArrivals: Number(row?.reservation_max_arrivals) > 0 ? Number(row?.reservation_max_arrivals) : null,
    tipsEnabled: Boolean(row?.tips_enabled),
    closures: closures.error ? [] : ((closures.data ?? []) as { id: string; starts_on: string; ends_on: string; reason: string | null }[])
      .map((c) => ({ id: c.id, startsOn: c.starts_on, endsOn: c.ends_on, reason: c.reason })),
    // False until 0068 is applied — the panel says so instead of failing on save.
    available: !rules.error,
  };
}
