import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { TableManager, type TableHold } from "./table-manager";
import { requireCapability } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { fetchTables } from "@/lib/data/manager";
import { fetchPlanLimits } from "@/lib/data/billing";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";
import { createAdminClient } from "@/lib/supabase/server";
import { MAX_RESERVATION_DURATION_MIN } from "@/lib/reservations/availability";
import {
  FLOOR_HOLD_STATUSES,
  holdsTableNow,
  sittingEnd,
  TABLE_HOLD_BEFORE_MIN,
} from "@/lib/reservations/timing";

/**
 * Which tables a live booking holds right now, keyed by table id.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  COMPUTED AT READ TIME, NEVER WRITTEN TO THE TABLE.
 *
 *  `restaurant_tables.status` is the waiter's word ("occupied", "out of
 *  service"). A booking assigned to a table holds it from 30 minutes before
 *  the slot to the end of its sitting (timing.ts) — writing "reserved" into
 *  the status would need a job to write it back afterwards, and a missed run
 *  would leave a table reserved for nobody. So the floor asks the bookings
 *  instead, every time it renders.
 * ─────────────────────────────────────────────────────────────────────────
 */
async function fetchTableHolds(restaurantId: string, now: number): Promise<Record<string, TableHold>> {
  const { data, error } = await createAdminClient()
    .from("reservations")
    .select("table_id, guest_name, reserved_for, duration_min, status")
    .eq("restaurant_id", restaurantId)
    .in("status", [...FLOOR_HOLD_STATUSES])
    .not("table_id", "is", null)
    .gt("reserved_for", new Date(now - MAX_RESERVATION_DURATION_MIN * 60_000).toISOString())
    .lte("reserved_for", new Date(now + TABLE_HOLD_BEFORE_MIN * 60_000).toISOString())
    .order("reserved_for");

  if (error) {
    console.error("[m/tables:holds]", error.message);
    return {};
  }

  const holds: Record<string, TableHold> = {};
  for (const row of (data ?? []) as {
    table_id: string;
    guest_name: string | null;
    reserved_for: string;
    duration_min: number;
    status: string;
  }[]) {
    const booking = { status: row.status, reservedFor: row.reserved_for, durationMin: Number(row.duration_min) };
    if (!holdsTableNow(booking, now) || holds[row.table_id]) continue;
    holds[row.table_id] = {
      guestName: row.guest_name ?? "",
      reservedFor: row.reserved_for,
      endsAt: sittingEnd(row.reserved_for, booking.durationMin)?.toISOString() ?? row.reserved_for,
      seated: row.status === "seated",
    };
  }
  return holds;
}

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["nav.m.tables"] };
}

export default async function TablesPage() {
  const { active } = await requireCapability("tables.view");

  const now = new Date().getTime();
  const [tables, limits, holds] = await Promise.all([
    fetchTables(active.restaurantId),
    fetchPlanLimits(),
    fetchTableHolds(active.restaurantId, now),
  ]);

  const tier = active.subscriptionState === "locked" ? "starter" : active.planTier;
  const limit = (limits.get(tier) ?? limits.get("starter"))?.tableLimit ?? null;

  const seats = tables.reduce((sum, t) => sum + t.capacity, 0);

  return (
    <ManagerPage
      titleKey="m.tables.title"
      description={`${tables.length} table${tables.length > 1 ? "s" : ""} · ${seats} place${seats > 1 ? "s" : ""}`}
    >
      <TableManager tables={tables} holds={holds} limit={limit} canManage={can(active.role, "tables.manage")} canSetStatus={can(active.role, "reservations.seat")} qrEnabled={active.planTier === "enterprise" && active.subscriptionState !== "locked" && tables.some((table) => Boolean(table.publicToken))} />
    </ManagerPage>
  );
}
