"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu, ShoppingBag } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClasses } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LocaleToggle } from "./locale-toggle";
import { useCart } from "@/components/cart/cart-provider";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

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
  /** Where this person's own dashboard lives. */
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
          "fixed inset-x-0 top-0 z-50 h-16 border-b transition-shadow",
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
              {NAV.map((item) => (
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
                <Link
                  href={user.homeHref}
                  className="hidden items-center gap-2 rounded-full py-1 pr-3 pl-1 transition-colors hover:bg-surface-2 sm:inline-flex"
                >
                  <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                  <span className="max-w-28 truncate text-sm font-medium">{user.name}</span>
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
        <nav aria-label={t("nav.menu")} className="flex flex-col gap-1">
          {NAV.map((item) => (
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
              <Link href={user.homeHref} className={buttonClasses({ fullWidth: true })}>
                {user.name}
              </Link>
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
      </Sheet>
    </>
  );
}
