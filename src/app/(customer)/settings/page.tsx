import { SettingsClient } from "./settings-client";
import { requireUser } from "@/lib/auth/session";
import { fetchCustomerPreferences } from "@/lib/data/customer";

export default async function SettingsPage() {
  const user = await requireUser();
  const prefs = await fetchCustomerPreferences(user.id);

  return <SettingsClient user={user} initial={prefs} />;
}