import { AdminPage } from "@/components/layout/admin-shell";
import { PaymentsTable } from "./payments-table";
import { listPaymentAttempts } from "@/lib/data/billing";

export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage() {
  const attempts = await listPaymentAttempts();

  return (
    <AdminPage
      title="Payments"
      description="Subscription payment attempts and manual confirmation."
    >
      <PaymentsTable attempts={attempts} />
    </AdminPage>
  );
}
