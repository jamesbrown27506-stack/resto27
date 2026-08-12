import { AdminPage } from "@/components/layout/admin-shell";
import { PlansEditor } from "./plans-editor";
import { listPlans } from "@/lib/data/billing";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const plans = await listPlans();

  return (
    <AdminPage
      title="Plans"
      description="Pricing, limits and commission. These values are both advertised and enforced."
    >
      <PlansEditor plans={plans} />
    </AdminPage>
  );
}
