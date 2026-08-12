"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { NavIcon } from "./icon";
import { BrandMark } from "./brand-mark";
import { LogoutButton } from "./logout-button";
import { BranchSwitcher } from "./branch-switcher";
import { can } from "@/lib/capabilities";
import { MANAGER_NAV, isActive } from "@/lib/nav";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { Branch } from "@/lib/branch-types";

/**
 * Manager navigation, filtered twice over.
 *
 *  1. CAPABILITY — a link the branch role does not hold is not rendered.
 *     Showing seventeen links that all 403 is worse than showing five that
 *     work.
 *  2. LOCK STATE — when the tenant is locked, everything except /m/billing is
 *     visibly disabled rather than hidden. Hiding it would read as "the app
 *     broke"; a lock icon reads as "pay and this comes back", which is the
 *     message that actually gets an invoice settled.
 *
 * This is presentation only. `require_restaurant()` and `require_capability()`
 * still gate every page server-side (§14.4) — a rendered link is not
 * permission.
 */
export function ManagerSidebar({
  branches,
  activeBranch,
  brand,
  onSwitchBranch,
}: {
  branches: Branch[];
  activeBranch: Branch;
  brand: { name: string; logoUrl: string | null };
  onSwitchBranch?: (id: string) => void;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const locked = activeBranch.subscriptionState === "locked";
  const planIsPaid = activeBranch.planTier !== "starter";

  return (
    <div className="flex h-full flex-col">
      {/* Also the way back to the public site — every other link here goes
          deeper into /m. */}
      <div className="border-b border-border px-4 py-3.5">
        <BrandMark
          name={brand.name}
          logoUrl={brand.logoUrl}
          size="sm"
          title={`${t("nav.viewSite")} ${brand.name}`}
        />
      </div>

      <div className="px-3 pt-3 pb-3">
        <BranchSwitcher
          branches={branches}
          activeId={activeBranch.restaurantId}
          onSwitch={onSwitchBranch}
        />
      </div>

      <nav aria-label={t("nav.managerNav")} className="flex-1 overflow-y-auto px-3 pb-4">
        {MANAGER_NAV.map((group) => {
          const visible = group.items.filter(
            (item) => !item.capability || can(activeBranch.role, item.capability),
          );
          if (visible.length === 0) return null;

          return (
            <div key={group.labelKey} className="mb-5">
              <h2 className="px-3 pb-1.5 text-[10px] font-bold tracking-[0.12em] text-text-light uppercase">
                {group.labelKey ? t(group.labelKey) : group.label}
              </h2>
              <ul className="flex flex-col gap-0.5">
                {visible.map((item) => {
                  const active = isActive(item, pathname);
                  const blocked = locked && !item.allowLocked;
                  const gated = item.planGated && !planIsPaid;

                  const content = (
                    <>
                      <NavIcon name={item.icon} className="size-4 shrink-0" />
                      <span className="flex-1 truncate">
                        {item.labelKey ? t(item.labelKey) : item.label}
                      </span>
                      {(blocked || gated) && (
                        <Lock className="size-3 shrink-0 opacity-60" aria-hidden />
                      )}
                    </>
                  );

                  if (blocked) {
                    return (
                      <li key={item.href}>
                        <span
                          aria-disabled="true"
                          title={t("nav.lockedHint")}
                          className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-text-light opacity-55"
                        >
                          {content}
                        </span>
                      </li>
                    );
                  }

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        title={gated ? t("nav.gatedHint") : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-primary-light text-primary"
                            : "text-text-secondary hover:bg-surface-2 hover:text-text",
                          gated && "opacity-70",
                        )}
                      >
                        {content}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Was `<Link href="/logout">` — a GET route that changes state, which
          any `<img src="/logout">` on any page could fire. Now a POST behind a
          confirmation. */}
      <div className="border-t border-border p-3">
        <LogoutButton variant="full" />
      </div>
    </div>
  );
}
