import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { getHeaderUser } from "@/lib/auth/header-user";
import { getBranding } from "@/lib/branding";

/**
 * Marketing shell. Every public page renders through here — including the
 * homepage, which in the PHP build carried its own document and its own copy
 * of the chrome (§10). That duplication is the thing this layout exists to
 * make impossible.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [user, brand] = await Promise.all([getHeaderUser(), getBranding()]);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader user={user} brand={brand} />
      {/* pt-16 clears the fixed header. */}
      <div id="main" className="flex flex-1 flex-col pt-16">
        {children}
      </div>
      <SiteFooter brand={brand} />
    </div>
  );
}
