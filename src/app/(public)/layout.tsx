import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { CustomerNavigation } from "@/components/layout/customer-navigation";
import { AppDownloadBand } from "@/components/layout/app-download";
import { RevealOnScroll } from "@/components/marketing/reveal-on-scroll";

import { getHeaderUser } from "@/lib/auth/header-user";
import { getBranding } from "@/lib/branding";
import { getSocialLinks } from "@/lib/social-links";
import { getMobileAppVisibility } from "@/lib/mobile-app-settings";
import { fetchGuideCatalog } from "@/lib/data/guides";
import { getLocale } from "@/lib/i18n/locale-server";
import { guideTitle, type GuideIntent } from "@/lib/seo-guides";

/** The footer's "where to eat" links, most searched first. */
const FOOTER_GUIDES: GuideIntent[] = ["pas-cher", "livraison", "meilleurs", "ouvert-tard", "ouvert-dimanche", "reserver"];

/**
 * Links from every public page to the Douala guides that pass their quality
 * gate — the strongest internal signal these pages can get. Never throws: a
 * failed menu read costs the footer one column, not the whole page.
 */
async function footerGuides() {
  try {
    const [{ guides }, locale] = await Promise.all([fetchGuideCatalog(), getLocale()]);
    const fr = locale === "fr";
    const links = FOOTER_GUIDES.flatMap((intent) => guides.filter((g) => g.intent === intent && g.place.kind === "city" && g.indexable))
      .slice(0, 5)
      .map((g) => ({ href: `/explore/guide/${g.slug}`, label: guideTitle(g, fr) }));
    if (!links.length) return null;
    return {
      heading: fr ? "Où manger à Douala" : "Where to eat in Douala",
      links: [...links, { href: "/explore", label: fr ? "Par plat et par quartier" : "By dish and neighbourhood" }],
    };
  } catch (error) {
    console.error("[public-layout:footerGuides]", (error as Error).message);
    return null;
  }
}

/**
 * Marketing shell. Every public page renders through here — including the
 * homepage, which in the PHP build carried its own document and its own copy
 * of the chrome (§10). That duplication is the thing this layout exists to
 * make impossible.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE BOTTOM BAR KNOWS WHO IS LOOKING AT IT.
 *
 *  It used to end in "Contact" for everybody. For an anonymous visitor that
 *  is right — it is how you reach the platform before you have an account.
 *  For a signed-in one it is the wrong door: an administrator on the homepage
 *  would be offered a contact form addressed to themselves, and a manager one
 *  addressed to their own support queue.
 *
 *  So the whole bar follows the person, not the page: a visitor gets
 *  discovery and sign-in, a customer their orders and account, a manager
 *  their desks, and an administrator the same bar as inside /a — so it never
 *  changes shape when they cross between the site and their area. Every bar
 *  is defined in lib/mobile-tabs.
 * ─────────────────────────────────────────────────────────────────────────
 */

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [user, brand, socialLinks, mobileApp, guides] = await Promise.all([
    getHeaderUser(),
    getBranding(),
    getSocialLinks(),
    getMobileAppVisibility(),
    footerGuides(),
  ]);

  return (
    <div className="flex min-h-dvh flex-col pb-20 lg:pb-0">
      <SiteHeader user={user} brand={brand} />
      {/* pt-20 clears the taller mobile header; pt-16 on desktop. */}
      <div id="main" className="flex flex-1 flex-col pt-20 lg:pt-16">
        {children}
      </div>
      {mobileApp.appDownload && <AppDownloadBand brandName={brand.name} />}
      <SiteFooter brand={brand} socialLinks={socialLinks} showAppLinks={mobileApp.appDownload} guides={guides} />
      <CustomerNavigation area={user?.area ?? "visitor"} />
      <RevealOnScroll />
    </div>
  );
}
