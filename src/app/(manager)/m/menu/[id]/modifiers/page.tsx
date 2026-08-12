import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ManagerPage } from "@/components/layout/manager-shell";
import { ModifierManager } from "./modifier-manager";
import { requireCapability } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { fetchMenuItem } from "@/lib/data/manager";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mod.title"] };
}

// Groups and options change while the manager is on the page, and the id in
// the URL is per-tenant — there is nothing here that can be built ahead of
// time without either going stale or leaking across restaurants.
export const dynamic = "force-dynamic";

/**
 * Option groups and their options (§3).
 *
 * Two levels, rendered as two levels: the GROUP carries min/max/required and
 * the OPTIONS inside carry price deltas. Presenting this as one flat list is
 * the most common way the model gets mangled in a port, and it makes "choose
 * exactly one size" unexpressible.
 *
 * `menu.view`, not `menu.edit`: kitchen staff need to read what a dish can be
 * ordered with. The mutation controls are gated separately, below.
 *
 * The id comes from the URL, so the read is scoped to the branch: an id copied
 * out of another tenant's address bar finds nothing and 404s rather than
 * rendering someone else's carte.
 */
export default async function ModifiersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { active } = await requireCapability("menu.view");

  const item = await fetchMenuItem(active.restaurantId, id);
  if (!item) notFound();

  return (
    <ManagerPage titleKey="mod.title" description={item.name}>
      <ModifierManager item={item} canEdit={can(active.role, "menu.edit")} />
    </ManagerPage>
  );
}
