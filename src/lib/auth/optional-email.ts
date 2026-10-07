import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { emailVerificationRequired } from "./email-policy";

/** Called only after Auth refuses password sign-in with email_not_confirmed. */
export async function confirmOptionalEmailAccount(email: string): Promise<"confirmed" | "required" | "unavailable"> {
  const normalized = email.trim().toLowerCase();
  const admin = createAdminClient();
  const { data: profile, error } = await admin.from("profiles").select("auth_user_id, role, status, deleted_at").eq("email", normalized).maybeSingle();
  if (error) return "unavailable";
  if (!profile || profile.deleted_at || profile.status === "suspended" || !["customer", "manager", "admin"].includes(profile.role)) return "required";
  try { if (await emailVerificationRequired(profile.role)) return "required"; } catch { return "unavailable"; }
  const account = await admin.auth.admin.getUserById(profile.auth_user_id);
  if (account.error) return "unavailable";
  if (account.data.user?.email?.trim().toLowerCase() !== normalized) return "required";
  const updated = await admin.auth.admin.updateUserById(profile.auth_user_id, { email_confirm: true });
  // This only permits password sign-in. It NEVER creates mailbox ownership
  // proof: invitations, optional MFA setup and recovery still verify access.
  return updated.error ? "unavailable" : "confirmed";
}
