import type { IconName } from "@/components/layout/icon";
import type { MoreTab, TabItem } from "@/components/layout/mobile-tabbar";
import type { NavMenuItem } from "@/components/layout/nav-menu-sheet";
import { can, type BranchRole, type Capability } from "@/lib/capabilities";
import { ADMIN_NAV, CUSTOMER_NAV, MANAGER_NAV, type NavGroup, type NavItem } from "@/lib/nav";

/**
 * THE PHONE BOTTOM BARS — every one of them, in this file.
 *
 * Edit a list below and every screen that shows that bar follows. A tab is
 * `{ href, icon, labelKey }` (or a plain `label` for the English-only admin
 * area); icons must exist in components/layout/icon.tsx and labels in the
 * dictionaries. At most SIX cells counting the last one, and every label short
 * enough for a 360 px phone — mobile-tabs.test.ts holds both. Whatever does
 * not fit goes in `more`, the sheet the last cell opens.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ONE BAR PER PERSON, EVERYWHERE.
 *
 *  The bar follows WHO is looking, never which page they are on. A
 *  restaurant's staff get the same bar on the public site as inside /m, and
 *  an administrator the same bar on the site as inside /a — so the site, the
 *  dashboard and the Android app (which loads this site) never change shape
 *  under a thumb. The restaurant bar used to be built twice, once here for the
 *  site and once in manager-shell.tsx, and crossing from one to the other
 *  changed four of its five places. `managerTabs` is now the only one.
 *
 *  There is no ☰ drawer on phones either: this bar and the sheet its last
 *  cell opens are the whole navigation, language and theme included.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type TabArea = "visitor" | "customer" | "manager" | "admin";

/** Not signed in: discover restaurants, fill a basket, see the plans. */
export const VISITOR_TABS: TabItem[] = [
  { href: "/", icon: "Home", labelKey: "nav.home" },
  { href: "/restaurants", icon: "Store", labelKey: "nav.restaurants", matchPrefix: true, activePaths: ["/explore", "/browse"] },
  { href: "/cart", icon: "ShoppingBasket", labelKey: "nav.cart", badgeKey: "cart" },
  { href: "/pricing", icon: "Layers", labelKey: "nav.pricing" },
];

/**
 * The visitor's last cell, "Connexion": sign in or create an account at the
 * top, then what a visitor could only reach through the header drawer before
 * it went — listing a restaurant, contact, language and theme.
 */
export const VISITOR_MORE: MoreTab = {
  labelKey: "nav.login",
  icon: "User",
  titleKey: "nav.guestTitle",
  descriptionKey: "nav.guestBody",
  actions: "guest",
  items: [
    { href: "/register/restaurant", icon: "Store", labelKey: "nav.registerRestaurant" },
    { href: "/contact", icon: "MessageSquare", labelKey: "nav.contact" },
  ],
};

/** A signed-in customer: find food, follow their orders, keep their bookings. */
export const CUSTOMER_TABS: TabItem[] = [
  { href: "/", icon: "Home", labelKey: "nav.home" },
  { href: "/restaurants", icon: "Store", labelKey: "nav.restaurants", matchPrefix: true, activePaths: ["/browse"] },
  { href: "/explore", icon: "Search", labelKey: "tab.explore", matchPrefix: true },
  { href: "/orders", icon: "ReceiptText", labelKey: "nav.m.orders", matchPrefix: true },
  { href: "/reservations", icon: "CalendarCheck", labelKey: "nav.m.reservations", matchPrefix: true },
];

function toMenuItem(item: NavItem, group?: NavGroup): NavMenuItem {
  return {
    href: item.href,
    icon: item.icon as IconName,
    labelKey: item.labelKey,
    label: item.label,
    matchPrefix: item.matchPrefix,
    prominent: item.prominent,
    groupKey: group?.labelKey,
    group: group?.label,
  };
}

const inTabs = (tabs: TabItem[], href: string) => tabs.some((tab) => tab.href === href);

/** The customer's "Plus": every account screen that is not already a tab. */
export const CUSTOMER_MORE: MoreTab = {
  labelKey: "nav.more",
  titleKey: "nav.moreTitle",
  descriptionKey: "nav.moreBody",
  actions: "account",
  items: CUSTOMER_NAV.filter((item) => !inTabs(CUSTOMER_TABS, item.href)).map((item) => toMenuItem(item)),
};

/**
 * A restaurant's staff — on the public site AND inside /m.
 *
 * Built from the branch role, because what someone may open depends on the
 * hat they wear at this branch (§2). A tab the role cannot use is left out
 * rather than shown and refused; every page still re-checks server-side.
 * `null` (no branch yet) leaves the dashboard and messages, the two places
 * every staff member can reach.
 */
