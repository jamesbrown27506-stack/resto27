"use client";

import Link from "@/components/layout/public-link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { NavIcon, type IconName } from "./icon";
import { NavMenuSheet, type NavMenuItem } from "./nav-menu-sheet";
import { useCart } from "@/components/cart/cart-provider";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * The bottom tab bar — the phone-app navigation for every actor.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ONE COMPONENT, FOUR AREAS, DIFFERENT ITEMS.
 *
 *  Public visitors, customers, managers and admins each get their own set of
 *  tabs, all defined in lib/mobile-tabs. What is shared is the physics: fixed
 *  to the bottom where thumbs live, visible only below lg (desktop keeps its
 *  sidebars and header nav), each tab an icon over a short label — the
 *  grammar every mobile app has taught people for a decade.
 *
 *  THE LAST CELL IS A SHEET, not a link. Every destination that is not a tab
 *  opens there as a grid, with language and theme under it — the only other
 *  navigation on a phone, now that the header drawers are gone.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  SIX CELLS ON A 360 PX PHONE is 60 px each, and "Réservations" needs a
 *  little more than that. So cells share the width equally but never shrink
 *  below their own label: a long word borrows a few pixels from "Plus"
 *  instead of being cut to "Réserv…". Below 360 px, where even that cannot
 *  fit, the labels truncate as before rather than pushing the bar off-screen.
 *
 *  `labelKey` for the bilingual areas; plain `label` for the admin area,
 *  which is English by design (see ADMIN_NAV). Labels sit in their own
 *  elements — browser auto-translate rewrites bare text nodes in place, and
 *  this bar is on every page.
 *
 *  Layouts that mount this must give the page column matching bottom
 *  clearance (`pb-20 lg:pb-0`), or the bar covers the last rows of content.
 */

/** The live counts a tab can carry, supplied by whoever mounts the bar. */
export type TabCountKey = "orders" | "reservations" | "messages";

export interface TabItem {
  href: string;
  icon: IconName;
  labelKey?: TranslationKey;
  /** Pre-translated or deliberately untranslated text; used when no key. */
  label?: string;
  /**
   * Highlight on child routes too. "/" must NOT set this — every path starts
   * with "/", so the home tab would never go quiet.
   */
  matchPrefix?: boolean;
  /** A fixed count bubble. */
  badge?: number;
  /**
   * A LIVE count instead: "cart" reads the basket, the others the `counts`
   * the bar is handed (the manager's "needs you" numbers). A key rather than
   * a number so the tab lists in lib/mobile-tabs stay plain data.
   */
  badgeKey?: "cart" | TabCountKey;
  activePaths?: string[];
}

/**
 * The last cell, which opens a menu instead of navigating.
 *
 * Keys rather than strings for the heading, because some layouts that build
 * this are Server Components and cannot call useLocale — the same reason
 * ManagerPage takes a `titleKey`.
 */
export interface MoreTab {
  labelKey?: TranslationKey;
  label?: string;
  icon?: IconName;
  /** Heading of the sheet it opens. */
  titleKey?: TranslationKey;
  title?: string;
  descriptionKey?: TranslationKey;
  description?: string;
  items: NavMenuItem[];
  /**
   * What surrounds the grid. "account": language, theme and sign out under
   * it. "guest": sign in and create an account above it, language and theme
   * under it.
   */
  actions?: "account" | "guest";
}

/** Equal shares, but never narrower than the cell's own label (see above). */
const CELL = "min-w-max flex-1 max-[359px]:min-w-0";

