import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { TableManager } from "./table-manager";
import { requireCapability } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { fetchTables } from "@/lib/data/manager";
import { fetchPlanLimits } from "@/lib/data/billing";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["nav.m.tables"] };
}

export default async function TablesPage() {
  const { active } = await requireCapability("tables.view");

  const [tables, limits] = await Promise.all([
    fetchTables(active.restaurantId),
    fetchPlanLimits(),
  ]);

  const tier = active.subscriptionState === "locked" ? "starter" : active.planTier;
  const limit = (limits.get(tier) ?? limits.get("starter"))?.tableLimit ?? null;

  const seats = tables.reduce((sum, t) => sum + t.capacity, 0);

  return (
    <ManagerPage
      titleKey="m.tables.title"
      description={`${tables.length} table${tables.length > 1 ? "s" : ""} · ${seats} place${seats > 1 ? "s" : ""}`}
    >
      <TableManager tables={tables} limit={limit} canManage={can(active.role, "tables.manage")} />
    </ManagerPage>
  );
}
