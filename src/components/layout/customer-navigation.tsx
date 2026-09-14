"use client";
import { MobileTabBar } from "./mobile-tabbar";
import { useManagerNavCounts } from "@/components/notifications/nav-counts";
import { tabsFor } from "@/lib/mobile-tabs";
import type { HeaderUser } from "./site-header";

/**
 * The phone bottom bar on the public site and in the customer area. Which
 * tabs it shows depends on who is looking — see lib/mobile-tabs, the one
 * place every bottom bar is defined.
 *
 * A restaurant's staff get their /m bar here too: built from the same branch
 * role and carrying the same live counts, so walking from the dashboard onto
 * the site changes nothing under the thumb.
 */
export function CustomerNavigation({ user }: { user: HeaderUser | null }) {
  const area = user?.area ?? "visitor";
  const branch = area === "manager" ? (user?.branch ?? null) : null;
  const { items, more } = tabsFor(area, branch?.role ?? null);
  const counts = useManagerNavCounts(branch?.restaurantId ?? null);

  return <MobileTabBar items={items} more={more} counts={counts} />;
}
