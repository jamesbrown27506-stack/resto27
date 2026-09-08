import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { CustomerNavigation } from "@/components/layout/customer-navigation";

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
 * ─────────────────────────────────────────────────────────────────────────
 *  THE BOTTOM BAR IS FOUR TABS, AND THE FOURTH IS "MORE".
 *
 *  It used to be Site / Restaurants / Contact / Dashboard, with the nine
 *  account destinations exiled to a sideways-scrolling strip at the top of
 *  every account page. Contact was the odd one out — a signed-in customer
 *  with a Messages screen does not need a public contact form in their thumb
 *  reach — so that slot now carries the whole account menu instead, opened as
 *  a grid where all nine are visible at once.
 * ─────────────────────────────────────────────────────────────────────────
 */
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
      <CustomerNavigation accountHref={user?.homeHref ?? "/login?next=/account"} />
    </div>
  );
}
