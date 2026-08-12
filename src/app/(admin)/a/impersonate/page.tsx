import { AdminPage } from "@/components/layout/admin-shell";
import { ImpersonatePicker } from "./impersonate-picker";
import { listRestaurantsForAdmin } from "@/lib/data/admin";
import { listAuditLog } from "@/lib/data/platform";

export const dynamic = "force-dynamic";

export default async function ImpersonatePage() {
  const [restaurants, audit] = await Promise.all([listRestaurantsForAdmin(), listAuditLog(50)]);

  return (
    <AdminPage
      title="Impersonate"
      description="See the platform exactly as a restaurant owner sees it."
    >
      <ImpersonatePicker
        // Only active tenants: impersonating a suspended or pending account
        // would show a broken experience and prove nothing.
        restaurants={restaurants.filter((r) => r.status === "active")}
        history={audit.filter((entry) => entry.action.startsWith("impersonation."))}
      />
    </AdminPage>
  );
}
