import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveProfile, getSessionUser } from "@/lib/auth/session";
import { hasVerifiedMailbox } from "@/lib/auth/security-rules";
import { safeNextPath } from "@/lib/auth/safe-next";
import { SecurityClient } from "./security-client";
import { emailVerificationRequired } from "@/lib/auth/email-policy";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const active = await getActiveProfile();
  const user = await getSessionUser();
  if (!active.profile || !user?.email) redirect("/login?reason=invalid");
  const supabase = await createClient();
  const [assurance, params] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), searchParams]);
  const next = safeNextPath(params.next);
  const fallback = active.profile.role === "admin" ? "/a" : active.profile.role === "manager" ? "/m" : "/account";
  return <SecurityClient email={user.email} verified={hasVerifiedMailbox(user)}
    factors={user.factors?.filter(f => f.status === "verified" && f.factor_type === "totp").map(f => ({ id: f.id, name: f.friendly_name || "Authenticator" })) ?? []}
    assured={!assurance.error && assurance.data?.currentLevel === "aal2"}
    emailRequired={await emailVerificationRequired(active.profile.role)}
    next={next && !next.startsWith("/security") ? next : fallback} />;
}
