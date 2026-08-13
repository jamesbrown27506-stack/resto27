import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MobileTabBar, type MoreTab, type TabItem } from "@/components/layout/mobile-tabbar";
import { CUSTOMER_MORE } from "@/components/layout/more-tabs";
import { getHeaderUser } from "@/lib/auth/header-user";
import { getBranding } from "@/lib/branding";

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
 *  So the last tab follows the area you work in: administration for an admin,
 *  the order queue for a manager, and the whole account menu for a customer —
 *  the same "More" sheet the customer area itself uses, so the bar does not
 *  change shape when they cross between the two.
 * ─────────────────────────────────────────────────────────────────────────
 */

const HOME: TabItem = { href: "/", icon: "Home", labelKey: "nav.home" };
const RESTAURANTS: TabItem = { href: "/restaurants", icon: "Store", labelKey: "nav.restaurants" };
const CONTACT: TabItem = { href: "/contact", icon: "LifeBuoy", labelKey: "nav.contact" };

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [user, brand] = await Promise.all([getHeaderUser(), getBranding()]);

  let tabs: TabItem[];
  let more: MoreTab | undefined;

  if (!user) {
    tabs = [
      HOME,
      RESTAURANTS,
      { href: "/pricing", icon: "Percent", labelKey: "nav.pricing" },
      CONTACT,
    ];
  } else if (user.area === "admin") {
    // The admin area is English by design (see ADMIN_NAV), so these carry
    // plain labels rather than translation keys.
    tabs = [
      HOME,
      RESTAURANTS,
      { href: "/a", icon: "LayoutDashboard", label: "Dashboard" },
      { href: "/a/settings", icon: "Settings", label: "Settings" },
    ];
  } else if (user.area === "manager") {
    tabs = [
      HOME,
      RESTAURANTS,
      { href: "/m", icon: "LayoutDashboard", labelKey: "nav.m.dashboard" },
      { href: "/m/orders", icon: "ReceiptText", labelKey: "nav.m.orders", matchPrefix: true },
    ];
  } else {
    tabs = [
      HOME,
      RESTAURANTS,
      { href: "/account", icon: "LayoutDashboard", labelKey: "cac.title" },
    ];
    more = CUSTOMER_MORE;
  }

  return (
    <div className="flex min-h-dvh flex-col pb-20 lg:pb-0">
      <SiteHeader user={user} brand={brand} />
      {/* pt-20 clears the taller mobile header; pt-16 on desktop. */}
      <div id="main" className="flex flex-1 flex-col pt-20 lg:pt-16">
        {children}
      </div>
      <SiteFooter brand={brand} />
      <MobileTabBar items={tabs} more={more} />
    </div>
  );
}
