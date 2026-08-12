import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { TableOrderer } from "./table-orderer";
import { requireCapability } from "@/lib/auth/branch";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchCategories, fetchMenu, fetchTables } from "@/lib/data/manager";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["nav.m.tableOrder"] };
}
export const dynamic = "force-dynamic";

export default async function TableOrderPage() {
  const { active } = await requireCapability("orders.advance");
  const supabase = createAdminClient();

  const [tables, categories, items, chargeSetting] = await Promise.all([
    fetchTables(active.restaurantId),
    fetchCategories(active.restaurantId),
    fetchMenu(active.restaurantId),
    supabase.from("settings").select("value").eq("key", "service_charge_percent").maybeSingle(),
  ]);

  return (
    <ManagerPage titleKey="m.tableOrder.title" descriptionKey="m.tableOrder.subtitle">
      <TableOrderer
        tables={tables}
        categories={categories}
        items={items}
        // The same setting createTableOrder() reads, so the preview and the
        // saved order can only disagree if it changes mid-ticket.
        chargePercent={Number(chargeSetting.data?.value ?? 5) || 0}
      />
    </ManagerPage>
  );
}
