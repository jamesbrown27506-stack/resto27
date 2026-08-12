import { ReservationsClient } from "./reservations-client";
import { requireUser } from "@/lib/auth/session";
import { fetchCustomerReservations } from "@/lib/data/customer";
import { fetchActiveRestaurants } from "@/lib/data/public";

export default async function ReservationsPage() {
  const user = await requireUser();

  const [reservations, restaurants] = await Promise.all([
    fetchCustomerReservations(user.id),
    fetchActiveRestaurants(),
  ]);

  return <ReservationsClient user={user} initial={reservations} restaurants={restaurants} />;
}