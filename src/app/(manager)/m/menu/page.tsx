import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { MenuManager } from "./menu-manager";
import { requireCapability } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { fetchCategories, fetchMenu } from "@/lib/data/manager";
import { ensureDefaultCategories } from "@/lib/data/manager-actions";
import { fetchPlanLimits } from "@/lib/data/billing";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["nav.m.menu"] };
}

/**
 * The carte changes during service — a dish is marked sold out mid-rush and
 * the next person to open this page must see that, not a cached copy from
 * before the kitchen ran out.
 */
export const dynamic = "force-dynamic";

export default async function MenuPage() {
  // `menu.view`, not `menu.edit`: kitchen staff need to read the carte. The
  // edit controls are gated separately, below.
  const { active } = await requireCapability("menu.view");

  // A first visit seeds Entrées / Plats principaux / Desserts / Boissons so
  // dishes can never be invisible for want of a category to file them under.
  await ensureDefaultCategories();

  const [categories, items, limits] = await Promise.all([
    fetchCategories(active.restaurantId),
    fetchMenu(active.restaurantId),
    fetchPlanLimits(),
  ]);

  /**
   * A locked tenant drops to STARTER limits (§5) — existing rows keep working,
   * new ones are refused.
   *
   * Note this reads the plan limit from the database, not from a constant: an
   * admin can change what Professional includes, and a hardcoded ceiling would
   * keep enforcing yesterday's number.
   */
  const tier = active.subscriptionState === "locked" ? "starter" : active.planTier;
  const limit = limits.get(tier)?.menuItemLimit ?? limits.get("starter")?.menuItemLimit ?? null;

  return (
    // titleKey, not title: this is a Server Component and cannot call
    // useLocale, so the heading is translated by <ManagerPage> itself.
    <ManagerPage titleKey="mm.title" descriptionKey="mm.subtitle">
      <MenuManager
        categories={categories}
        items={items}
        limit={limit}
        canEdit={can(active.role, "menu.edit")}
        // The sold-out switch is its own capability: the kitchen knows first.
        canToggleAvailability={can(active.role, "menu.availability")}
      />
    </ManagerPage>
  );
}
