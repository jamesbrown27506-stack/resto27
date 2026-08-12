import { getCurrentProfile } from "./session";
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
  const profile = await getCurrentProfile();
  if (!profile) return null;

  return {
    name: profile.name,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
    homeHref:
      profile.role === "admin" ? "/a" : profile.role === "manager" ? "/m" : "/account",
  };
}
