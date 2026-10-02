"use client";

import Link from "@/components/layout/public-link";
import { Mail, MapPin, Phone } from "lucide-react";
import { SocialIcon } from "@/components/icons/social-icon";
import { BrandMark } from "./brand-mark";
import { AppDownloadFooterLinks } from "./app-download";
import { useLocale } from "@/lib/i18n/use-locale";
import { useNativeApp } from "@/lib/capacitor/platform";
import { DEVELOPER, developerWhatsAppHref } from "@/lib/developer";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { SocialLink } from "@/lib/social-platforms";
import { formatPhoneDisplay, telHref } from "@/lib/phone";


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
      { href: "/about", label: "footer.about" },
      { href: "/contact", label: "footer.contactUs" },
      { href: "/privacy", label: "footer.privacy" },
      { href: "/terms", label: "footer.terms" },
    ],
  },
];

export function SiteFooter({
  brand,
  socialLinks,
  showAppLinks = true,
  guides = null,
}: {
  /**
   * "Where to eat in Douala": the guide pages that pass their quality gate,
   * resolved on the server (see the public layout). Absent on screens that do
   * not pass it, and whenever no guide qualifies.
   */
  guides?: { heading: string; links: { href: string; label: string }[] } | null;
  brand: {
    name: string;
    logoUrl: string | null;
    supportEmail: string;
    supportPhone: string | null;
    supportAddress: string | null;
  };
  socialLinks: SocialLink[];
  /** The admin's "Download our app" switch (/a/settings → Mobile app). */
  showAppLinks?: boolean;
}) {
  const { t } = useLocale();
  const native = useNativeApp();

  /*
    No footer inside the installed app (2026-10). A phone app does not end in
    a website's footer: the tab bar is the whole navigation there. The
    developer credit is a website thing and stays here only — the owner did
    not want it in the app at all. The web, phone browsers included, keeps
    the full footer.
  */
  if (native) return null;

  return (
    <footer className="mt-auto bg-brand-solid text-brand-on-solid">
      <div className="container-page py-14 sm:py-16">
        <div className={guides ? "grid gap-10 md:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,1fr)]" : "grid gap-10 md:grid-cols-2 lg:grid-cols-[1.8fr_repeat(3,1fr)]"}>
          <div>
            <BrandMark name={brand.name} logoUrl={brand.logoUrl} tone="inherit" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-brand-on-solid/70">
              {t("footer.tagline")}
            </p>

            {socialLinks.length > 0 && (
              <nav className="mt-6" aria-label="Social media">
                <ul className="flex flex-wrap gap-2">
                  {socialLinks.map((link) => (
                    <li key={link.platform}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={link.label}
                        title={link.label}
                        className="grid size-10 place-items-center rounded-full bg-brand-on-solid/10 text-brand-on-solid transition-colors hover:bg-accent hover:text-accent-fg"
                      >
                        <SocialIcon platform={link.platform} className="size-4.5" />
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}

            <address className="mt-6 flex flex-col gap-2 text-sm not-italic text-brand-on-solid/65">
              {brand.supportAddress && (
                <span className="flex items-center gap-2">
                  <MapPin className="size-3.5 shrink-0" aria-hidden />
                  {brand.supportAddress}
                </span>
              )}
              {brand.supportPhone && telHref(brand.supportPhone) && (
                <a
                  href={telHref(brand.supportPhone)!}
                  className="flex items-center gap-2 hover:text-brand-on-solid"
                >
                  <Phone className="size-3.5 shrink-0" aria-hidden />
                  {formatPhoneDisplay(brand.supportPhone)}
                </a>
              )}
              <a
                href={`mailto:${brand.supportEmail}`}
                className="flex items-center gap-2 hover:text-brand-on-solid"
              >
                <Mail className="size-3.5 shrink-0" aria-hidden />
                {brand.supportEmail}
              </a>
            </address>

            {showAppLinks && <AppDownloadFooterLinks />}
          </div>

          {guides && (
            <nav aria-label={guides.heading}>
              <h2 className="font-sans text-[11px] font-bold tracking-[0.12em] text-brand-on-solid/45 uppercase">
                {guides.heading}
              </h2>
              <ul className="mt-4 flex flex-col gap-2.5">
                {guides.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-brand-on-solid/70 transition-colors hover:text-brand-on-solid"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {GROUPS.map((group) => (
            <nav key={group.heading} aria-label={t(group.heading)}>
              <h2 className="font-sans text-[11px] font-bold tracking-[0.12em] text-brand-on-solid/45 uppercase">
                {t(group.heading)}
              </h2>
              <ul className="mt-4 flex flex-col gap-2.5">
                {group.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-brand-on-solid/70 transition-colors hover:text-brand-on-solid"
                    >
                      {t(link.label)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-brand-on-solid/10 pt-7 text-sm text-brand-on-solid/50 sm:flex-row">
          <p>
            © {new Date().getFullYear()} {brand.name}. {t("footer.rights")}
          </p>
          {/* The one accent-coloured element in the footer, on purpose. */}
          <a
            href={developerWhatsAppHref(t("footer.whatsappMessage", { name: brand.name }))}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-full bg-accent/15 px-4 py-1.5 text-brand-on-solid ring-1 ring-accent/40 transition-colors hover:bg-accent hover:text-accent-fg"
          >
            <SocialIcon platform="whatsapp" className="size-4 text-accent transition-colors group-hover:text-accent-fg" />
            <span>
              <span>{t("footer.developedBy")} </span>
              <strong className="font-semibold">{DEVELOPER.name}</strong>
            </span>
            <span aria-hidden className="text-brand-on-solid/40 group-hover:text-accent-fg/60">·</span>
            <span className="font-medium text-accent group-hover:text-accent-fg">{t("footer.contactWhatsapp")}</span>
          </a>
          <p>{t("footer.madeIn")} 🇨🇲</p>
        </div>
      </div>
    </footer>
  );
}
