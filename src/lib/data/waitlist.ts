import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { serviceDateAndTime } from "@/lib/restaurant/service-hours";

/**
 * A table just came free — tell the people waiting for it (0068).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Called whenever a booking stops holding tables before its time: the
 *  customer cancels, the restaurant declines or cancels, a payment hold runs
 *  out. Everyone on that restaurant's waitlist for the same day, within an
 *  hour of the freed slot, hears it at once — first to book gets it (the
 *  booking goes through the normal availability check, so nobody is promised
 *  a table twice). Each entry is told once (waiting → notified).
 *
 *  Never throws: a failed nudge must not undo the cancellation it follows.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function notifyWaitlist(restaurantId: string, reservedFor: string): Promise<void> {
  try {
    const slot = serviceDateAndTime(new Date(reservedFor));
    if (!slot) return;
    const db = createAdminClient();
    const { data, error } = await db
      .from("reservation_waitlist")
      .select("id, customer_id, wanted_time, party_size")
      .eq("restaurant_id", restaurantId)
      .eq("wanted_date", slot.date)
      .eq("status", "waiting");
    if (error || !data?.length) return;

    const freed = toMinutes(slot.time);
    const near = (data as { id: string; customer_id: string; wanted_time: string; party_size: number }[])
      .filter((entry) => Math.abs(toMinutes(entry.wanted_time) - freed) <= 60);
    if (!near.length) return;

    const { data: restaurant } = await db.from("restaurants").select("name, slug").eq("id", restaurantId).maybeSingle();
    const ids = near.map((entry) => entry.id);
    await db.from("reservation_waitlist").update({ status: "notified", notified_at: new Date().toISOString() })
      .in("id", ids).eq("status", "waiting");

    await Promise.allSettled(near.map((entry) =>
      notify({
        event: "reservation_decision",
        tone: "success",
        customerId: entry.customer_id,
        href: `/reservations?restaurant=${restaurant?.slug ?? ""}&date=${slot.date}&guests=${entry.party_size}`,
        params: {
          restaurantName: restaurant?.name ?? undefined,
          reservationUpdate: "waitlist_open",
          whenLabel: `${slot.date.split("-").reverse().join("/")} ${entry.wanted_time}`,
          partySize: entry.party_size,
        },
      }),
    ));
  } catch (error) {
    console.error("[waitlist:notify]", error);
  }
}

function toMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
