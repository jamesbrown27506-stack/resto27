import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { requireBranch } from "@/lib/auth/branch";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";
import { MyNotificationsView } from "./my-notifications-view";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mops.notif.title"] };
}

/**
 * Every staff member's OWN alert settings — any branch role.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS IS NOT ON /m/settings OR /m/profile.
 *
 *  The per-person panel (push on this device, e-mail, quiet hours) used to
 *  be reachable only through /m/settings, gated on `settings.manage` — so
 *  the kitchen, the cashier and the waiters, the people the order ring is
 *  FOR, could not switch their own phone's push on. /m/profile is the
 *  RESTAURANT's public profile (`profile.edit`), a different thing again.
 *
 *  This page needs nothing but a branch: what it changes belongs to the
 *  person signed in, never to the restaurant. The component is the same one
 *  the customer and admin areas use, so the three can never drift apart.
 * ─────────────────────────────────────────────────────────────────────────
 */
export default async function MyNotificationsPage() {
  await requireBranch();

  return (
    <ManagerPage titleKey="mops.notif.title" descriptionKey="mops.notif.subtitle">
      <MyNotificationsView />
    </ManagerPage>
  );
}
