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
      <SettingsForm settings={settings} />
    </AdminPage>
  );
}
