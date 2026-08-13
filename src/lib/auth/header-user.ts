import { getCurrentProfile } from "./session";
import { getImpersonation } from "./impersonation";
import type { HeaderUser } from "@/components/layout/site-header";

/**
 * The signed-in user, shaped for the header.
 *
 * Uses `getCurrentProfile` rather than `getActiveProfile`: a pending or
 * suspended account should still see its own name in the header while the page
 * it tried to reach explains why it was refused. Bouncing them to an anonymous
 * header as well would make it look like the sign-in silently failed.
 */
export async function getHeaderUser(): Promise<HeaderUser | null> {
  const [profile, impersonation] = await Promise.all([getCurrentProfile(), getImpersonation()]);
  if (!profile) return null;

  // While impersonating, "my area" is the tenant's — the admin's own /a would
  // bounce straight back out anyway (see the admin layout guard). `area` and
  // `homeHref` are therefore derived together and always agree.
  const area: HeaderUser["area"] = impersonation
    ? "manager"
    : profile.role === "admin"
      ? "admin"
      : profile.role === "manager"
        ? "manager"
        : "customer";

  return {
    name: profile.name,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
    area,
    homeHref: area === "admin" ? "/a" : area === "manager" ? "/m" : "/account",
  };
}
