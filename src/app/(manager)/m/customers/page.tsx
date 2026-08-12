import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { CustomersView } from "./customers-view";
import { requireCapability } from "@/lib/auth/branch";
import { customerTotals, fetchCustomers } from "@/lib/data/customers";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mcu.title"] };
}

// The list is derived from orders, so it changes with every service. Caching it
// would show yesterday's regulars.
export const dynamic = "force-dynamic";

export default async function ManagerCustomersPage() {
  const { active } = await requireCapability("customers.view");
  const customers = await fetchCustomers(active.restaurantId);

  return (
    <ManagerPage titleKey="mcu.title" descriptionKey="mcu.subtitle">
      {/* Folded once here rather than on every client render, and `now` is
          stamped on the server so "last order" is measured against one clock. */}
      <CustomersView
        customers={customers}
        totals={customerTotals(customers)}
        now={new Date().toISOString()}
      />
    </ManagerPage>
  );
}
