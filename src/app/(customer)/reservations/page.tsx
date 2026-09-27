import { ReservationsClient } from "./reservations-client";
import { requireUser } from "@/lib/auth/session";
import { fetchCustomerReservations, fetchCustomerWaitlist } from "@/lib/data/customer";
import { bookingMaxDays } from "@/lib/data/booking-rules";
import { getSettingsMap, settingNumber } from "@/lib/settings-map";
import { fetchActiveRestaurants } from "@/lib/data/public";

/**
 * The reservation form accepts a few query params so the rest of the site can
 * hand off a booking intent instead of dropping it:
 *
 *   ?restaurant=<slug>  — from "Réserver une table" on a restaurant page
 *   ?q=<name>           — from the homepage's booking search
 *   ?guests=&date=      — carried through from that same search
 */
export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ restaurant?: string; q?: string; guests?: string; date?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const [reservations, restaurants, waitlist, maxDays, settings] = await Promise.all([
    fetchCustomerReservations(user.id),
    fetchActiveRestaurants(),
    fetchCustomerWaitlist(user.id),
    bookingMaxDays(),
    getSettingsMap(),
  ]);

  /*
    The clock is handed DOWN rather than read inside the client component.

    Which half-hours are still bookable depends on the current time, so a
    `new Date()` during the client component's render would be one instant on
    the server and a different one in the browser — and a slot that falls
    either side of the boundary between them is a hydration mismatch. One
    instant, rendered twice, agrees; the client takes over on mount and
    re-reads the clock every minute after that.
  */
  const now = new Date().toISOString();

  return (
    <ReservationsClient
      user={user}
      initial={reservations}
      restaurants={restaurants}
      initialRestaurantSlug={params.restaurant ?? params.q ?? ""}
      initialGuests={params.guests ?? ""}
      initialDate={params.date ?? ""}
      now={now}
      waitlist={waitlist}
      bookingMaxDays={maxDays}
      // The payment service fee, charged on the deposit too (0068).
      feePercent={settingNumber(settings, "service_charge_percent", 0)}
    />
  );
}