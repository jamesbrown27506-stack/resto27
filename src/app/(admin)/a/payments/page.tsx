import { AdminPage } from "@/components/layout/admin-shell";
import { PaymentsTable } from "./payments-table";
import { listPaymentAttempts } from "@/lib/data/billing";
import { getGatewayStatus } from "@/lib/data/payment-gateway-actions";
import { GatewaysPanel } from "./gateways-panel";

export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage() {
  const [attempts, gateways] = await Promise.all([listPaymentAttempts(), getGatewayStatus()]);

  return (
    <AdminPage
      title="Payments"
      description="Cameroon payment gateways, subscription payment attempts and manual confirmation."
    >
      <GatewaysPanel initial={gateways} />
      <PaymentsTable attempts={attempts} />
    </AdminPage>
  );
}
