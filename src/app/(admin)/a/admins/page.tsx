import { AdminPage } from "@/components/layout/admin-shell";
import { requireRole } from "@/lib/auth/session";
import { listAdministrators, superAdminColumnExists } from "@/lib/data/admins";
import { AdminsClient } from "./admins-client";

export const dynamic = "force-dynamic";

/**
 * Administrators — who runs the platform, and at which level.
 *
 * Every admin can SEE the list (knowing who to ask for a money change is
 * half the point of having levels); only super admins get the controls, and
 * the actions in lib/data/admin-management-actions.ts refuse anyone else
 * regardless of what this page renders.
 */
export default async function AdminsPage() {
  const [me, admins, migrated] = await Promise.all([
    requireRole("admin"),
    listAdministrators(),
    superAdminColumnExists(),
  ]);

  return (
    <AdminPage
      title="Administrators"
      description="Simple administrators run the platform day to day. Super administrators also control money, gateways, fees, impersonation and who is an administrator."
    >
      <AdminsClient admins={admins} currentAdminId={me.id} migrated={migrated} />
    </AdminPage>
  );
}
