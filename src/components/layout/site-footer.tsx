"use client";

import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * Brand marks are inline rather than from lucide-react — the icon set dropped
 * brand logos from its core package, and pulling a second icon dependency for
 * three glyphs is not worth the bytes.
 */
function FacebookMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.5-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.9h-2.33V22C18.34 21.24 22 17.08 22 12.06Z" />
    </svg>
  );
}

function InstagramMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...props}>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function WhatsappMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.16-1.35a9.92 9.92 0 0 0 4.88 1.25h.01c5.5 0 9.96-4.46 9.96-9.96 0-2.66-1.04-5.16-2.92-7.04A9.9 9.9 0 0 0 12.04 2Zm0 18.16h-.01a8.26 8.26 0 0 1-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.24 8.24 0 0 1-1.26-4.39c0-4.56 3.71-8.27 8.27-8.27 2.21 0 4.28.86 5.84 2.42a8.2 8.2 0 0 1 2.42 5.85c0 4.56-3.71 8.25-8.27 8.25Zm4.53-6.18c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.1-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.41.09-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42h-.47c-.16 0-.43.06-.65.31-.22.25-.85.84-.85 2.03 0 1.2.87 2.35.99 2.51.12.17 1.72 2.62 4.16 3.68.58.25 1.03.4 1.39.51.58.19 1.11.16 1.53.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}

const GROUPS: { heading: TranslationKey; links: { href: string; label: TranslationKey }[] }[] = [
  {
    heading: "footer.discover",
    links: [
      { href: "/restaurants", label: "footer.allRestaurants" },
      { href: "/restaurants?quartier=Akwa", label: "footer.douala" },
      { href: "/restaurants?sort=rating", label: "footer.topRated" },
    ],
  },
  {
    heading: "footer.forRestaurants",
    links: [
      { href: "/register/restaurant", label: "nav.registerRestaurant" },
      { href: "/pricing", label: "footer.pricing" },
      { href: "/login", label: "footer.managerArea" },
    ],
  },
  {
    heading: "footer.support",
    links: [
      { href: "/contact", label: "footer.contactUs" },
      { href: "/privacy", label: "footer.privacy" },
      { href: "/terms", label: "footer.terms" },
    ],
  },
];

/**
 * Shared footer. Brand name and contact details will come from `settings` once
 * P2's `lib/branding` exists (§9) — renaming the platform must rename every
 * page, tab, email and share card at once, which is exactly what the PHP
 * homepage broke by hardcoding its own copy.
 */
export function SiteFooter({
  brand,
}: {
  brand: { name: string; logoUrl: string | null; supportEmail: string };
}) {
  const { t } = useLocale();
  const year = 2026;

  return (
    <footer className="mt-auto bg-primary text-primary-fg">
      <div className="container-page py-16">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.8fr_repeat(3,1fr)]">
          <div>
            {/* The footer sits on dark green, so the mark inherits rather than
                painting itself the light-surface text colour. */}
            <BrandMark name={brand.name} logoUrl={brand.logoUrl} tone="inherit" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed opacity-70">
              {t("footer.tagline")}
            </p>

            <div className="mt-6 flex gap-2">
              {[
                { Icon: FacebookMark, label: "Facebook", href: "#" },
                { Icon: InstagramMark, label: "Instagram", href: "#" },
                { Icon: WhatsappMark, label: "WhatsApp", href: "#" },
              ].map(({ Icon, label, href }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="grid size-9 place-items-center rounded-full bg-primary-fg/10 transition-colors hover:bg-accent hover:text-accent-fg"
                >
                  <Icon className="size-4" aria-hidden />
                </a>
              ))}
            </div>

            <address className="mt-6 flex flex-col gap-2 text-sm not-italic opacity-60">
              <span className="flex items-center gap-2">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                Douala, Cameroun
              </span>
              <a href="tel:+237699000000" className="flex items-center gap-2 hover:opacity-100">
                <Phone className="size-3.5 shrink-0" aria-hidden />
                +237 6 99 00 00 00
              </a>
              <a
                href={`mailto:${brand.supportEmail}`}
                className="flex items-center gap-2 hover:opacity-100"
              >
                <Mail className="size-3.5 shrink-0" aria-hidden />
                {brand.supportEmail}
              </a>
            </address>
          </div>

          {GROUPS.map((group) => (
            <nav key={group.heading} aria-label={t(group.heading)}>
              <h2 className="font-sans text-[11px] font-bold tracking-[0.12em] uppercase opacity-45">
                {t(group.heading)}
              </h2>
              <ul className="mt-4 flex flex-col gap-2.5">
                {group.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link
                      href={link.href}
                      className="text-sm opacity-70 transition-opacity hover:opacity-100"
                    >
                      {t(link.label)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-primary-fg/10 pt-7 text-sm opacity-45 sm:flex-row">
          <p>
            © {year} {brand.name}. {t("footer.rights")}
          </p>
          <p>{t("footer.madeIn")} 🇨🇲</p>
        </div>
      </div>
    </footer>
  );
}
