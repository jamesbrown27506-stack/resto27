"use client";

import Link from "@/components/layout/public-link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NavIcon, type IconName } from "./icon";
import { NavMenuSheet, type NavMenuItem } from "./nav-menu-sheet";
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
 *  four-or-five tabs, decided by the layout that mounts this. What is shared
 *  is the physics: fixed to the bottom where thumbs live, visible only below
 *  lg (desktop keeps its sidebars and header nav), each tab an icon over a
 *  short label — the grammar every mobile app has taught people for a decade.
 *
 *  By convention the FIRST tab of the signed-in areas points back at the
 *  public site: whatever corner of the platform someone works in, the way
 *  home is always in the same place.
 *
 *  THE LAST TAB CAN BE "MORE" instead of a link. An area with more
 *  destinations than tabs (the customer's nine account screens) hands them to
 *  `more`, and they open as a grid in a bottom sheet rather than being hidden
 *  behind a sideways-scrolling strip at the top of every page.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  `labelKey` for the bilingual areas; plain `label` for the admin area,
 *  which is English by design (see ADMIN_NAV). Labels sit in their own
 *  elements — browser auto-translate rewrites bare text nodes in place, and
 *  this bar is on every page.
 *
 *  Layouts that mount this must give the page column matching bottom
 *  clearance (`pb-20 lg:pb-0`), or the bar covers the last rows of content.
 */

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
  /** Right-aligned count bubble — the cart, mostly. */
  badge?: number;
  activePaths?: string[];
}

/**
 * The last tab, when it opens a menu instead of navigating.
 *
 * Keys rather than strings for the heading, because the layouts that build
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
  /** Sign out, theme and language under the grid — the account areas. */
  withAccountActions?: boolean;
}

export function MobileTabBar({
  items,
  more,
  ariaLabel,
}: {
  items: TabItem[];
  more?: MoreTab;
  ariaLabel?: string;
}) {
  const pathname = usePathname();
  const { t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);

  function isActive(item: TabItem): boolean {
    if (item.activePaths?.some(path => pathname === path || pathname.startsWith(path + "/"))) return true;
    if (item.matchPrefix) return pathname === item.href || pathname.startsWith(item.href + "/");
    return pathname === item.href;
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
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md lg:hidden"
        // The gesture bar on phones that have one. Padding, not margin, so the
        // frosted surface still reaches the physical bottom edge.
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <ul className="grid auto-cols-fr grid-flow-col">
          {items.map((item) => {
            const active = isActive(item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  /*
                    The press wash lives on the anchor because :active only
                    holds while the finger is down — it is the instant half of
                    the feedback, and `pending` inside takes over the moment
                    the finger lifts.
                  */
                  className="block transition-colors duration-100 active:bg-primary-light"
                >
                  <TabBody
                    item={item}
                    active={active}
                    label={item.labelKey ? t(item.labelKey) : (item.label ?? "")}
                  />
                </Link>
              </li>
            );
          })}

          {more && (
            <li>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
                className={cn(
                  tabClasses(moreActive || menuOpen),
                  "w-full transition-colors duration-100 active:bg-primary-light",
                )}
              >
                <Lit active={moreActive || menuOpen} />
                <span className="relative">
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
          withAccountActions={more.withAccountActions}
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
  label,
}: {
  item: TabItem;
  active: boolean;
  label: string;
}) {
  const { pending } = useLinkStatus();

  return (
    <span className={cn(tabClasses(active || pending), "w-full")}>
      <Lit active={active} pending={pending} />
      <span className={cn("relative transition-transform duration-150", pending && "scale-110")}>
        <NavIcon name={item.icon} className="size-5" />
        {item.badge !== undefined && item.badge > 0 && <Bubble count={item.badge} />}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </span>
  );
}

function tabClasses(active: boolean): string {
  return cn(
    "relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 pt-2 pb-1.5",
    "text-[11px] font-medium transition-colors",
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
