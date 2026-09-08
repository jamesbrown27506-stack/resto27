import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { CustomerNavigation } from "@/components/layout/customer-navigation";

import { getHeaderUser } from "@/lib/auth/header-user";
import { getBranding } from "@/lib/branding";
import { getSocialLinks } from "@/lib/social-links";

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

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [user, brand, socialLinks] = await Promise.all([
    getHeaderUser(),
    getBranding(),
    getSocialLinks(),
  ]);

  return (
    <div className="flex min-h-dvh flex-col pb-20 lg:pb-0">
      <SiteHeader user={user} brand={brand} />
      {/* pt-20 clears the taller mobile header; pt-16 on desktop. */}
      <div id="main" className="flex flex-1 flex-col pt-20 lg:pt-16">
        {children}
      </div>
      <SiteFooter brand={brand} socialLinks={socialLinks} />
      <CustomerNavigation accountHref={user?.homeHref ?? "/login?next=/account"} />
    </div>
  );
}
