import { NotificationProviderPanel } from "./notification-provider-panel";
import { getNotificationProviderStatus } from "@/lib/data/notification-provider-actions";
import { AdminPage } from "@/components/layout/admin-shell";
import { SettingsForm } from "./settings-form";
import { ResetPanel } from "./reset-panel";
import { listSettings } from "@/lib/data/platform";
import { isGatewaySettingKey } from "@/lib/auth/super-admin-rules";
import { getEmailVerificationPolicy } from "@/lib/auth/email-policy";
import { EMAIL_POLICY_KEY } from "@/lib/auth/email-policy-rules";
import { SecurityPolicyPanel } from "./security-policy-panel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await listSettings();

  return (
    <AdminPage
      title="Platform settings"
      description="Account security, branding, money, billing and payments. Read across the whole application."
    >
      <SecurityPolicyPanel initial={await getEmailVerificationPolicy()} />
      <NotificationProviderPanel initial={await getNotificationProviderStatus()} />
      {/* push_provider has its own panel above; the gateway keys have
          Payments → Gateways. Neither belongs in the generic form. */}
      <SettingsForm
        settings={settings.filter((s) => s.key !== "push_provider" && s.key !== EMAIL_POLICY_KEY && !isGatewaySettingKey(s.key))}
      />
      {/* Super admins only: wipe test activity, keep the setup (0067). */}
      <ResetPanel />
    </AdminPage>
  );
}
