import { AdminPage } from "@/components/layout/admin-shell";
import { SubscriptionsTable } from "./subscriptions-table";
import { listPlans, listSubscriptions } from "@/lib/data/billing";

export const dynamic = "force-dynamic";

export default async function AdminSubscriptionsPage() {
  const [subscriptions, plans] = await Promise.all([listSubscriptions(), listPlans()]);

  return (
    <AdminPage
      title="Subscriptions"
      description="Plan, state and expiry for every tenant. State is derived, never stored."
    >
      <SubscriptionsTable subscriptions={subscriptions} plans={plans} />
    </AdminPage>
  );
}
