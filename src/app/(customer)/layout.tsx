import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { CustomerNavigation } from "@/components/layout/customer-navigation";
import { CustomerFooter } from "@/components/layout/customer-footer";

import { getHeaderUser } from "@/lib/auth/header-user";
import { getBranding } from "@/lib/branding";
import { getSocialLinks } from "@/lib/social-links";
import { getMobileAppVisibility } from "@/lib/mobile-app-settings";

/**
 * Customer shell.
 *
 * Only the header and footer live here, because the customer area is not
 * uniform: /browse, /cart and /checkout are full-width commerce screens, while
 * /account, /orders, /loyalty and friends are sidebar pages. Account screens
 * opt into <AccountShell> themselves rather than the layout forcing a sidebar
 * onto a checkout flow that should have nothing else on screen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE BOTTOM BAR IS THE SAME ONE THE PUBLIC SITE DRAWS.
 *
 *  Accueil, Restaurants, Explorer, Commandes, Réservations — and "Plus",
 *  which opens every other account screen as a grid where all of them are
 *  visible at once (they used to be exiled to a sideways-scrolling strip at
 *  the top of every account page). Defined in lib/mobile-tabs.
 * ─────────────────────────────────────────────────────────────────────────
 */
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const [user, brand, socialLinks, mobileApp] = await Promise.all([
    getHeaderUser(),
    getBranding(),
    getSocialLinks(),
    getMobileAppVisibility(),
  ]);

  return (
    <div className="flex min-h-dvh flex-col pb-20 lg:pb-0">
      <SiteHeader user={user} brand={brand} />
      {/* pt-20 clears the taller mobile header; pt-16 on desktop. */}
      <div id="main" className="flex flex-1 flex-col pt-20 lg:pt-16">
        {children}
      </div>
      <CustomerFooter>
        <SiteFooter brand={brand} socialLinks={socialLinks} showAppLinks={mobileApp.appDownload} />
      </CustomerFooter>
      <CustomerNavigation user={user} />
    </div>
  );
}
