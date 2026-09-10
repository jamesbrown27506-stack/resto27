"use client";
import { MobileTabBar } from "./mobile-tabbar";
import { tabsFor, type TabArea } from "@/lib/mobile-tabs";

/**
 * The phone bottom bar on the public site and in the customer area. Which
 * tabs it shows depends on who is looking — see lib/mobile-tabs, the one
 * place every bottom bar is defined.
 */
export function CustomerNavigation({ area }: { area: TabArea }) {
  const { items, more } = tabsFor(area);
  return <MobileTabBar items={items} more={more} />;
}
