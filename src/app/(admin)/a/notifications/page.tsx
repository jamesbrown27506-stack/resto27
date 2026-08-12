import { AdminPage } from "@/components/layout/admin-shell";
import { NotificationsList } from "./notifications-list";
import { listNotifications } from "@/lib/data/platform";
import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  const admin = await requireRole("admin");
  const notifications = await listNotifications(admin.id);

  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <AdminPage
      title="Notifications"
      description={unread > 0 ? `${unread} unread` : "Everything is read."}
    >
      <NotificationsList notifications={notifications} />
    </AdminPage>
  );
}
