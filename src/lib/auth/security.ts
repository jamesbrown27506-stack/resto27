import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { hasVerifiedMailbox, sessionIdentity } from "./security-rules";

const RECOVERY_COOKIE = "restolink-recovery";
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export async function recordMailboxProof(user: User): Promise<void> {
  if (!user.email) throw new Error("Email ownership could not be verified.");
  const { error } = await createAdminClient().auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, security_email: user.email.trim().toLowerCase(), security_email_verified_at: new Date().toISOString() },
  });
  if (error) throw new Error("Email verification could not be saved.");
}

export async function requireAccountAssurance(user: User, requireEmail: boolean): Promise<void> {
  if (requireEmail && !hasVerifiedMailbox(user)) redirect("/security?step=email");
  // Enrollment is optional for every role. Only a VERIFIED factor enables
  // two-step sign-in; abandoning setup must not lock someone out. Read the
  // factors from getUser(), not browser-editable metadata or stale JWT claims.
  if (!user.factors?.some(factor => factor.status === "verified")) return;
  const { data, error } = await (await createClient()).auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || data?.currentLevel !== "aal2") redirect("/security?step=mfa");
}

/** A recovery session alone is not a recovery grant. Bind a single-use secret to it. */
export async function issueRecoveryGrant(session: Session): Promise<void> {
  const identity = sessionIdentity(session.access_token);
  if (!identity || identity.userId !== session.user.id) throw new Error("Invalid recovery session.");
  const token = randomBytes(32).toString("base64url");
  const { error } = await createAdminClient().from("account_recovery_grants")
    .insert({ token_hash: digest(token), auth_user_id: identity.userId, session_id: identity.sessionId, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
  if (error) throw new Error("Recovery verification is unavailable. Request a new code after the service is restored.");
  (await cookies()).set(RECOVERY_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
}

export async function consumeRecoveryGrant(userId: string, sessionId: string): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(RECOVERY_COOKIE)?.value;
  jar.delete(RECOVERY_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const { data, error } = await createAdminClient().rpc("consume_recovery_grant", { p_token_hash: digest(token), p_auth_user_id: userId, p_session_id: sessionId });
  return !error && data === true;
}
