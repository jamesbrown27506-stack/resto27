import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
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
 */
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const [user, brand] = await Promise.all([getHeaderUser(), getBranding()]);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader user={user} brand={brand} />
      <div id="main" className="flex flex-1 flex-col pt-16">
        {children}
      </div>
      <SiteFooter brand={brand} />
    </div>
  );
}
