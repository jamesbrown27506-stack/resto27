"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveProfile, getSessionUser } from "./session";
import { recordMailboxProof } from "./security";
import { hasFreshMailboxProof, hasVerifiedMailbox } from "./security-rules";
import { rateLimit } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site-url";

export type SecurityResult = { ok: boolean; error?: "identity" | "rate" | "unavailable" | "code" | "recentEmail" | "alreadyEnrolled" | "authenticatorRequired"; qrCode?: string; secret?: string; factorId?: string };

export async function sendOwnEmailCode(): Promise<SecurityResult> {
  const active = await getActiveProfile();
  const user = await getSessionUser();
  if (!active.profile || !user?.email) return { ok: false, error: "identity" };
  if (!(await rateLimit({ key: "security:email-send", identifier: user.id, limit: 3, windowMs: 60 * 60_000, failClosed: true })).ok) return { ok: false, error: "rate" };
  const { error } = await (await createClient()).auth.signInWithOtp({ email: user.email, options: { shouldCreateUser: false, emailRedirectTo: `${await siteUrl()}/auth/callback?next=/security` } });
  return error ? { ok: false, error: "unavailable" } : { ok: true };
}

export async function verifyOwnEmailCode(code: string): Promise<SecurityResult> {
  const active = await getActiveProfile();
  const user = await getSessionUser();
  code = code.trim().replace(/[\s-]/g, "");
  if (!active.profile || !user?.email || !/^\d{6,10}$/.test(code)) return { ok: false, error: "code" };
  if (!(await rateLimit({ key: "security:email-check", identifier: user.id, limit: 5, windowMs: 15 * 60_000, failClosed: true })).ok) return { ok: false, error: "rate" };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: user.email, token: code, type: "email" });
  if (error || data.user?.id !== user.id || data.user.email?.toLowerCase() !== user.email.toLowerCase()) return { ok: false, error: "code" };
  try { await recordMailboxProof(data.user); } catch { return { ok: false, error: "unavailable" }; }
  return { ok: true };
}

export async function enrollOwnAuthenticator(): Promise<SecurityResult> {
  const active = await getActiveProfile();
  const user = await getSessionUser();
  if (!active.profile || !user || !hasFreshMailboxProof(user)) return { ok: false, error: "recentEmail" };
  if (!(await rateLimit({ key: "security:mfa-enroll", identifier: user.id, limit: 3, windowMs: 60 * 60_000, failClosed: true })).ok) return { ok: false, error: "rate" };
  const supabase = await createClient();
  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) return { ok: false, error: "unavailable" };
  // A first-factor session may not replace or add to an enrolled factor.
  if (factors.data.all.some(f => f.status === "verified")) return { ok: false, error: "alreadyEnrolled" };
  for (const factor of factors.data.all.filter(f => f.status === "unverified")) {
    const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (removed.error) return { ok: false, error: "unavailable" };
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Resto237" });
  return error ? { ok: false, error: "unavailable" } : { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyOwnAuthenticator(factorId: string, code: string): Promise<SecurityResult> {
  const active = await getActiveProfile();
  const user = await getSessionUser();
  if (!active.profile || !user || !hasVerifiedMailbox(user)) return { ok: false, error: "identity" };
  code = code.trim().replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "code" };
  if (!(await rateLimit({ key: "security:mfa-check", identifier: user.id, limit: 5, windowMs: 15 * 60_000, failClosed: true })).ok) return { ok: false, error: "rate" };
  const supabase = await createClient();
  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error || !factors.data.all.some(f => f.id === factorId && f.factor_type === "totp")) return { ok: false, error: "identity" };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  return error ? { ok: false, error: "code" } : { ok: true };
}

export async function disableOwnAuthenticator(): Promise<SecurityResult> {
  const active = await getActiveProfile();
  const user = await getSessionUser();
  if (!active.profile || !user) return { ok: false, error: "identity" };
  const supabase = await createClient();
  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) return { ok: false, error: "unavailable" };
  // A stolen password must not let someone turn off the owner's chosen 2FA.
  if (assurance.data?.currentLevel !== "aal2") return { ok: false, error: "authenticatorRequired" };
  if (!(await rateLimit({ key: "security:mfa-disable", identifier: user.id, limit: 3, windowMs: 60 * 60_000, failClosed: true })).ok) return { ok: false, error: "rate" };
  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) return { ok: false, error: "unavailable" };
  for (const factor of factors.data.all.filter(f => f.factor_type === "totp")) {
    const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (removed.error) return { ok: false, error: "unavailable" };
  }
  return { ok: true };
}
