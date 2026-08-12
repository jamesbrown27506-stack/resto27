"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, PauseCircle } from "lucide-react";
import { ManagerSidebar } from "./manager-sidebar";
import { ImpersonationBanner } from "./impersonation-banner";
import { LocaleToggle } from "./locale-toggle";
import { LogoutButton } from "./logout-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { SubscriptionBanner } from "@/components/billing/subscription-banner";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { switchBranch } from "@/lib/data/manager-actions";
import type { Branch } from "@/lib/branch-types";

/**
 * Manager chrome: sidebar, branch context, subscription banner.
 *
 * Two routes deliberately escape this shell via their own nested layouts —
 * /m/kitchen (full-bleed, glanced at from across a room) and
 * /m/orders/[id]/ticket (80mm print). Everything else renders inside it.
 *
 * THE BRANCH SWITCH IS A SERVER ROUND TRIP, not local state. The active branch
 * decides which restaurant every query on every page reads from, so it lives in
 * an httpOnly cookie the server validates against real staff membership. Doing
 * it in useState would leave the chrome saying "Bonapriso" while the data
 * underneath stayed Akwa.
 */
export function ManagerShell({
  branches,
  active,
  brand,
  user,
  impersonating,
  children,
}: {
  branches: Branch[];
  active: Branch;
  brand: { name: string; logoUrl: string | null };
  user: { name: string; email: string; avatarUrl: string | null };
  impersonating: { adminName: string; targetName: string } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLocale();
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [, startTransition] = useTransition();

  function onSwitchBranch(id: string) {
    if (id === active.restaurantId) return setDrawerOpen(false);

    startTransition(async () => {
      const result = await switchBranch(id);
      if (!result.ok) return toast(result.error, "error");
      setDrawerOpen(false);
      // Refresh rather than navigate: every Server Component on the current
      // page re-reads with the new branch cookie, and the user stays where
      // they were instead of being bounced to the dashboard.
      router.refresh();
    });
  }

  const sidebar = (
    <ManagerSidebar
      branches={branches}
      activeBranch={active}
      brand={brand}
      onSwitchBranch={onSwitchBranch}
    />
  );

  return (
    <div className="flex min-h-dvh bg-bg">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-surface lg:block">
        {sidebar}
      </aside>

      <Sheet
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={t("nav.menu")}
        side="left"
        className="p-0"
      >
        {sidebar}
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {impersonating && (
          <ImpersonationBanner
            adminName={impersonating.adminName}
            targetName={impersonating.targetName}
          />
        )}

        <SubscriptionBanner state={active.subscriptionState} endDate={active.expiresAt} />

        {/* The restaurant's own pause, not the platform's. Shown here rather
            than only on settings, because a kitchen that forgets it is paused
            wonders all evening where the orders went. */}
        {!active.isAcceptingOrders && (
          <div
            role="status"
            className="flex items-center gap-2 border-b border-warning/30 bg-warning-light px-4 py-2 text-sm font-semibold text-warning"
          >
            <PauseCircle className="size-4 shrink-0" aria-hidden />
            <span>{t("m.paused.body")}</span>
          </div>
        )}

        {/*
          On EVERY breakpoint, not just mobile.

          It carries who is signed in and which branch they are acting on. In a
          tool where one tap confirms an order against a restaurant's name,
          "who am I and where am I" is worth a permanent corner of the screen —
          the same reasoning as the admin shell.
        */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur-md">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label={t("nav.openMenu")}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="size-5" aria-hidden />
          </Button>

          <div className="min-w-0 lg:hidden">
            <p className="truncate text-sm font-semibold">{active.restaurantName}</p>
            <p className="truncate text-xs text-text-light">{active.branchLabel}</p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <LocaleToggle />
            <ThemeToggle />

            <div className="mx-1 h-6 w-px bg-border" aria-hidden />

            {/* The identity doubles as the link to your own profile — where
                people instinctively click when they want to change it. */}
            <Link
              href="/m/profile"
              title={t("common.myProfile")}
              className="flex min-w-0 items-center gap-2.5 rounded-full py-1 pr-3 pl-1 transition-colors hover:bg-surface-2"
            >
              <Avatar name={user.name} src={user.avatarUrl} size="sm" />
              <div className="hidden min-w-0 sm:block">
                <p className="truncate text-sm leading-tight font-semibold">{user.name}</p>
                <p className="truncate text-xs leading-tight text-text-light">
                  {t(`common.role.${active.role}` as TranslationKey)}
                </p>
              </div>
            </Link>

            <LogoutButton />
          </div>
        </header>

        <main id="main" key={pathname} className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Standard page header inside the manager area.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  IT TRANSLATES ITS OWN TITLE, and that is why `titleKey` exists.
 *
 *  Most manager pages are Server Components, which cannot call useLocale —
 *  so their titles were hardcoded French and stayed French whatever the
 *  toggle said. This component is already a Client Component, so handing it
 *  a KEY instead of a string lets a server page have a translated heading
 *  without becoming a client page itself.
 *
 *  `title` still accepts a plain string, for headings built from data — a
 *  restaurant's own name is not a translatable phrase.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function ManagerPage({
  title,
  titleKey,
  description,
  descriptionKey,
  action,
  children,
}: {
  title?: string;
  titleKey?: TranslationKey;
  description?: string;
  descriptionKey?: TranslationKey;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useLocale();

  const heading = titleKey ? t(titleKey) : (title ?? "");
  const sub = descriptionKey ? t(descriptionKey) : description;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">{heading}</h1>
          {sub && <p className="mt-1 text-sm text-text-secondary">{sub}</p>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {children}
    </div>
  );
}
