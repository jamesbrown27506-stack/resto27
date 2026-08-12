"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { Menu, ShieldCheck } from "lucide-react";
import { NavIcon } from "./icon";
import { BrandMark } from "./brand-mark";
import { ImpersonationBanner } from "./impersonation-banner";
import { LogoutButton } from "./logout-button";
import { LocaleToggle } from "./locale-toggle";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ADMIN_NAV, isActive } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * The signed-in administrator.
 *
 * Passed down from the layout, which already loaded the profile to authorise
 * the request — so showing who you are costs nothing extra.
 */
export interface AdminIdentity {
  name: string;
  email: string;
  avatarUrl: string | null;
}

/** The platform's own name and logo, from /a/settings. */
export interface BrandIdentity {
  name: string;
  logoUrl: string | null;
}

const AdminUserContext = createContext<AdminIdentity | null>(null);

/** Lets any admin page greet the person by name without prop-drilling. */
export function useAdminUser(): AdminIdentity {
  const user = useContext(AdminUserContext);
  if (!user) throw new Error("useAdminUser must be used inside <AdminShell>");
  return user;
}

function AdminNav({ brand }: { brand: BrandIdentity }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/*
        THE WAY BACK TO THE PUBLIC SITE.

        Until this existed the admin area was a dead end: every link in the
        sidebar goes to another /a page, so once you were in you could only
        leave by editing the URL or signing out. The platform's own name is
        where anyone would click to go home, so that is what it does.
      */}
      <div className="border-b border-border px-4 py-3.5">
        <BrandMark
          name={brand.name}
          logoUrl={brand.logoUrl}
          size="sm"
          title={`Voir ${brand.name}`}
        />
      </div>

      {/* Administration sits BELOW the brand: it labels this section of the
          product, it is not the product's name. */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 font-display text-sm font-bold tracking-wide text-accent uppercase">
        <ShieldCheck className="size-4" aria-hidden />
        <span>Administration</span>
      </div>

      <nav aria-label="Admin navigation" className="flex-1 overflow-y-auto px-3 pb-4">
        {ADMIN_NAV.map((group) => (
          <div key={group.label} className="mb-5">
            <h2 className="px-3 pb-1.5 text-[10px] font-bold tracking-[0.12em] text-text-light uppercase">
              {group.label}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(item, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-accent/15 text-accent-hover"
                          : "text-text-secondary hover:bg-surface-2 hover:text-text",
                      )}
                    >
                      <NavIcon name={item.icon} className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

/**
 * Admin chrome.
 *
 * The impersonation banner slot sits ABOVE everything, including the sticky
 * top bar, so it cannot be scrolled out of view (§8).
 */
export function AdminShell({
  user,
  brand,
  impersonating,
  children,
}: {
  user: AdminIdentity;
  brand: BrandIdentity;
  impersonating?: { adminName: string; targetName: string } | null;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <AdminUserContext.Provider value={user}>
      <div className="flex min-h-dvh bg-bg">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-surface lg:block">
          <AdminNav brand={brand} />
        </aside>

        <Sheet
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="Navigation"
          side="left"
          className="p-0"
        >
          <AdminNav brand={brand} />
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          {impersonating && (
            <ImpersonationBanner
              adminName={impersonating.adminName}
              targetName={impersonating.targetName}
            />
          )}

          {/* Top bar on every breakpoint, not just mobile: it carries the
              identity of whoever is signed in, and in a tool where one click
              suspends a tenant, "who am I right now" is worth a permanent
              corner of the screen. */}
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur-md">
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="size-5" aria-hidden />
            </Button>

            {/* On mobile the sidebar is behind a drawer, so the top bar
                carries the way out to the public site instead. */}
            <BrandMark name={brand.name} logoUrl={brand.logoUrl} size="sm" className="lg:hidden" />

            <div className="ml-auto flex items-center gap-2">
              <LocaleToggle />
              <ThemeToggle />

              <div className="mx-1 h-6 w-px bg-border" aria-hidden />

              {/* The identity doubles as the link to your own profile — where
                  people instinctively click when they want to change it. */}
              <Link
                href="/a/profile"
                title="My profile"
                className="flex min-w-0 items-center gap-2.5 rounded-full py-1 pr-3 pl-1 transition-colors hover:bg-surface-2"
              >
                <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                <div className="hidden min-w-0 sm:block">
                  <p className="truncate text-sm leading-tight font-semibold">{user.name}</p>
                  <p className="truncate text-xs leading-tight text-text-light">{user.email}</p>
                </div>
              </Link>

              {/*
                A form POST behind a confirmation. Sign-out is a state change,
                and a GET route can be fired by any <img src="/logout"> on a
                page the admin happens to visit.
              */}
              <LogoutButton />
            </div>
          </header>

          <main id="main" className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </div>
    </AdminUserContext.Provider>
  );
}

/** Standard page header inside the admin area. */
export function AdminPage({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">{title}</h1>
          {description && <p className="mt-1 text-text-secondary">{description}</p>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {children}
    </div>
  );
}
