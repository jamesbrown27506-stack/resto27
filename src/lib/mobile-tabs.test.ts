import { describe, expect, it } from "vitest";
import type { MoreTab, TabItem } from "@/components/layout/mobile-tabbar";
import { DICTIONARIES, type TranslationKey } from "@/lib/i18n/dictionaries";
import { BRANCH_ROLES, can } from "./capabilities";
import { ADMIN_TABS, CUSTOMER_TABS, VISITOR_TABS, managerTabs, tabsFor } from "./mobile-tabs";

/**
 * The phone bars, pinned.
 *
 * Two rules keep a bar usable on the 360 px Androids most of Douala holds:
 * at most six cells, and labels short enough that a cell never truncates
 * them. "Réservations" (12) is the longest that still fits once long labels
 * borrow width from short ones (mobile-tabbar.tsx) — "Tableau de bord" (15)
 * is the kind of label this is here to refuse.
 */
const LONGEST_LABEL = 12;

function labelsOf(item: TabItem | MoreTab): string[] {
  if (item.label) return [item.label];
  const key = item.labelKey as TranslationKey;
  return [DICTIONARIES.fr[key], DICTIONARIES.en[key]];
}

const hrefs = (items: { href: string }[]) => items.map((item) => item.href);

const BARS: [string, ReturnType<typeof tabsFor>][] = [
  ["visitor", tabsFor("visitor")],
  ["customer", tabsFor("customer")],
  ["admin", tabsFor("admin")],
  ["manager without a branch", tabsFor("manager", null)],
  ...BRANCH_ROLES.map((role): [string, ReturnType<typeof tabsFor>] => [`manager (${role})`, tabsFor("manager", role)]),
];

describe("every phone bar", () => {
  it.each(BARS)("%s: at most six cells, every label fits", (_, bar) => {
    expect(bar.items.length + 1).toBeLessThanOrEqual(6);
    for (const item of [...bar.items, bar.more]) {
      for (const text of labelsOf(item)) {
        expect(text, `missing label for ${JSON.stringify(item)}`).toBeTruthy();
        expect(text.length, `"${text}" is too long for a tab`).toBeLessThanOrEqual(LONGEST_LABEL);
      }
    }
  });

  it.each(BARS)("%s: the sheet never repeats a tab", (_, bar) => {
    const tabs = new Set(hrefs(bar.items));
    expect(bar.more.items.filter((item) => tabs.has(item.href))).toEqual([]);
  });
});

describe("who sees what", () => {
  it("a visitor: the basket and the plans, sign-in in the last cell", () => {
    expect(hrefs(VISITOR_TABS)).toEqual(["/", "/restaurants", "/cart", "/pricing"]);
    const more = tabsFor("visitor").more;
    expect(more.actions).toBe("guest");
    expect(more.labelKey).toBe("nav.login");
  });

  it("a customer: home, restaurants, explore, orders, reservations, then Plus", () => {
    expect(hrefs(CUSTOMER_TABS)).toEqual(["/", "/restaurants", "/explore", "/orders", "/reservations"]);
    expect(hrefs(tabsFor("customer").more.items)).toContain("/messages");
  });

  it("an owner: dashboard, menu, orders, reservations, messages, then Plus", () => {
    expect(hrefs(managerTabs("owner").items)).toEqual(["/m", "/m/menu", "/m/orders", "/m/reservations", "/m/messages"]);
  });

  it("staff are offered a tab or sheet entry only with the capability behind it", () => {
    for (const role of BRANCH_ROLES) {
      const { items, more } = managerTabs(role);
      expect(hrefs(items).includes("/m/reservations"), role).toBe(can(role, "reservations.view"));
      expect(hrefs(more.items).includes("/m/staff"), role).toBe(can(role, "staff.manage"));
      expect(hrefs(more.items).includes("/m/billing"), role).toBe(can(role, "billing.manage"));
      expect(hrefs(more.items).includes("/m/wallet"), role).toBe(can(role, "finance.manage"));
      if (can(role, "finance.manage")) expect(more.items.find((item) => item.href === "/m/wallet")?.prominent).toBe(true);
    }
  });

  it("the kitchen gets its own screen as a tab, not a menu it cannot change", () => {
    const { items, more } = managerTabs("kitchen");
    expect(hrefs(items)).toContain("/m/kitchen");
    expect(hrefs(items)).not.toContain("/m/menu");
    // The menu is still reachable (the sold-out switch lives there).
    expect(hrefs(more.items)).toContain("/m/menu");
  });

  it("whoever edits the menu keeps the Menu tab; roles without either keep the menu", () => {
    for (const role of BRANCH_ROLES) {
      const tabs = hrefs(managerTabs(role).items);
      if (can(role, "menu.edit")) expect(tabs, role).toContain("/m/menu");
      else if (can(role, "kitchen.display")) expect(tabs, role).toContain("/m/kitchen");
      else expect(tabs, role).toContain("/m/menu");
    }
  });

  it("every staff role can reach its own notification settings", () => {
    for (const role of BRANCH_ROLES) {
      expect(hrefs(managerTabs(role).more.items), role).toContain("/m/notifications");
    }
  });

  it("staff can always get back to the public site from the sheet", () => {
    for (const role of [...BRANCH_ROLES, null]) {
      expect(hrefs(managerTabs(role).more.items)).toContain("/");
    }
  });

  it("an admin: dashboard, restaurants, payments, diagnostics — the site inside More", () => {
    expect(hrefs(ADMIN_TABS)).toEqual(["/a", "/a/restaurants", "/a/payments", "/a/diagnostics"]);
    expect(hrefs(tabsFor("admin").more.items)).toContain("/");
  });
});
