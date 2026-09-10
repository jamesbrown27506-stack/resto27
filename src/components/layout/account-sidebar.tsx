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
 * Customer account navigation — the desktop sidebar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ON A PHONE THERE IS NO ACCOUNT MENU ON THE PAGE, AND THAT IS THE POINT.
 *
 *  The account dashboard used to open with THREE navigations stacked above
 *  any content: the bottom bar, a "section" button opening the account menu,
 *  and two grids of the same links ("Mes activités", "Mon compte"). The
 *  restaurant and admin dashboards open on their figures; the customer's
 *  opened on a table of contents.
 *
 *  Below lg the bottom bar's "Compte" tab is the account menu (lib/mobile-
 *  tabs), exactly as "More" is in the other two areas — so every page starts
 *  with its own content.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function AccountSidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
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

          {/* The same confirmed POST as everywhere else — never a GET link,
              which any <img src="/logout"> on any page could fire. */}
          <div className="mt-2">
            <LogoutButton variant="full" />
          </div>
        </nav>
      </div>
    </aside>
  );
}
