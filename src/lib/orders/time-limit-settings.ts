import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import {
  DEFAULT_ORDER_RESPONSE_MINUTES,
  DEFAULT_RESERVATION_RESPONSE_MINUTES,
  minutesSetting,
} from "./deadline";

export interface TimeLimits {
  /** Restaurant → accept; customer → pay. See deadline.ts. */
  orderMinutes: number;
  /** Restaurant → answer a booking request. */
  reservationMinutes: number;
}

/**
 * The admin's time limits (0059). Fails soft to the defaults: before the
 * migration runs there is no row, and a missing row must still mean "15
 * minutes", not "never".
 */
export async function getTimeLimits(): Promise<TimeLimits> {
  const { data, error } = await createAdminClient()
    .from("settings")
    .select("key, value")
    .in("key", ["order_response_minutes", "reservation_response_minutes"]);

  if (error) console.error("[settings:timeLimits]", error.message);
  const map = new Map(((data ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value]));

  return {
    orderMinutes: minutesSetting(map.get("order_response_minutes"), DEFAULT_ORDER_RESPONSE_MINUTES),
    reservationMinutes: minutesSetting(
      map.get("reservation_response_minutes"),
      DEFAULT_RESERVATION_RESPONSE_MINUTES,
    ),
  };
}
