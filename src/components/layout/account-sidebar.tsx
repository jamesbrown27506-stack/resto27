"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "./icon";
import { LogoutButton } from "./logout-button";
import { Avatar } from "@/components/ui/avatar";
import { CUSTOMER_NAV, isActive } from "@/lib/nav";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/session";

/**
 * Customer account navigation.
 *
 * On mobile this becomes a horizontal scrolling strip rather than a drawer:
 * the customer area is shallow (9 destinations) and a swipeable row keeps them
 * one tap away, where a hamburger would make every one of them two.
 */
export function AccountSidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <>
      {/* Mobile: scrolling strip */}
      <nav
        aria-label={t("common.accountNav")}
        className="no-scrollbar -mx-6 flex gap-2 overflow-x-auto px-6 pb-1 lg:hidden"
      >
        {CUSTOMER_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item, pathname) ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              isActive(item, pathname)
                ? "border-primary bg-primary text-primary-fg"
                : "border-border bg-surface text-text-secondary",
            )}
          >
            <NavIcon name={item.icon} className="size-3.5" />
            <span>{item.labelKey ? t(item.labelKey) : item.label}</span>
          </Link>
        ))}
      </nav>

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
            {CUSTOMER_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item, pathname) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive(item, pathname)
                    ? "bg-primary-light text-primary"
                    : "text-text-secondary hover:bg-surface-2 hover:text-text",
                )}
              >
                <NavIcon name={item.icon} className="size-4 shrink-0" />
                <span>{item.labelKey ? t(item.labelKey) : item.label}</span>
              </Link>
            ))}

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
    </>
  );
}
