import type { Metadata } from "next";
import { KitchenBoard } from "./kitchen-board";
import { requireCapability } from "@/lib/auth/branch";
import { fetchKitchenQueue } from "@/lib/data/orders";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["nav.m.kitchen"] };
}
export const dynamic = "force-dynamic";

export default async function KitchenPage() {
  const { active } = await requireCapability("kitchen.display");
  // Confirmed + preparing, oldest first (§14.4).
  const orders = await fetchKitchenQueue(active.restaurantId);

  return <KitchenBoard orders={orders} now={new Date().toISOString()} />;
}
