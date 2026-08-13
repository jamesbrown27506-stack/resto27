import { AdminPage } from "@/components/layout/admin-shell";
import { NotificationsList } from "./notifications-list";
import { NotificationSettings } from "@/components/notifications/notification-settings";
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
      {/*
        THE ADMIN'S OWN CHANNEL SWITCHES.

        Until migration 0027 this was the one role with no preferences at all:
        lib/notify hardcoded in-app + email + push on for every admin, and the
        only way to find out whether push worked was the sample-event tester
        on /a/tests — which proves nothing about anyone else's phone. The same
        panel the customer and the manager get now lives here, and enabling
        push sends its own confirmation through the real writer.
      */}
      <div className="mb-6 max-w-3xl">
        <NotificationSettings />
      </div>

      <NotificationsList notifications={notifications} />
    </AdminPage>
  );
}
