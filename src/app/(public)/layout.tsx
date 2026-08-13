import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MobileTabBar, type TabItem } from "@/components/layout/mobile-tabbar";
import { getHeaderUser } from "@/lib/auth/header-user";
import { getBranding } from "@/lib/branding";

/**
 * Marketing shell. Every public page renders through here — including the
 * homepage, which in the PHP build carried its own document and its own copy
 * of the chrome (§10). That duplication is the thing this layout exists to
 * make impossible.
 *
 * A signed-in visitor gets different bottom tabs than an anonymous one: a
 * client should never be offered "Pricing" (they already pay), so that slot
 * becomes the link to their own dashboard.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [user, brand] = await Promise.all([getHeaderUser(), getBranding()]);

  // The bottom tab bar (phone-app navigation), shown below lg.
  const tabs: TabItem[] = user
    ? [
        { href: "/", icon: "Home", labelKey: "nav.home" },
        { href: "/restaurants", icon: "Store", labelKey: "nav.restaurants" },
        { href: "/contact", icon: "LifeBuoy", labelKey: "nav.contact" },
        { href: user.homeHref, icon: "LayoutDashboard", labelKey: "cac.title", matchPrefix: true },
      ]
    : [
        { href: "/", icon: "Home", labelKey: "nav.home" },
        { href: "/restaurants", icon: "Store", labelKey: "nav.restaurants" },
        { href: "/pricing", icon: "Percent", labelKey: "nav.pricing" },
        { href: "/contact", icon: "LifeBuoy", labelKey: "nav.contact" },
      ];

  return (
    <div className="flex min-h-dvh flex-col pb-20 lg:pb-0">
      <SiteHeader user={user} brand={brand} />
      {/* pt-20 clears the taller mobile header; pt-16 on desktop. */}
      <div id="main" className="flex flex-1 flex-col pt-20 lg:pt-16">
        {children}
      </div>
      <SiteFooter brand={brand} />
      <MobileTabBar items={tabs} />
    </div>
  );
}