export function managerTabs(role: BranchRole | null): { items: TabItem[]; more: MoreTab } {
  const has = (capability: Capability) => role !== null && can(role, capability);

  const items: TabItem[] = [{ href: "/m", icon: "LayoutDashboard", labelKey: "tab.dashboard" }];
  /*
    The second cell is the screen this person WORKS in. For whoever edits the
    menu that is the menu; for the kitchen it is the kitchen display.

    It used to be "menu.view first", and every role holds menu.view — so the
    kitchen's own bar had no Kitchen tab at all: the one screen a cook lives
    in was two taps deep inside "Plus", behind a menu they cannot change.
    The menu stays reachable from the sheet (and for the sold-out switch).
  */
  if (has("menu.edit")) {
    items.push({ href: "/m/menu", icon: "UtensilsCrossed", labelKey: "nav.m.menu", matchPrefix: true });
  } else if (has("kitchen.display")) {
    items.push({ href: "/m/kitchen", icon: "ChefHat", labelKey: "nav.m.kitchen", badgeKey: "kitchen" });
  } else if (has("menu.view")) {
    items.push({ href: "/m/menu", icon: "UtensilsCrossed", labelKey: "nav.m.menu", matchPrefix: true });
  }
  if (has("orders.view")) {
    items.push({ href: "/m/orders", icon: "ReceiptText", labelKey: "nav.m.orders", matchPrefix: true, badgeKey: "orders" });
  }
  if (has("reservations.view")) {
    items.push({ href: "/m/reservations", icon: "CalendarCheck", labelKey: "nav.m.reservations", badgeKey: "reservations" });
  }
  items.push({ href: "/m/messages", icon: "MessageSquare", labelKey: "nav.m.messages", badgeKey: "messages" });

  return {
    items,
    more: {
      labelKey: "nav.more",
      titleKey: "nav.menu",
      actions: "account",
      items: [
        ...MANAGER_NAV.flatMap((group) =>
          group.items
            .filter((item) => !inTabs(items, item.href) && (!item.capability || has(item.capability)))
            .map((item) => toMenuItem(item, group)),
        ),
        /*
          Everyone's OWN alert settings — sound, push on this phone, quiet
          hours. They used to live only on /m/settings, which needs
          settings.manage, so the kitchen, the cashier and the waiters (the
          people who most need the ring) could not reach their own switch.
        */
        ...(role !== null
          ? [{ href: "/m/notifications", icon: "Bell", labelKey: "mops.nav.notifications", groupKey: "nav.site" } satisfies NavMenuItem]
          : []),
        // The way out to the marketplace, now that no tab is spent on it.
        { href: "/", icon: "Globe", labelKey: "nav.publicSite", groupKey: "nav.site" },
      ],
    },
  };
}

/** An administrator — the same bar on the public site and inside /a. */
export const ADMIN_TABS: TabItem[] = [
  { href: "/a", icon: "LayoutDashboard", label: "Dashboard" },
  { href: "/a/restaurants", icon: "Store", label: "Restaurants", matchPrefix: true },
  { href: "/a/payments", icon: "CreditCard", label: "Payments", matchPrefix: true },
  { href: "/a/diagnostics", icon: "Stethoscope", label: "Diagnostics", matchPrefix: true },
];

/** The administrator's "More": the whole admin menu, grouped as in the sidebar. */
export const ADMIN_MORE: MoreTab = {
  labelKey: "nav.more",
  title: "Administration",
  actions: "account",
  items: [
    ...ADMIN_NAV.flatMap((group) =>
      group.items.filter((item) => !inTabs(ADMIN_TABS, item.href)).map((item) => toMenuItem(item, group)),
    ),
    { href: "/", icon: "Globe", label: "Public site", group: "Site" },
  ],
};

/**
 * The bar for this person. `role` is the branch role and only matters for
 * "manager": the public layout and the manager shell pass the same one, which
 * is what makes the two draw the same bar.
 */
export function tabsFor(area: TabArea, role: BranchRole | null = null): { items: TabItem[]; more: MoreTab } {
  switch (area) {
    case "customer":
      return { items: CUSTOMER_TABS, more: CUSTOMER_MORE };
    case "manager":
      return managerTabs(role);
    case "admin":
      return { items: ADMIN_TABS, more: ADMIN_MORE };
    default:
      return { items: VISITOR_TABS, more: VISITOR_MORE };
  }
}
