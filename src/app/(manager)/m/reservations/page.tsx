import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { ReservationBoard } from "./reservation-board";
import { requireCapability } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { fetchReservations, fetchTables } from "@/lib/data/manager";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["nav.m.reservations"] };
}

export default async function ReservationsPage() {
  const { active } = await requireCapability("reservations.view");

  /**
   * Today onwards, midnight-anchored.
   *
   * `new Date()` would hide a booking taken for 19:00 while it is 20:00 and
   * the table is still occupied — the evening's own bookings would vanish from
   * the screen that is meant to run the evening.
   */
  const from = new Date();
  from.setHours(0, 0, 0, 0);

  const [reservations, tables] = await Promise.all([
    fetchReservations(active.restaurantId, { from }),
    fetchTables(active.restaurantId),
  ]);

  return (
    <ManagerPage
      titleKey="m.reservations.title"
      descriptionKey="m.reservations.subtitle"
    >
      <ReservationBoard
        reservations={reservations}
        tables={tables}
        canDecide={can(active.role, "reservations.decide")}
      />
    </ManagerPage>
  );
}
