"use client";

import Link from "@/components/layout/public-link";
import { Mail, MapPin, Phone } from "lucide-react";
import { SocialIcon } from "@/components/icons/social-icon";
import { BrandMark } from "./brand-mark";
import { AppDownloadFooterLinks } from "./app-download";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { SocialLink } from "@/lib/social-platforms";
import { formatPhoneDisplay, telHref } from "@/lib/phone";

/** The developer's credit, which doubles as the WhatsApp support line. */
const DEVELOPER = {
  name: "Mrcode27",
  phone: "+237 691 09 89 99",
  whatsapp: "https://wa.me/237691098999",
};

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
}: {
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

  return (
    <footer className="mt-auto bg-brand-solid text-brand-on-solid">
      <div className="container-page py-14 sm:py-16">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.8fr_repeat(3,1fr)]">
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
          <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
            <span>{t("footer.developedBy")}</span>
            <a
              href={DEVELOPER.whatsapp}
              target="_blank"
              rel="noreferrer"
              title={t("footer.whatsappSupport")}
              className="inline-flex items-center gap-1.5 font-semibold text-brand-on-solid/80 transition-colors hover:text-brand-on-solid"
            >
              <span>{DEVELOPER.name}</span>
              <span aria-hidden>·</span>
              <SocialIcon platform="whatsapp" className="size-3.5" />
              <span className="sr-only">{t("footer.whatsappSupport")}</span>
              <span className="font-normal">{DEVELOPER.phone}</span>
            </a>
          </p>
          <p>{t("footer.madeIn")} 🇨🇲</p>
        </div>
      </div>
    </footer>
  );
}
