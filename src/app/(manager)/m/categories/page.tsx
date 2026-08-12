import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { CategoryManager } from "./category-manager";
import { requireCapability } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { fetchCategories } from "@/lib/data/manager";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

// The order shown here is the order customers see, and it changes from this
// very page — a cached copy would show the list as it was before the move.
export const dynamic = "force-dynamic";

// The browser tab is a user-visible string too, so it reads the same locale
// cookie the page renders with rather than being hardcoded French.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mc.title"] };
}

export default async function CategoriesPage() {
  const { active } = await requireCapability("menu.view");
  const categories = await fetchCategories(active.restaurantId);

  return (
    // Keys, not strings: this page is a Server Component and cannot call
    // useLocale, but ManagerPage is a Client Component and can.
    <ManagerPage titleKey="mc.title" descriptionKey="mc.subtitle">
      <CategoryManager categories={categories} canEdit={can(active.role, "menu.edit")} />
    </ManagerPage>
  );
}
