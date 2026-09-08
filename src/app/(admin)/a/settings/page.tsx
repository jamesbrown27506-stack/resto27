import { NotificationProviderPanel } from "./notification-provider-panel";
import { getNotificationProviderStatus } from "@/lib/data/notification-provider-actions";
import { AdminPage } from "@/components/layout/admin-shell";
import { SettingsForm } from "./settings-form";
import { listSettings } from "@/lib/data/platform";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await listSettings();

  return (
    <AdminPage
      title="Platform settings"
      description="Branding, money, billing and payments. Read across the whole application."
    >
      <NotificationProviderPanel initial={await getNotificationProviderStatus()} />
      <SettingsForm settings={settings.filter(s => s.key !== "push_provider")} />
    </AdminPage>
  );
}
