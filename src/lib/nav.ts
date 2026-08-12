import type { Capability } from "./capabilities";
import type { TranslationKey } from "./i18n/dictionaries";

export interface NavItem {
  href: string;
  /**
   * A TRANSLATION KEY, not a string.
   *
   * The sidebar was hardcoded French, so the whole navigation stayed French
   * whatever the toggle said — which is the one place a language switch is
   * most obviously broken. `label` survives for the admin area, which is
   * English by design (see the note above ADMIN_NAV).
   */
  labelKey?: TranslationKey;
  label?: string;
  /** Lucide icon name, resolved by the sidebar so this file stays serialisable. */
  icon: string;
  /** Required to see the link at all. Undefined = visible to every branch role. */
  capability?: Capability;
  /** Only reachable on a paid plan — rendered with a lock affordance. */
  planGated?: boolean;
  /** Reachable while the tenant is locked out (§5, rule 3). */
  allowLocked?: boolean;
  /** Match child routes too, e.g. /m/orders/123 highlights /m/orders. */
  matchPrefix?: boolean;
}

export interface NavGroup {
  labelKey?: TranslationKey;
  label?: string;
  items: NavItem[];
}

/* ── Manager (§14.4) ───────────────────────────────────────────────────── */

export const MANAGER_NAV: NavGroup[] = [
  {
    labelKey: "nav.g.service",
    items: [
      { href: "/m", labelKey: "nav.m.dashboard", icon: "LayoutDashboard" },
      {
        href: "/m/orders",
        labelKey: "nav.m.orders",
        icon: "ReceiptText",
        capability: "orders.view",
        matchPrefix: true,
      },
      { href: "/m/kitchen", labelKey: "nav.m.kitchen", icon: "ChefHat", capability: "kitchen.display" },
      {
        href: "/m/table-order",
        labelKey: "nav.m.tableOrder",
        icon: "ConciergeBell",
        capability: "orders.advance",
      },
      {
        href: "/m/reservations",
        labelKey: "nav.m.reservations",
        icon: "CalendarCheck",
        capability: "reservations.view",
      },
      { href: "/m/tables", labelKey: "nav.m.tables", icon: "Armchair", capability: "tables.view" },
    ],
  },
  {
    labelKey: "nav.g.menu",
    items: [
      {
        href: "/m/menu",
        labelKey: "nav.m.menu",
        icon: "UtensilsCrossed",
        capability: "menu.view",
        matchPrefix: true,
      },
      { href: "/m/categories", labelKey: "nav.m.categories", icon: "LayoutGrid", capability: "menu.edit" },
      {
        href: "/m/promotions",
        labelKey: "nav.m.promotions",
        icon: "TicketPercent",
        capability: "promotions.manage",
      },
    ],
  },
  {
    labelKey: "nav.g.customers",
    items: [
      { href: "/m/customers", labelKey: "nav.m.customers", icon: "Users", capability: "customers.view" },
      { href: "/m/reviews", labelKey: "nav.m.reviews", icon: "Star", capability: "reviews.reply" },
      {
        href: "/m/reports",
        labelKey: "nav.m.reports",
        icon: "ChartColumn",
        capability: "reports.view",
        planGated: true,
      },
    ],
  },
  {
    labelKey: "nav.g.business",
    items: [
      { href: "/m/staff", labelKey: "nav.m.staff", icon: "UserCog", capability: "staff.manage" },
      {
        href: "/m/billing",
        labelKey: "nav.m.billing",
        icon: "CreditCard",
        capability: "billing.manage",
        // Rule 3: the one screen a locked tenant must still reach. Locking
        // someone out of the only page that can unlock them guarantees they
        // never pay.
        allowLocked: true,
        matchPrefix: true,
      },
      { href: "/m/profile", labelKey: "nav.m.profile", icon: "Store", capability: "profile.edit" },
      { href: "/m/settings", labelKey: "nav.m.settings", icon: "Settings", capability: "settings.manage" },
    ],
  },
];


/* ── Admin (§14.5) ─────────────────────────────────────────────────────── */

/**
 * The admin area is ENGLISH.
 *
 * Deliberate, and different from the rest of the app. The marketplace serves
 * Douala and is French-first; this dashboard has one audience — the platform
 * operators — and they asked for English. Translating an internal tool nobody
 * has requested in French buys nothing and doubles the copy to maintain.
 *
 * The FR/EN toggle in the header still works; it governs the public site,
 * which is where the two languages actually matter.
 */
