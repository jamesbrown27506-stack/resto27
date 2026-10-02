"use client";

import Link from "@/components/layout/public-link";
import { Fragment, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { NavIcon, type IconName } from "./icon";
import { LogoutButton } from "./logout-button";
import { LocaleToggle } from "./locale-toggle";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Sheet } from "@/components/ui/sheet";
import { buttonClasses } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/use-locale";
import { useNativeApp } from "@/lib/capacitor/platform";
import { DEVELOPER, developerWhatsAppHref } from "@/lib/developer";
import { SocialIcon } from "@/components/icons/social-icon";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * The "everything else" menu — a bottom sheet of destinations, two per row.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS REPLACED THE SCROLLING STRIP.
 *
 *  The customer's nine account destinations used to sit in a horizontally
 *  scrolling row of pills above the page. Every screen therefore opened with
 *  a strip you had to SWIPE to read, half the destinations were off the right
 *  edge with nothing saying so, and the one you wanted was never the one on
 *  screen. A row that scrolls sideways is the worst of both worlds: it costs
 *  the vertical space of a menu and hides its contents like a drawer.
 *
 *  A sheet shows all of them at once, in a grid, with the current one lit.
 *  One tap to open, one tap to arrive — the same two taps the strip needed
 *  once you had finished swiping.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * On a phone this is the ONLY navigation besides the tab bar — the header
 * drawers are gone — so it also carries language, theme and, for a visitor,
 * the way to sign in.
 *
 * A native <dialog> under the hood (see Sheet), so it renders in the top
 * layer and no frosted header or transformed ancestor can trap it.
 */

export interface NavMenuItem {
  href: string;
  icon: IconName;
  /** `labelKey` for the bilingual areas, plain `label` for the admin area. */
  labelKey?: TranslationKey;
  label?: string;
  /** Highlight on child routes too. */
  matchPrefix?: boolean;
  badge?: number;
  /** Heading of the group this item opens — a key, or plain text for the admin area. */
  groupKey?: TranslationKey;
  group?: string;
}

export function NavMenuSheet({
  open,
  onClose,
  title,
  description,
  items,
  actions,
  header,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  items: NavMenuItem[];
  /** "account": language, theme, sign out. "guest": sign in / create an account, language, theme. */
  actions?: "account" | "guest";
  /** Above everything else — the manager's branch switcher. */
  header?: ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useLocale();
  const native = useNativeApp();

  function isActive(item: NavMenuItem): boolean {
    if (item.matchPrefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
    return pathname === item.href;
  }

  const groupOf = (item: NavMenuItem | undefined) => (item?.groupKey ? t(item.groupKey) : item?.group);

  // Signing in from the sheet brings them back to the page they were on,
  // not to a dashboard they did not ask for.
  const loginHref = pathname && pathname !== "/" ? `/login?next=${encodeURIComponent(pathname)}` : "/login";

  return (
    <Sheet open={open} onClose={onClose} title={title} description={description} side="bottom">
      {/* Any link tap closes the sheet — including a link to the page you are
          already on, which no pathname change can ever tell us about. */}
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) onClose();
        }}
      >
        {header && <div className="mb-4">{header}</div>}

        {actions === "guest" && (
          <div className="mb-5 grid grid-cols-2 gap-2">
            <Link href={loginHref} className={buttonClasses({ variant: "outline", fullWidth: true })}>
              {t("nav.login")}
            </Link>
            <Link href="/register" className={buttonClasses({ fullWidth: true })}>
              {t("nav.register")}
            </Link>
          </div>
        )}

        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((item, index) => {
            const active = isActive(item);
            const group = groupOf(item);
            return (
              <Fragment key={item.href}>
                {group && groupOf(items[index - 1]) !== group && (
                  <li className="col-span-full pt-3 text-xs font-semibold text-text-secondary">{group}</li>
                )}
                <li>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      // `.soft-press` + the `aria-current` below: raised tile,
                      // and the current destination latches concave — the same
                      // "you are here" physics as the tab bar's active key.
                      "soft-press flex h-full items-center gap-3 rounded-lg border p-3.5 transition-colors",
                      active
                        ? "border-primary bg-primary-light/50 text-primary"
                        : "border-border bg-surface text-text-secondary hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    <span
                      className={cn(
                        "relative grid size-9 shrink-0 place-items-center rounded-full",
                        active ? "bg-primary text-primary-fg" : "bg-surface-2 text-text-light",
                      )}
                    >
                      <NavIcon name={item.icon} className="size-4.5" />
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="tnum absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] leading-4 font-bold text-accent-fg">
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 text-sm leading-tight font-medium">
                      {item.labelKey ? t(item.labelKey) : item.label}
                    </span>
                  </Link>
                </li>
              </Fragment>
            );
          })}
        </ul>

        {actions && (
          <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-text-secondary">{t("nav.language")}</span>
              <LocaleToggle />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-text-secondary">{t("nav.theme")}</span>
              <ThemeToggle />
            </div>
            {actions === "account" && <LogoutButton variant="full" />}
          </div>
        )}

        {/*
          Inside the app there is no footer (site-footer), so the developer
          credit — and its WhatsApp contact — lives here instead.
        */}
        {native && actions && (
          <a
            href={developerWhatsAppHref(t("nav.credit.message"))}
            target="_blank"
            rel="noreferrer"
            className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-full bg-accent/10 px-4 py-2.5 text-sm ring-1 ring-accent/30"
          >
            <SocialIcon platform="whatsapp" className="size-4 text-accent" />
            <span>
              {t("footer.developedBy")} <strong className="font-semibold">{DEVELOPER.name}</strong>
            </span>
            <span aria-hidden className="text-text-light">·</span>
            <span className="font-medium text-accent">{t("footer.contactWhatsapp")}</span>
          </a>
        )}
      </div>
    </Sheet>
  );
}