export function MobileTabBar({
  items,
  more,
  counts,
  sheetHeader,
  ariaLabel,
}: {
  items: TabItem[];
  more?: MoreTab;
  counts?: Partial<Record<TabCountKey, number>>;
  /** Shown at the top of the sheet — the manager's branch switcher. */
  sheetHeader?: ReactNode;
  ariaLabel?: string;
}) {
  const pathname = usePathname();
  const { t } = useLocale();
  const { itemCount } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);

  // Six cells leave 60 px each on a 360 px phone, so they take a smaller label.
  const dense = items.length + (more ? 1 : 0) > 5;

  function isActive(item: TabItem): boolean {
    if (item.activePaths?.some(path => pathname === path || pathname.startsWith(path + "/"))) return true;
    if (item.matchPrefix) return pathname === item.href || pathname.startsWith(item.href + "/");
    return pathname === item.href;
  }

  function badgeFor(item: TabItem): number | undefined {
    if (item.badge !== undefined) return item.badge;
    if (item.badgeKey === "cart") return itemCount;
    return item.badgeKey ? counts?.[item.badgeKey] : undefined;
  }

  // "More" lights up when the page you are on lives inside it — otherwise the
  // whole account area reads as "nowhere" on the bar.
  const moreActive =
    more?.items.some((item) =>
      item.matchPrefix ? pathname === item.href || pathname.startsWith(`${item.href}/`) : pathname === item.href,
    ) ?? false;

  return (
    <>
      <nav
        aria-label={ariaLabel ?? t("nav.menu")}
        className="neu-bar fixed inset-x-0 bottom-0 z-40 lg:hidden"
        // The gesture bar on phones that have one. Padding, not margin, so the
        // neumorphic surface still reaches the physical bottom edge.
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <ul className="flex">
          {items.map((item) => {
            const active = isActive(item);
            return (
              <li key={item.href} className={CELL}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  /*
                    The neumorphic press lives on the anchor because :active
                    only holds while the finger is down — it is the instant
                    half of the feedback, and `pending` inside takes over the
                    moment the finger lifts. Pressed, the whole cell goes
                    concave (globals.css), the same physics as .soft-press.
                  */
                  className="neu-tab block"
                >
                  <TabBody
                    item={item}
                    active={active}
                    dense={dense}
                    badge={badgeFor(item)}
                    label={item.labelKey ? t(item.labelKey) : (item.label ?? "")}
                  />
                </Link>
              </li>
            );
          })}

          {more && (
            <li className={CELL}>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
                className={cn(
                  tabClasses(moreActive || menuOpen, dense),
                  "neu-tab w-full",
                )}
              >
                <Lit active={moreActive || menuOpen} />
                <span className={cn("relative rounded-full py-1.5", dense ? "px-3" : "px-3.5")}>
                  <NavIcon name={more.icon ?? "Ellipsis"} className="size-5" />
                </span>
                <span className="max-w-full truncate">
                  {more.labelKey ? t(more.labelKey) : more.label}
                </span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      {more && (
        <NavMenuSheet
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          title={more.titleKey ? t(more.titleKey) : (more.title ?? "")}
          description={more.descriptionKey ? t(more.descriptionKey) : more.description}
          items={more.items}
          actions={more.actions}
          header={sheetHeader}
        />
      )}
    </>
  );
}

/**
 * The inside of a tab, and the reason a tab has an inside at all.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS IS A SEPARATE COMPONENT.
 *
 *  Every visual cue on this bar — the lit pill, the primary colour — was
 *  derived from `pathname`, and `pathname` only changes once the destination
 *  has rendered. On a fast connection that is imperceptible. On the ones this
 *  platform runs on it means tapping "Commandes" and watching the bar sit
 *  there, unchanged, for a second or more.
 *
 *  A tab that does not react has not been pressed, as far as anyone can tell.
 *  So people press it again. And again — which is the report that produced
 *  this change.
 *
 *  `useLinkStatus` reports the navigation this specific link started, and it
 *  can only be called beneath the <Link> it belongs to. Hence a child
 *  component: the styling moved in here with it, because the state it depends
 *  on is not knowable on the outside.
 *
 *  Three states now, not two:
 *    idle      — quiet
 *    pending   — pressed, and the destination is being fetched. Lights up
 *                immediately and pulses, so the wait reads as progress
 *                rather than as nothing having happened.
 *    active    — you are here. Steady.
 * ─────────────────────────────────────────────────────────────────────────
 */
function TabBody({
  item,
  active,
  dense,
  badge,
  label,
}: {
  item: TabItem;
  active: boolean;
  dense: boolean;
  badge: number | undefined;
  label: string;
}) {
  const { pending } = useLinkStatus();

  return (
    <span className={cn(tabClasses(active || pending, dense), "w-full")}>
      <Lit active={active} pending={pending} />
      {/* Padding and radius live here at rest, so the raised key (.neu-key,
          mobile only) changes paint only — no layout jump on activation. */}
      <span
        className={cn(
          "relative rounded-full py-1.5 transition-transform duration-150",
          dense ? "px-3" : "px-3.5",
          pending && "scale-110",
          (active || pending) && "neu-key",
        )}
      >
        <NavIcon name={item.icon} className="size-5" />
        {badge !== undefined && badge > 0 && <Bubble count={badge} />}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </span>
  );
}

function tabClasses(active: boolean, dense: boolean): string {
  return cn(
    "relative flex min-h-16 flex-col items-center justify-center gap-1 pt-2 pb-1.5",
    // 10 px is the iPhone tab-bar size; at 10.5 "Commandes" and
    // "Réservations" all but touched in a six-cell bar on 360 px.
    dense ? "px-0.5 text-[10px] tracking-[-0.015em]" : "px-1 text-[11px]",
    "font-medium transition-colors",
    active ? "text-primary" : "text-text-light hover:text-text-secondary",
  );
}

/**
 * The lit indicator — a pill above the icon, so state reads at a glance
 * without recolouring the whole tab.
 *
 * `pending` paints the same pill and pulses it. Same shape, same place, so
 * arriving at the destination is a pulse settling rather than one indicator
 * being swapped for another.
 */
function Lit({ active, pending = false }: { active: boolean; pending?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-0 h-0.5 w-8 rounded-full transition-colors",
        active || pending ? "bg-primary" : "bg-transparent",
        pending && !active && "animate-tab-pending",
      )}
    />
  );
}

function Bubble({ count }: { count: number }) {
  return (
    <span className="tnum absolute -top-1.5 -right-2.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-fg">
      {count > 99 ? "99+" : count}
    </span>
  );
}
