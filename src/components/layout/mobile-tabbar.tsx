"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon, type IconName } from "./icon";
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
}

export function MobileTabBar({ items, ariaLabel }: { items: TabItem[]; ariaLabel?: string }) {
  const pathname = usePathname();
  const { t } = useLocale();

  function isActive(item: TabItem): boolean {
    if (item.matchPrefix) return pathname.startsWith(item.href);
    return pathname === item.href;
  }

  return (
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
                className={cn(
                  "relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 pt-2 pb-1.5",
                  "text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-text-light hover:text-text-secondary",
                )}
              >
                {/* The lit indicator — a pill above the active icon, so state
                    reads at a glance without recolouring the whole tab. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-0 h-0.5 w-8 rounded-full transition-colors",
                    active ? "bg-primary" : "bg-transparent",
                  )}
                />

                <span className="relative">
                  <NavIcon name={item.icon} className="size-5" />
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="tnum absolute -top-1.5 -right-2.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-fg">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </span>

                <span className="max-w-full truncate">
                  {item.labelKey ? t(item.labelKey) : item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
