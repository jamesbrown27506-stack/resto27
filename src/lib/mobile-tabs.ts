import type { IconName } from "@/components/layout/icon";
import type { MoreTab, TabItem } from "@/components/layout/mobile-tabbar";
import type { NavMenuItem } from "@/components/layout/nav-menu-sheet";
import { ADMIN_NAV, CUSTOMER_NAV, type NavItem } from "@/lib/nav";

/**
 * THE PHONE BOTTOM BARS — every one of them, in this file.
 *
 * Edit a list below and every screen that shows that bar follows. A tab is
 * `{ href, icon, labelKey }` (or a plain `label` for the English-only admin
 * area); icons must exist in components/layout/icon.tsx and labels in the
 * dictionaries. Keep four or five tabs: a sixth no longer fits a small phone.
 * Whatever does not fit goes in `more`, which opens the rest as a grid.
 *
 * The bar follows WHO is looking, not which page they are on: an
 * administrator browsing the public site keeps the administrator's bar, so
 * crossing between the site and /a never changes the navigation under their
 * thumb.
 *
 * The manager area itself builds its own bar (manager-shell.tsx): its tabs
 * depend on the staff member's role and carry live order counts.
 */

export type TabArea = "visitor" | "customer" | "manager" | "admin";

/** Not signed in: discover restaurants and dishes, see the plans, sign in. */
export const VISITOR_TABS: TabItem[] = [
  { href: "/", icon: "Home", labelKey: "nav.home" },
  { href: "/restaurants", icon: "Store", labelKey: "nav.restaurants", matchPrefix: true },
  { href: "/explore", icon: "Search", labelKey: "tab.explore", matchPrefix: true },
  { href: "/pricing", icon: "Layers", labelKey: "nav.pricing" },
];

export const VISITOR_MORE: MoreTab = {
  labelKey: "nav.more", icon: "User", titleKey: "nav.menu", withAccountActions: true,
  items: [
    { href: "/login", icon: "User", labelKey: "nav.login", group: "Account" },
    { href: "/register", icon: "User", labelKey: "nav.register", group: "Account" },
    { href: "/contact", icon: "LifeBuoy", labelKey: "nav.contact", group: "Help" },
    { href: "/register/restaurant", icon: "Store", labelKey: "nav.registerRestaurant", group: "Restaurants" },
  ],
};

/** A signed-in customer: find food, follow orders, talk to restaurants. */
export const CUSTOMER_TABS: TabItem[] = [
  { href: "/", icon: "Home", labelKey: "nav.home" },
  { href: "/restaurants", icon: "Store", labelKey: "nav.restaurants", matchPrefix: true, activePaths: ["/browse", "/explore"] },
  { href: "/orders", icon: "ReceiptText", labelKey: "nav.m.orders", matchPrefix: true },
  { href: "/reservations", icon: "CalendarCheck", labelKey: "nav.m.reservations", matchPrefix: true },
];

/** A restaurant's staff sees these same primary desks everywhere. */
export const MANAGER_SITE_TABS: TabItem[] = [
  { href: "/m", icon: "LayoutDashboard", labelKey: "nav.m.dashboard" },
  { href: "/m/orders", icon: "ReceiptText", labelKey: "nav.m.orders", matchPrefix: true },
  { href: "/m/reservations", icon: "CalendarCheck", labelKey: "nav.m.reservations", matchPrefix: true },
  { href: "/m/wallet", icon: "Wallet", labelKey: "nav.m.wallet", matchPrefix: true },
];

/** An administrator — the same bar on the public site and inside /a. */
export const ADMIN_TABS: TabItem[] = [
  { href: "/", icon: "Home", labelKey: "nav.site" },
  { href: "/a", icon: "LayoutDashboard", label: "Dashboard" },
  { href: "/a/restaurants", icon: "Store", label: "Restaurants", matchPrefix: true },
  { href: "/a/payments", icon: "CreditCard", label: "Payments", matchPrefix: true },
];

function toMenuItem(item: NavItem, group?: string): NavMenuItem {
  return {
    href: item.href,
    icon: item.icon as IconName,
    labelKey: item.labelKey,
    label: item.label,
    matchPrefix: item.matchPrefix,
    group,
  };
}

const inTabs = (tabs: TabItem[], href: string) => tabs.some((tab) => tab.href === href);

/** The customer's "Compte" tab: every account screen not already a tab. */
export const CUSTOMER_MORE: MoreTab = {
  labelKey: "tab.account",
  icon: "User",
  titleKey: "nav.moreTitle",
  descriptionKey: "nav.moreBody",
  withAccountActions: true,
  items: CUSTOMER_NAV.filter((item) => !inTabs(CUSTOMER_TABS, item.href)).map((item) =>
    toMenuItem(item, ["/account", "/messages"].includes(item.href) ? "Activity" : ["/favorites", "/loyalty", "/reviews"].includes(item.href) ? "Your Resto237" : "Account"),
  ),
};

/** Secondary restaurant tools, shared by the public site and manager area. */
export const MANAGER_MORE: MoreTab = {
  labelKey: "nav.more", icon: "User", titleKey: "nav.menu", withAccountActions: true,
  items: [
    { href: "/m/menu", icon: "UtensilsCrossed", labelKey: "nav.m.menu", matchPrefix: true, group: "Restaurant" },
    { href: "/m/kitchen", icon: "ChefHat", labelKey: "nav.m.kitchen", matchPrefix: true, group: "Restaurant" },
    { href: "/m/messages", icon: "MessageSquare", labelKey: "nav.m.messages", matchPrefix: true, group: "Restaurant" },
    { href: "/m/settings", icon: "Settings", labelKey: "nav.m.settings", matchPrefix: true, group: "Account" },
    { href: "/m/profile", icon: "Store", labelKey: "nav.m.profile", matchPrefix: true, group: "Account" },
    { href: "/", icon: "Home", labelKey: "nav.site", group: "Resto237" },
  ],
};

/** The administrator's "More" tab: the whole admin menu, grouped as in the sidebar. */
export const ADMIN_MORE: MoreTab = {
  labelKey: "nav.more",
  title: "Administration",
  withAccountActions: true,
  items: ADMIN_NAV.flatMap((group) =>
    group.items.filter((item) => !inTabs(ADMIN_TABS, item.href)).map((item) => toMenuItem(item, group.label)),
  ),
};

export function tabsFor(area: TabArea): { items: TabItem[]; more?: MoreTab } {
  switch (area) {
    case "customer":
      return { items: CUSTOMER_TABS, more: CUSTOMER_MORE };
    case "manager":
      return { items: MANAGER_SITE_TABS, more: MANAGER_MORE };
    case "admin":
      return { items: ADMIN_TABS, more: ADMIN_MORE };
    default:
      return { items: VISITOR_TABS, more: VISITOR_MORE };
  }
}
