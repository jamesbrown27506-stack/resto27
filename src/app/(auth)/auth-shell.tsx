"use client";

import Link from "next/link";
import { ArrowLeft, ShieldCheck, Store, UtensilsCrossed } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LocaleToggle } from "@/components/layout/locale-toggle";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * Auth shell — form on the left, reassurance panel on the right.
 *
 * The right panel is hidden below `lg` rather than stacked. On a phone the
 * only thing that matters is the form; pushing it below a decorative panel is
 * how sign-in flows lose people who are already trying to give you money.
 */
export function AuthShell({
  brand,
  children,
}: {
  brand: { name: string; logoUrl: string | null };
  children: React.ReactNode;
}) {
  const { t } = useLocale();

  const features = [
    { Icon: Store, title: t("auth.panel.f1"), body: t("auth.panel.f1body") },
    { Icon: UtensilsCrossed, title: t("auth.panel.f2"), body: t("auth.panel.f2body") },
    { Icon: ShieldCheck, title: t("auth.panel.f3"), body: t("auth.panel.f3body") },
  ];

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col">
        <header className="flex items-center justify-between gap-3 p-6">
          <BrandMark name={brand.name} logoUrl={brand.logoUrl} />
          <div className="flex items-center gap-2">
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </header>

        <main id="main" className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-sm">
            {/* Sign-in and sign-up have no site header, so without this the
                only way back to the site was the browser's own back button. */}
            <Link
              href="/"
              className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:border-primary hover:text-primary"
            >
              <ArrowLeft className="size-4" aria-hidden />
              <span>{t("auth.backToSite")}</span>
            </Link>
            {children}
          </div>
        </main>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 p-6 text-xs text-text-light">
          <span>© 2026 {brand.name}</span>
          <Link href="/privacy" className="hover:text-text">
            {t("footer.privacy")}
          </Link>
          <Link href="/terms" className="hover:text-text">
            {t("footer.terms")}
          </Link>
        </footer>
      </div>

      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-12 text-primary-fg lg:flex">
        <div aria-hidden className="absolute -top-24 -right-24 size-96 rounded-full bg-primary-fg/5" />
        <div aria-hidden className="absolute -bottom-32 -left-16 size-80 rounded-full bg-accent/10" />

        <div className="relative">
          <p className="text-[11px] font-bold tracking-[0.12em] uppercase opacity-60">
            {t("auth.panel.eyebrow")}
          </p>
          <h2 className="mt-4 max-w-md font-display text-4xl leading-tight font-bold">
            {t("auth.panel.title")}
          </h2>
          <p className="mt-4 max-w-sm leading-relaxed opacity-70">{t("auth.panel.body")}</p>
        </div>

        <ul className="relative flex flex-col gap-5">
          {features.map(({ Icon, title, body }) => (
            <li key={title} className="flex items-start gap-3">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-primary-fg/10">
                <Icon className="size-4" aria-hidden />
              </span>
              <span>
                <span className="block font-semibold">{title}</span>
                <span className="block text-sm opacity-65">{body}</span>
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
