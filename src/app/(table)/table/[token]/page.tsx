import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getTableLanding } from "@/lib/data/dining-actions";
import { getBranding } from "@/lib/branding";
import { getTranslator } from "@/lib/i18n/locale-server";
import { LocaleToggle } from "@/components/layout/locale-toggle";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { GuestTableClient } from "./guest-table-client";

export const dynamic = "force-dynamic";

/** The browser tab names the restaurant, not the platform. */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const landing = await getTableLanding(token);
  const name = landing?.restaurant?.name;
  return {
    title: name ? { absolute: `${name} · Table ${landing.table.number}` } : "Table service",
    robots: { index: false, follow: false },
  };
}

export default async function GuestTablePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [landing, brand, t] = await Promise.all([getTableLanding(token), getBranding(), getTranslator()]);
  if (!landing) notFound();
  const name = landing.restaurant?.name ?? "";
  const logo = (landing.restaurant as { logo_url?: string | null } | null)?.logo_url ?? null;

  return (
    <>
      {/* The restaurant's own header: its logo (or its initial) and its name. */}
      <header className="sticky top-0 z-40 border-b border-border/80 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="size-10 shrink-0 rounded-md bg-surface-2 object-cover" />
            ) : (
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md bg-primary font-display text-lg font-bold text-primary-fg">
                {name.trim().charAt(0).toUpperCase() || "·"}
              </span>
            )}
            <span className="truncate font-display text-lg font-bold">{name}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <GuestTableClient landing={landing} />

      <footer className="pb-28 pt-2 text-center text-xs text-text-light">
        <span>{t("ons.g.poweredBy")} </span>
        <Link href="/" className="font-semibold hover:text-primary">{brand.name}</Link>
      </footer>
    </>
  );
}
