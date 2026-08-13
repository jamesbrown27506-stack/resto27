import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MobileTabBar, type TabItem } from "@/components/layout/mobile-tabbar";
import { getHeaderUser } from "@/lib/auth/header-user";
import { getBranding } from "@/lib/branding";

/**
 * Customer shell.
 *
 * Only the header and footer live here, because the customer area is not
 * uniform: /browse, /cart and /checkout are full-width commerce screens, while
 * /account, /orders, /loyalty and friends are sidebar pages. Account screens
 * opt into <AccountShell> themselves rather than the layout forcing a sidebar
 * onto a checkout flow that should have nothing else on screen.
 *
 * The signed-in client is the platform's least navigable person, so they get
 * the phone-app bottom tab bar: the way home sits first (the public site),
 * then restaurants, contact, and their dashboard — never Pricing.
 */
const TABS: TabItem[] = [
  { href: "/", icon: "Home", labelKey: "nav.site" },
  { href: "/restaurants", icon: "Store", labelKey: "nav.restaurants" },
  { href: "/contact", icon: "LifeBuoy", labelKey: "nav.contact" },
  { href: "/account", icon: "LayoutDashboard", labelKey: "cac.title", matchPrefix: true },
];

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const [user, brand] = await Promise.all([getHeaderUser(), getBranding()]);

  return (
    <div className="flex min-h-dvh flex-col pb-20 lg:pb-0">
      <SiteHeader user={user} brand={brand} />
      {/* pt-20 clears the taller mobile header; pt-16 on desktop. */}
      <div id="main" className="flex flex-1 flex-col pt-20 lg:pt-16">
        {children}
      </div>
      <SiteFooter brand={brand} />
      <MobileTabBar items={TABS} />
    </div>
  );
}
