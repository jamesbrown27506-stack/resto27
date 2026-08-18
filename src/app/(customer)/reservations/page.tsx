import { ReservationsClient } from "./reservations-client";
import { requireUser } from "@/lib/auth/session";
import { fetchCustomerReservations } from "@/lib/data/customer";
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

  const [reservations, restaurants] = await Promise.all([
    fetchCustomerReservations(user.id),
    fetchActiveRestaurants(),
  ]);

  return (
    <ReservationsClient
      user={user}
      initial={reservations}
      restaurants={restaurants}
      initialRestaurantSlug={params.restaurant ?? params.q ?? ""}
      initialGuests={params.guests ?? ""}
      initialDate={params.date ?? ""}
    />
  );
}