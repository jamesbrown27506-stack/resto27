"use client";

import Link from "@/components/layout/public-link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { LogoutButton } from "./logout-button";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LocaleToggle } from "./locale-toggle";
import { useCart } from "@/components/cart/cart-provider";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { NotificationProvider } from "@/components/notifications/notification-provider";
import { NotificationBell } from "@/components/notifications/notification-bell";

const NAV: { href: string; label: TranslationKey }[] = [
  { href: "/restaurants", label: "nav.restaurants" },
  { href: "/pricing", label: "nav.pricing" },
  { href: "/contact", label: "nav.contact" },
];

/** A signed-in customer's links: their orders and messages instead of the plans. */
const CUSTOMER_LINKS: { href: string; label: TranslationKey }[] = [
  { href: "/restaurants", label: "nav.restaurants" },
  { href: "/orders", label: "cor.title" },
  { href: "/messages", label: "cmsg.title" },
  { href: "/contact", label: "nav.contact" },
];

/**
 * The shared marketing header.
 *
 * The PHP homepage did NOT use the shared header — it carried its own <head>
 * and its own copy of the nav, which meant every global change had to be made
 * twice and caused branding, SEO tags and the mobile drawer to drift (§10).
 * Every public page now renders this one component.
 *
 * The frosted fill sits on a pseudo-element rather than on the header itself,
 * preserving the fix documented in the PHP source: an element whose
 * `backdrop-filter` is not `none` becomes the containing block for its fixed
 * descendants. The drawer is additionally a native <dialog> in the top layer,
 * so it is immune to that class of bug regardless.
 */
export interface HeaderUser {
  name: string;
  email: string;
  avatarUrl: string | null;
  /**
   * WHICH SIDE OF THE PRODUCT THIS PERSON WORKS IN — not their raw role.
   *
   * An admin who is impersonating a tenant is "manager" here, because that
   * is the area every link they follow should lead back into. The public
   * layout uses it to decide the last bottom tab, so an administrator on the
   * homepage gets a way back into administration rather than a contact form
   * addressed to themselves.
   */
  area: "admin" | "manager" | "customer";
  /** Where this person's own dashboard lives. Always agrees with `area`. */
  homeHref: string;
}

export function SiteHeader({
  user,
  brand,
}: {
  user?: HeaderUser | null;
  /** Name and logo from /a/settings, resolved by the layout above. */
  brand: { name: string; logoUrl: string | null };
}) {
  const pathname = usePathname();
  const { itemCount: cartCount } = useCart();
  const { t } = useLocale();
  const [scrolled, setScrolled] = useState(false);

  // "Tarifs" is how a restaurant decides to join, so every visitor sees it,
  // on desktop and in the phone menu. A signed-in customer is not a
  // restaurant: they get their orders and messages instead.
  const nav = user?.area === "customer" ? CUSTOMER_LINKS : NAV;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);



  return (
    <>
      <header
        className={cn(
          // `.neu-header` re-skins the bar as the soft material on phones
          // only (globals.css); desktop keeps the frosted glass below.
          "neu-header fixed inset-x-0 top-0 z-50 h-20 border-b transition-shadow lg:h-16",
          scrolled ? "border-border shadow-sm" : "border-border/60",
        )}
      >
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 -z-10 backdrop-blur-xl transition-colors",
            scrolled ? "bg-bg/97" : "bg-bg/88",
          )}
        />

        <div className="container-wide flex h-full items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <BrandMark name={brand.name} logoUrl={brand.logoUrl} />

            <nav aria-label={t("nav.menu")} className="hidden items-center gap-1 lg:flex">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                    pathname.startsWith(item.href)
                      ? "bg-primary-light text-primary"
                      : "text-text-secondary hover:bg-primary-light hover:text-primary",
                  )}
                >
                  {t(item.label)}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <LocaleToggle className="hidden sm:inline-flex" />
            <ThemeToggle className="hidden sm:inline-flex" />

            <Link
              href="/cart"
              aria-label={cartCount > 0 ? `${t("nav.cart")} — ${cartCount}` : t("nav.cartEmpty")}
              /* `.soft-press` raises the icon buttons on phones, same material
                  as the tab bar's keys and every Button in the app. */
              className="soft-press relative grid size-9 shrink-0 place-items-center rounded-full text-text-secondary transition-colors hover:bg-surface-2 hover:text-text"
            >
              <ShoppingBag className="size-4.5" aria-hidden />
              {cartCount > 0 && (
                <span className="tnum absolute -top-0.5 -right-0.5 grid min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-fg">
                  {cartCount}
                </span>
              )}
            </Link>

            {user ? (
              <>
                <NotificationProvider>
                  <NotificationBell />
                </NotificationProvider>

                <Link
                  href={user.homeHref}
                  className="soft-press inline-flex items-center gap-2 rounded-full py-1 pr-3 pl-1 transition-colors hover:bg-surface-2 sm:pr-3"
                >
                  <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                  <span className="hidden max-w-28 truncate text-sm font-medium sm:block">
                    {user.name}
                  </span>
                </Link>
                {/*
                  The same confirmed POST as every dashboard. These two buttons
                  were bare forms, so signing out from the public site was the
                  one place it happened without being asked.
                */}
                <div className="hidden sm:block">
                  <LogoutButton />
                </div>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className={cn(
                    buttonClasses({ variant: "ghost", size: "sm" }),
                    "hidden lg:inline-flex",
                  )}
                >
                  {t("nav.login")}
                </Link>
                <Link
                  href="/register"
                  className={cn(buttonClasses({ size: "sm" }), "hidden sm:inline-flex")}
                >
                  {t("nav.register")}
                </Link>
              </>
            )}

            {/* Mobile navigation lives in the role-specific bottom bar. */}
          </div>
        </div>
      </header>

    </>
  );
}
