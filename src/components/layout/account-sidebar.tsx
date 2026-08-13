"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { NavIcon } from "./icon";
import { LogoutButton } from "./logout-button";
import { NavMenuSheet, type NavMenuItem } from "./nav-menu-sheet";
import { Avatar } from "@/components/ui/avatar";
import { CUSTOMER_NAV, isActive } from "@/lib/nav";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { IconName } from "./icon";
import type { SessionUser } from "@/lib/session";

/**
 * Customer account navigation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE MOBILE HALF WAS A SIDEWAYS-SCROLLING STRIP, AND THAT WAS THE PROBLEM.
 *
 *  Nine pills in a horizontally scrolling row meant every account screen
 *  opened with a menu you had to SWIPE to read: over half the destinations
 *  were off the right edge, nothing on screen said they existed, and the row
 *  still cost the vertical space a real menu would have. The old comment
 *  argued it kept everything "one tap away" — it did not, because you cannot
 *  tap what you cannot see.
 *
 *  It is now a single button naming the section you are in, which opens the
 *  same bottom sheet the "More" tab opens: all nine at once, in a grid, with
 *  the current one lit. Two taps, and both of them aimed at something visible.
 * ─────────────────────────────────────────────────────────────────────────
 */

const MENU_ITEMS: NavMenuItem[] = CUSTOMER_NAV.map((item) => ({
  href: item.href,
  icon: item.icon as IconName,
  labelKey: item.labelKey,
  label: item.label,
  matchPrefix: item.matchPrefix,
}));

export function AccountSidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const { t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);

  const current = CUSTOMER_NAV.find((item) => isActive(item, pathname));
  const currentLabel = current
    ? current.labelKey
      ? t(current.labelKey)
      : (current.label ?? "")
    : t("nav.moreTitle");

  return (
    <>
      {/* Mobile: the section switcher */}
      <div className="lg:hidden">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-fg">
            <NavIcon name={(current?.icon ?? "LayoutDashboard") as IconName} className="size-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold tracking-[0.08em] text-text-light uppercase">
              {t("common.accountNav")}
            </span>
            <span className="block truncate text-sm font-semibold">{currentLabel}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-text-light" aria-hidden />
        </button>
      </div>

      {/* Desktop: sidebar */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-24">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
            <Avatar name={user.name} src={user.avatarUrl} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-text-light">{user.email}</p>
            </div>
          </div>

          <nav aria-label={t("common.accountNav")} className="mt-4 flex flex-col gap-0.5">
            {CUSTOMER_NAV.map((item) => {
              const active = isActive(item, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary-light text-primary"
                      : "text-text-secondary hover:bg-surface-2 hover:text-text",
                  )}
                >
                  <NavIcon name={item.icon} className="size-4 shrink-0" />
                  <span className="truncate">{item.labelKey ? t(item.labelKey) : item.label}</span>
                </Link>
              );
            })}

            {/*
              Was `<Link href="/logout">` — a GET route that changes state,
              which any `<img src="/logout">` on any page could fire, and which
              a link prefetcher can trip on its own. The manager sidebar was
              fixed months ago and this one was missed. Now the same POST behind
              the same confirmation.
            */}
            <div className="mt-2">
              <LogoutButton variant="full" />
            </div>
          </nav>
        </div>
      </aside>

      <NavMenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t("nav.moreTitle")}
        description={t("nav.moreBody")}
        items={MENU_ITEMS}
        withAccountActions
      />
    </>
  );
}
