import { AdminShell } from "@/components/layout/admin-shell";
import { requireRole } from "@/lib/auth/session";
import { getImpersonation } from "@/lib/auth/impersonation";
import { getBranding } from "@/lib/branding";

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

  return (
    <AdminShell
      user={{ name: admin.name, email: admin.email, avatarUrl: admin.avatarUrl }}
      brand={{ name: brand.name, logoUrl: brand.logoUrl }}
      impersonating={
        impersonating
          ? {
              adminName: impersonating.adminName,
              targetName:
                impersonating.branchLabel && impersonating.branchLabel !== "Principal"
                  ? `${impersonating.restaurantName} — ${impersonating.branchLabel}`
                  : impersonating.restaurantName,
            }
          : null
      }
    >
      {children}
    </AdminShell>
  );
}
