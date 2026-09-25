import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };
import { AdminShell } from "@/components/layout/admin-shell";
import { requireRole } from "@/lib/auth/session";
import { getImpersonation } from "@/lib/auth/impersonation";
import { getBranding } from "@/lib/branding";
import { redirect } from "next/navigation";

/**
 * Platform admin guard.
 *
 * `requireRole` redirects to /not-found rather than a 403 — telling an
 * unauthorised visitor that /a/users exists is information they did not have a
 * moment ago.
 *
 * The profile it returns is handed to the shell, so the header can show who is
 * signed in. That costs nothing: the row was already loaded to authorise the
 * request.
 *
 * Note that /a/health is a Route Handler, not a page, so it does not pass
 * through this layout: the uptime monitor can reach it without a session,
 * which is the point.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireRole("admin");
  const [impersonating, brand] = await Promise.all([getImpersonation(), getBranding()]);

  // While impersonating, the admin belongs on the TENANT's side of the app.
  // Visiting /a mid-session used to leave them staring at their own dashboard
  // with a banner explaining they are elsewhere — an easy way to act on the
  // wrong data. Send them to /m instead; "Stop impersonating" clears the
  // cookie first, so returning here is never a redirect loop.
  if (impersonating) redirect("/m");

  return (
    <AdminShell
      user={{ name: admin.name, email: admin.email, avatarUrl: admin.avatarUrl, isSuperAdmin: admin.isSuperAdmin }}
      brand={{ name: brand.name, logoUrl: brand.logoUrl }}
      // The guard above means this layout is never rendered mid-impersonation;
      // the banner that displays impersonation state lives with the manager
      // shell, where an impersonating admin actually is.
      impersonating={null}
    >
      {children}
    </AdminShell>
  );
}
