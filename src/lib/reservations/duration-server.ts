import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { DEFAULT_RESERVATION_DURATION_MIN, normaliseDuration } from "./availability";

/**
 * Same predicate as customer-actions / missing-column.test.ts — duplicated
 * rather than imported, because the other copies live in "use server"
 * modules. 42703 on a read, PGRST204 on a write; both name the column.
 */
function isMissingColumn(error: { code?: string; message?: string } | null, column: string): boolean {
  if (!error) return false;
  const known = error.code === "42703" || error.code === "PGRST204";
  return known && (error.message ?? "").includes(column);
}

/**
 * The restaurant's sitting length in minutes (0060).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  MIGRATION-TOLERANT ON PURPOSE. Production may run this code before 0060 is
 *  pasted into the SQL editor; on that database the column does not exist,
 *  and "the booking form stopped working" is not an acceptable price for a
 *  new setting. A missing column means what the migration's default means:
 *  one hour. Any other failure also answers one hour, logged — a wrong
 *  duration for one request beats a refused booking.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function getReservationDuration(
  restaurantId: string,
  supabase: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<number> {
  const { data, error } = await supabase
    .from("restaurants")
    .select("reservation_duration_min")
    .eq("id", restaurantId)
    .maybeSingle();

  if (error) {
    if (!isMissingColumn(error, "reservation_duration_min")) {
      console.error("[reservations:duration]", error.code ?? "", error.message);
    }
    return DEFAULT_RESERVATION_DURATION_MIN;
  }
  return normaliseDuration(
    (data as { reservation_duration_min?: number | null } | null)?.reservation_duration_min,
  );
}

/** True when a write failed only because 0060 has not been applied. */
export function durationColumnMissing(error: { code?: string; message?: string } | null): boolean {
  return isMissingColumn(error, "reservation_duration_min");
}
