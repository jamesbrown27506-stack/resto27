import { BrandMark } from "@/components/layout/brand-mark";
import { LocaleToggle } from "@/components/layout/locale-toggle";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { getBranding } from "@/lib/branding";

/** A focused shell for QR table service: no marketing footer or account navigation. */
export default async function TableServiceLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBranding();

  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <BrandMark name={brand.name} logoUrl={brand.logoUrl} size="sm" />
          <div className="flex items-center gap-2">
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
    </div>
  );
}
