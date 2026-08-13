import { CUSTOMER_NAV } from "@/lib/nav";
import type { IconName } from "./icon";
import type { MoreTab } from "./mobile-tabbar";

/**
 * The "More" tab's contents, built from the same nav lists the sidebars read.
 *
 * Plain data in its own module rather than a const inside a layout file:
 * route files should export only what the router understands, and both the
 * customer layout and the public layout need this one.
 */

/**
 * Every customer account destination — the nine screens that used to live in
 * a sideways-scrolling strip above the page, now a grid in a bottom sheet.
 * Built from CUSTOMER_NAV so the sheet and the desktop sidebar can never
 * disagree about what exists.
 */
export const CUSTOMER_MORE: MoreTab = {
  labelKey: "nav.more",
  icon: "Ellipsis",
  titleKey: "nav.moreTitle",
  descriptionKey: "nav.moreBody",
  withAccountActions: true,
  items: CUSTOMER_NAV.map((item) => ({
    href: item.href,
    icon: item.icon as IconName,
    labelKey: item.labelKey,
    label: item.label,
    matchPrefix: item.matchPrefix,
  })),
};
