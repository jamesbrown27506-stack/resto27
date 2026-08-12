import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { SettingsView } from "./settings-view";
import { requireCapability } from "@/lib/auth/branch";
import { fetchNotificationPreferences, fetchPausedReason } from "@/lib/data/settings";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

// The service state and the saved preferences both change from this very page,
// and the pause is read by every customer-facing screen — a cached copy would
// show a restaurant as open after it closed.
export const dynamic = "force-dynamic";

// The browser tab is a user-visible string too, so it reads the same locale
// cookie the page renders with rather than being hardcoded French.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mset.title"] };
}

export default async function ManagerSettingsPage() {
  const { active, profile } = await requireCapability("settings.manage");

  // Preferences are PER PERSON per branch (0012), so the profile id is as much
  // a part of the query as the restaurant id.
  const [preferences, pausedReason] = await Promise.all([
    fetchNotificationPreferences(active.restaurantId, profile.id),
    fetchPausedReason(active.restaurantId),
  ]);

  return (
    // Keys, not strings: this page is a Server Component and cannot call
    // useLocale, but ManagerPage is a Client Component and can.
    <ManagerPage titleKey="mset.title" descriptionKey="mset.subtitle">
      {/* Keyed on the branch: the view holds an unsaved DRAFT of the switches,
          and switching location must start that draft again rather than carry
          one branch's answers into another's rows. */}
      <SettingsView
        key={active.restaurantId}
        preferences={preferences}
        acceptingOrders={active.isAcceptingOrders}
        pausedReason={pausedReason}
      />
    </ManagerPage>
  );
}
