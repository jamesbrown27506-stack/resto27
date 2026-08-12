import { AdminPage } from "@/components/layout/admin-shell";
import { RefundsTable } from "./refunds-table";
import { listRefunds, listRestaurantOptions } from "@/lib/data/billing";

export const dynamic = "force-dynamic";

export default async function RefundsPage() {
  const [refunds, restaurants] = await Promise.all([listRefunds(), listRestaurantOptions()]);

  return (
    <AdminPage
      title="Refunds"
      description="Refunds and chargebacks, each on its own row."
    >
      <RefundsTable refunds={refunds} restaurants={restaurants} />
    </AdminPage>
  );
}
