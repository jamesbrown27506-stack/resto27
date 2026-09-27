import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { ReservationBoard } from "./reservation-board";
import { requireCapability } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchReservations, fetchTables, withBookingDetails } from "@/lib/data/manager";
import { VoucherCheck } from "./voucher-check";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";
import { normaliseDepositType } from "@/lib/reservations/deposit";
import { getTimeLimits } from "@/lib/orders/time-limit-settings";

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

  const [reservations, tables, depositRow, limits] = await Promise.all([
    fetchReservations(active.restaurantId, { from }).then((rows) => withBookingDetails(active.restaurantId, rows)),
    fetchTables(active.restaurantId),
    (async () => {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("restaurants")
        .select("deposit_amount, deposit_type")
        .eq("id", active.restaurantId)
        .maybeSingle();
      return {
        amount: Number((data as { deposit_amount?: number } | null)?.deposit_amount ?? 0),
        type: normaliseDepositType((data as { deposit_type?: string } | null)?.deposit_type),
      };
    })(),
    getTimeLimits(),
  ]);

  // One server-stamped instant for every "answer before" / "no-show from"
  // decision on the board, so the server render and the browser agree.
  const now = new Date().getTime();

  return (
    <ManagerPage
      titleKey="m.reservations.title"
      descriptionKey="m.reservations.subtitle"
    >
      <VoucherCheck />
      <ReservationBoard
        reservations={reservations}
        tables={tables}
        canDecide={can(active.role, "reservations.decide")}
        canSeat={can(active.role, "reservations.seat")}
        depositAmount={depositRow.amount}
        depositType={depositRow.type}
        canCollectDeposit={can(active.role, "finance.manage")}
        canTakeDeposit={can(active.role, "payments.collect")}
        responseMinutes={limits.reservationMinutes}
        now={now}
        tableService={active.planTier === "enterprise"}
      />
    </ManagerPage>
  );
}
