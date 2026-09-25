import { AdminPage, SuperAdminOnlyNotice } from "@/components/layout/admin-shell";
import { requireRole } from "@/lib/auth/session";
import { ImpersonatePicker } from "./impersonate-picker";
import { listRestaurantsForAdmin } from "@/lib/data/admin";
import { listAuditLog } from "@/lib/data/platform";

export const dynamic = "force-dynamic";

export default async function ImpersonatePage() {
  // Acting as a tenant reaches their wallet and withdrawals — super admins
  // only (beginImpersonation and getImpersonation both enforce it too).
  const admin = await requireRole("admin");
  if (!admin.isSuperAdmin) {
    return (
      <AdminPage title="Impersonate" description="See the platform exactly as a restaurant owner sees it.">
        <SuperAdminOnlyNotice>
          Acting as a restaurant reaches its wallet, withdrawals and staff, so only a super
          administrator can start a session.
        </SuperAdminOnlyNotice>
      </AdminPage>
    );
  }

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
