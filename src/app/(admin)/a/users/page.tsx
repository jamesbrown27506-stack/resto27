import { AdminPage } from "@/components/layout/admin-shell";
import { UsersTable } from "./users-table";
import { listUsersForAdmin } from "@/lib/data/admin";
import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  // Also gives us the current admin's id, so the table can refuse to offer
  // "suspend" and "anonymise" on their own row.
  const [admin, users] = await Promise.all([requireRole("admin"), listUsersForAdmin()]);

  return (
    <AdminPage
      title="Users"
      description="Customer, restaurant-owner and administrator accounts."
    >
      <UsersTable users={users} currentUserId={admin.id} />
    </AdminPage>
  );
}
