import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SetupWizard } from "./setup-wizard";
import { requireBranch } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { fetchCategories, fetchTables } from "@/lib/data/manager";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/**
 * First-login setup for a brand-new restaurant.
 *
 * The dashboard redirects here until `setup_done_at` is set, so this is the
 * first screen a new tenant sees. Three steps: seed a couple of tables, a
 * word about the four default menu categories (which already exist —
 * `ensureDefaultCategories` seeds them on the first visit to /m/menu, so the
 * wizard only ever talks about them), then one-tap starter dishes — the
 * popular Cameroonian classics the restaurant actually serves.
 *
 * NOT gated on tables.manage: the dashboard sends ANY role here — a waiter
 * added before the owner ever logged in is perfectly possible. Roles without
 * table rights see the step as read-only and can still finish.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["stp.title"] };
}

export default async function SetupPage() {
  const { active, profile } = await requireBranch();

  // Already through? The wizard is done, not a museum.
  if (active.setupDoneAt) redirect("/m");

  const [tables, categories] = await Promise.all([
    fetchTables(active.restaurantId),
    fetchCategories(active.restaurantId),
  ]);

  return (
    <SetupWizard
      restaurantName={active.restaurantName}
      userName={profile.name}
      tables={tables}
      categories={categories.map((c) => c.name)}
      canCreateTables={can(active.role, "tables.manage")}
      // The fee step calls setRestaurantDeposit, which is gated on
      // finance.manage — a role without it used to be redirected to
      // /not-found mid-wizard instead of being told it was not their step.
      canSetFee={can(active.role, "finance.manage")}
    />
  );
}