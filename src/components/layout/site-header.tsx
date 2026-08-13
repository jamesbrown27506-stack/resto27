"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu, ShoppingBag } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { NavIcon } from "./icon";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClasses } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LocaleToggle } from "./locale-toggle";
import { useCart } from "@/components/cart/cart-provider";
import { useLocale } from "@/lib/i18n/use-locale";
import { CUSTOMER_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { NotificationProvider } from "@/components/notifications/notification-provider";
import { NotificationBell } from "@/components/notifications/notification-bell";

const NAV: { href: string; label: TranslationKey }[] = [
  { href: "/restaurants", label: "nav.restaurants" },
  { href: "/pricing", label: "nav.pricing" },
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
  const [menuOpen, setMenuOpen] = useState(false);

  // A signed-in client should not be offered "Pricing" — they already pay. The
  // pricing page stays, but only as a link anonymous visitors see.
  const nav = user ? NAV.filter((item) => item.href !== "/pricing") : NAV;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the drawer on navigation — otherwise tapping a link leaves it open
  // over the page you just moved to. Adjusted during render rather than in an
  // effect, so the still-open drawer never paints over the new page.
  const [openedOn, setOpenedOn] = useState(pathname);
  if (menuOpen && openedOn !== pathname) {
    setMenuOpen(false);
    setOpenedOn(pathname);
  }

  function openMenu() {
    setOpenedOn(pathname);
    setMenuOpen(true);
  }

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 h-20 border-b transition-shadow lg:h-16",
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
              className="relative grid size-9 shrink-0 place-items-center rounded-full text-text-secondary transition-colors hover:bg-surface-2 hover:text-text"
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
                  className="inline-flex items-center gap-2 rounded-full py-1 pr-3 pl-1 transition-colors hover:bg-surface-2 sm:pr-3"
                >
                  <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                  <span className="hidden max-w-28 truncate text-sm font-medium sm:block">
                    {user.name}
                  </span>
                </Link>
                {/*
                  A form POST, not a link. Sign-out is a state change, and a
                  GET route can be fired by any <img src="/logout"> on a page
                  the user happens to visit.
                */}
                <form action="/logout" method="post" className="hidden sm:block">
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("nav.logout")}
                    title={t("nav.logout")}
                  >
                    <LogOut className="size-4" aria-hidden />
                  </Button>
                </form>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className={cn(
                    buttonClasses({ variant: "ghost", size: "sm" }),
                    "hidden sm:inline-flex",
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

            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              aria-label={t("nav.openMenu")}
              aria-expanded={menuOpen}
              onClick={openMenu}
            >
              <Menu className="size-5" aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={t("nav.menu")} side="right">
        {/* Any link tap closes the drawer — including a link to the page you
            are already on, which no pathname change can ever tell us about. */}
        <div
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setMenuOpen(false);
          }}
        >
          <nav aria-label={t("nav.menu")} className="flex flex-col gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-4 py-3 text-base font-medium transition-colors",
                  pathname.startsWith(item.href)
                    ? "bg-primary-light text-primary"
                    : "text-text hover:bg-surface-2",
                )}
              >
                {t(item.label)}
              </Link>
            ))}
          </nav>

          <div className="mt-6 flex flex-col gap-3 border-t border-border pt-6">
            {user ? (
              <>
                {/*
                  WHO YOU ARE, then WHERE YOU CAN GO.

                  The drawer used to offer a signed-in customer exactly two
                  things: a button with their own name on it, and sign out.
                  Every account screen they actually wanted — orders, messages,
                  addresses, loyalty — was reachable only from a different
                  page. The identity card and the destination grid below are
                  the same ones the account menu uses, so the drawer is now a
                  real way around the product rather than a dead end.
                */}
                <Link
                  href={user.homeHref}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3 transition-colors hover:bg-surface"
                >
                  <Avatar name={user.name} src={user.avatarUrl} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{user.name}</span>
                    <span className="block truncate text-xs text-text-light">{user.email}</span>
                  </span>
                </Link>

                {user.area === "customer" ? (
                  <ul className="grid grid-cols-2 gap-2">
                    {CUSTOMER_NAV.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            "flex h-full items-center gap-2.5 rounded-lg border p-3 text-sm font-medium transition-colors",
                            pathname === item.href
                              ? "border-primary bg-primary-light/50 text-primary"
                              : "border-border text-text-secondary hover:bg-surface-2 hover:text-text",
                          )}
                        >
                          <NavIcon name={item.icon} className="size-4 shrink-0" />
                          <span className="min-w-0 truncate">
                            {item.labelKey ? t(item.labelKey) : item.label}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Link href={user.homeHref} className={buttonClasses({ fullWidth: true })}>
                    {t("nav.myArea")}
                  </Link>
                )}

                <form action="/logout" method="post">
                  <Button type="submit" variant="outline" fullWidth>
                    <LogOut className="size-4" aria-hidden />
                    {t("nav.logout")}
                  </Button>
                </form>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className={buttonClasses({ variant: "outline", fullWidth: true })}
                >
                  {t("nav.login")}
                </Link>
                <Link href="/register" className={buttonClasses({ fullWidth: true })}>
                  {t("nav.register")}
                </Link>
                <Link
                  href="/register/restaurant"
                  className={buttonClasses({ variant: "ghost", fullWidth: true })}
                >
                  {t("nav.registerRestaurant")}
                </Link>
              </>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-4 border-t border-border pt-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">{t("nav.language")}</span>
              <LocaleToggle />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">{t("nav.theme")}</span>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </Sheet>
    </>
  );
}
