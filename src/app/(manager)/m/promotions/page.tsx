import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { PromotionManager } from "./promotion-manager";
import { requireCapability } from "@/lib/auth/branch";
import { fetchPromotions } from "@/lib/data/manager";
import { fetchPlanLimits } from "@/lib/data/billing";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

// Codes expire, run out and get switched off between two visits; a cached
// render would show a dead code as still live.
export const dynamic = "force-dynamic";

// The browser tab is a user-visible string too, so it reads the same locale
// cookie the page renders with rather than being hardcoded.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mpr.title"] };
}

export default async function PromotionsPage() {
  const { active } = await requireCapability("promotions.manage");

  const [promotions, limits] = await Promise.all([
    fetchPromotions(active.restaurantId),
    fetchPlanLimits(),
  ]);

  // A locked account is held to the entry plan's ceiling rather than the one it
  // stopped paying for — but only for NEW codes; see the banner in the client.
  const tier = active.subscriptionState === "locked" ? "starter" : active.planTier;
  const limit = limits.get(tier)?.promotionLimit ?? limits.get("starter")?.promotionLimit ?? null;

  return (
    // Keys, not strings: this page is a Server Component and cannot call
    // useLocale, but ManagerPage is a Client Component and can.
    <ManagerPage titleKey="mpr.title" descriptionKey="mpr.subtitle">
      {/* `now` is stamped here so "expired" and "scheduled" are decided against
          one clock. Reading the clock during a client render is impure (§4) and
          drifts from the HTML that was sent. */}
      <PromotionManager
        promotions={promotions}
        limit={limit}
        now={new Date().toISOString()}
      />
    </ManagerPage>
  );
}
