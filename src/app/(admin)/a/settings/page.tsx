import { NotificationProviderPanel } from "./notification-provider-panel";
import { getNotificationProviderStatus } from "@/lib/data/notification-provider-actions";
import { AdminPage } from "@/components/layout/admin-shell";
import { SettingsForm } from "./settings-form";
import { listSettings } from "@/lib/data/platform";
import { isGatewaySettingKey } from "@/lib/auth/super-admin-rules";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await listSettings();

  return (
    <AdminPage
      title="Platform settings"
      description="Branding, money, billing and payments. Read across the whole application."
    >
      <NotificationProviderPanel initial={await getNotificationProviderStatus()} />
      {/* push_provider has its own panel above; the gateway keys have
          Payments → Gateways. Neither belongs in the generic form. */}
      <SettingsForm
        settings={settings.filter((s) => s.key !== "push_provider" && !isGatewaySettingKey(s.key))}
      />
    </AdminPage>
  );
}
