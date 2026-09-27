import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { TableOrderer, type OpenBill } from "./table-orderer";
import { requireCapability } from "@/lib/auth/branch";
import { fetchCategories, fetchMenu, fetchTables } from "@/lib/data/manager";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";
import { onsiteOrdersAllowed } from "@/lib/billing/plan-access";
import { PlanGateUpsell } from "@/components/billing/plan-gate";
import { fetchDiningFloor, getMyDiningNotifications } from "@/lib/data/dining-actions";
import { can } from "@/lib/capabilities";
import { DiningFloor, type DiningFloorSession } from "./dining-floor";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["nav.m.tableOrder"] };
}
export const dynamic = "force-dynamic";

export default async function TableOrderPage({ searchParams }: { searchParams: Promise<{ session?: string; bill?: string }> }) {
  const { session, bill } = await searchParams;
  const { active } = await requireCapability("orders.advance");
  if (!onsiteOrdersAllowed(active)) {
    return (
      <ManagerPage titleKey="m.tableOrder.title" descriptionKey="m.tableOrder.subtitle">
        <PlanGateUpsell feature="mgate.feature.onsiteOrders" plan="mgate.plan.professional" />
      </ManagerPage>
    );
  }
  const enterprise = active.planTier === "enterprise";
  const [tables, categories, items, diningSessions, diningNotifications] = await Promise.all([
    fetchTables(active.restaurantId),
    fetchCategories(active.restaurantId),
    fetchMenu(active.restaurantId),
    enterprise ? fetchDiningFloor(active.restaurantId) : Promise.resolve([]),
    enterprise ? getMyDiningNotifications() : Promise.resolve(true),
  ]);
  const floor = diningSessions as unknown as DiningFloorSession[];

  /*
    ENTERPRISE: EVERYTHING EATEN AT A TABLE IS ON ONE OF ITS BILLS (0068).
    The waiter picks an open bill on the table, or opens a new one (a
    walk-in, a guest without a phone) — never a separate ticket beside the
    guests' own bills.
  */
  const openBills: OpenBill[] | undefined = enterprise
    ? floor.map((entry) => {
        const table = Array.isArray(entry.restaurant_tables) ? entry.restaurant_tables[0] : entry.restaurant_tables;
        return {
          id: entry.id,
          tableId: table?.id ?? "",
          label: entry.label ?? null,
          code: entry.join_code ?? null,
          confirmed: Boolean(entry.presence_confirmed_at) && entry.status === "open",
        };
      })
    : undefined;
  const now = new Date().getTime();

  return (
    <ManagerPage titleKey="m.tableOrder.title" descriptionKey="m.tableOrder.subtitle">
      {enterprise && (
        <DiningFloor
          sessions={floor}
          focusSessionId={session}
          canCollect={can(active.role, "payments.collect")}
          canSeat={can(active.role, "reservations.seat")}
          notificationsEnabled={diningNotifications}
          now={now}
        />
      )}
      <TableOrderer
        tables={tables}
        categories={categories}
        items={items}
        bills={openBills}
        focusBillId={bill}
      />
    </ManagerPage>
  );
}
