import type { User } from "@supabase/supabase-js";

/** Only app_metadata written after an actual email OTP establishes ownership. */
export function hasVerifiedMailbox(user: Pick<User, "email" | "app_metadata"> | null): boolean {
  const verified = user?.app_metadata?.security_email;
  const at = user?.app_metadata?.security_email_verified_at;
  return typeof verified === "string" && typeof at === "string" && Number.isFinite(Date.parse(at))
    && Boolean(user?.email) && verified === user!.email!.trim().toLowerCase();
}

export function hasFreshMailboxProof(user: Pick<User, "email" | "app_metadata"> | null, now = Date.now()): boolean {
  if (!hasVerifiedMailbox(user)) return false;
  const age = now - Date.parse(user!.app_metadata.security_email_verified_at);
  return age >= 0 && age <= 10 * 60_000;
}

/** Tokens here come from a verified Auth response, never a request parameter. */
export function sessionIdentity(accessToken: string): { userId: string; sessionId: string; recentOtp: boolean } | null {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
    if (typeof claims.sub !== "string" || typeof claims.session_id !== "string") return null;
    const recentOtp = Array.isArray(claims.amr) && claims.amr.some((entry: { method?: string; timestamp?: number }) =>
      ["otp", "recovery"].includes(entry.method ?? "") && typeof entry.timestamp === "number"
      && Date.now() / 1000 - entry.timestamp >= -30 && Date.now() / 1000 - entry.timestamp <= 120);
    return { userId: claims.sub, sessionId: claims.session_id, recentOtp };
  } catch { return null; }
}
