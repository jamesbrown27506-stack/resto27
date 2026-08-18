import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { ReservationBoard } from "./reservation-board";
import { requireCapability } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchReservations, fetchTables } from "@/lib/data/manager";
import { isFreeMode } from "@/lib/data/billing";
import { PlanGateUpsell } from "@/components/billing/plan-gate";
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
   * TABLE RESERVATIONS ARE A PROFESSIONAL FEATURE (§14.4).
   *
   * Same tier rule as reports: a locked tenant drops to Starter (§5), so the
   * gate holds for them too. Free mode (platform free for now) suppresses the
   * gate entirely — that is the point of the flag.
   *
   * The gate returns BEFORE the queries run, so a Starter tenant browsing the
   * board costs nothing but the page render.
   */
  const tier = active.subscriptionState === "locked" ? "starter" : active.planTier;
  const freeMode = await isFreeMode();

  if (!freeMode && tier === "starter") {
    return (
      <ManagerPage titleKey="m.reservations.title" descriptionKey="m.reservations.subtitle">
        <PlanGateUpsell feature="mgate.feature.reservations" plan="mgate.plan.professional" />
      </ManagerPage>
    );
  }

  /**
   * Today onwards, midnight-anchored.
   *
   * `new Date()` would hide a booking taken for 19:00 while it is 20:00 and
   * the table is still occupied — the evening's own bookings would vanish from
   * the screen that is meant to run the evening.
   */
  const from = new Date();
  from.setHours(0, 0, 0, 0);

  const [reservations, tables, depositRow] = await Promise.all([
    fetchReservations(active.restaurantId, { from }),
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
        type: (
          (data as { deposit_type?: string } | null)?.deposit_type === "percent"
            ? "percent"
            : "fixed"
        ) as "fixed" | "percent",
      };
    })(),
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
        depositAmount={depositRow.amount}
        depositType={depositRow.type}
        canCollectDeposit={can(active.role, "finance.manage")}
      />
    </ManagerPage>
  );
}
