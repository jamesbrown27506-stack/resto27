import { AdminPage } from "@/components/layout/admin-shell";
import { CommissionsTable } from "./commissions-table";
import { listCommissionStatements } from "@/lib/data/billing";

export const dynamic = "force-dynamic";

export default async function CommissionsPage() {
  const statements = await listCommissionStatements();

  return (
    <AdminPage
      title="Commissions"
      description="One statement per tenant, per period. Rates are frozen at generation."
    >
      <CommissionsTable statements={statements} />
    </AdminPage>
  );
}