export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/a", label: "Dashboard", icon: "LayoutDashboard" },
      { href: "/a/analytics", label: "Analytics", icon: "ChartColumn" },
    ],
  },
  {
    label: "Tenants",
    items: [
      { href: "/a/restaurants", label: "Restaurants", icon: "Store" },
      { href: "/a/users", label: "Users", icon: "Users" },
      { href: "/a/areas", label: "Service areas", icon: "MapPin" },
      { href: "/a/impersonate", label: "Impersonate", icon: "VenetianMask" },
    ],
  },
  {
    label: "Revenue",
    items: [
      { href: "/a/subscriptions", label: "Subscriptions", icon: "CalendarClock" },
      { href: "/a/plans", label: "Plans", icon: "Layers" },
      { href: "/a/payments", label: "Payments", icon: "CreditCard" },
      { href: "/a/commissions", label: "Commissions", icon: "Percent" },
      { href: "/a/refunds", label: "Refunds", icon: "Undo2" },
      { href: "/a/camerpay", label: "CamerPay", icon: "Smartphone" },
    ],
  },
  {
    label: "Moderation",
    items: [
      { href: "/a/reviews", label: "Reported reviews", icon: "Flag" },
      { href: "/a/support", label: "Support", icon: "LifeBuoy" },
      { href: "/a/broadcast", label: "Broadcast", icon: "Megaphone" },
      { href: "/a/notifications", label: "Notifications", icon: "Bell" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/a/audit", label: "Audit log", icon: "ScrollText" },
      { href: "/a/export", label: "CSV export", icon: "Download" },
      { href: "/a/diagnostics", label: "Diagnostics", icon: "Stethoscope" },
      { href: "/a/tests", label: "Health checks", icon: "ShieldCheck" },
      { href: "/a/appearance", label: "Appearance", icon: "Image" },
      { href: "/a/settings", label: "Settings", icon: "Settings" },
    ],
  },
];

/* ── Customer account (§14.3) ──────────────────────────────────────────── */

/**
 * `labelKey`, not `label` — this navigation is what a diner reads, and it was
 * the last part of the customer area still hardcoded French whatever the
 * toggle said. Each key is the `title` of that screen's own dictionary module,
 * so the sidebar entry and the page heading can never drift apart.
 */
export const CUSTOMER_NAV: NavItem[] = [
  { href: "/account", labelKey: "cac.title", icon: "LayoutDashboard" },
  { href: "/orders", labelKey: "cor.title", icon: "ReceiptText", matchPrefix: true },
  { href: "/reservations", labelKey: "crs.title", icon: "CalendarCheck" },
  { href: "/favorites", labelKey: "cfv.title", icon: "Heart" },
  { href: "/addresses", labelKey: "cad.title", icon: "MapPin" },
  { href: "/loyalty", labelKey: "cly.title", icon: "Gift" },
  { href: "/reviews", labelKey: "crv.title", icon: "Star" },
  { href: "/profile", labelKey: "cpf.title", icon: "User" },
  { href: "/settings", labelKey: "cst.title", icon: "Settings" },
];

/* ── Public (§14.1) ────────────────────────────────────────────────────── */

export const PUBLIC_NAV = [
  { href: "/restaurants", label: "Restaurants" },
  { href: "/pricing", label: "Tarifs" },
  { href: "/contact", label: "Contact" },
];

export const FOOTER_NAV: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Découvrir",
    links: [
      { href: "/restaurants", label: "Tous les restaurants" },
      { href: "/restaurants?city=Douala", label: "Douala" },
      { href: "/restaurants?sort=rating", label: "Les mieux notés" },
    ],
  },
  {
    heading: "Restaurateurs",
    links: [
      { href: "/register/restaurant", label: "Inscrire mon restaurant" },
      { href: "/pricing", label: "Tarifs" },
      { href: "/login", label: "Espace gérant" },
    ],
  },
  {
    heading: "Assistance",
    links: [
      { href: "/contact", label: "Nous contacter" },
      { href: "/privacy", label: "Confidentialité" },
      { href: "/terms", label: "Conditions" },
    ],
  },
];

/** Is `href` the active route for `pathname`? */
export function isActive(item: Pick<NavItem, "href" | "matchPrefix">, pathname: string): boolean {
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return pathname === item.href;
}
