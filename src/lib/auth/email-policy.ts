import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";
import { EMAIL_POLICY_KEY, parseEmailVerificationPolicy } from "./email-policy-rules";
import type { UserRole } from "@/lib/session";

// Request-scoped only: changing the policy applies to existing sessions on
// their next protected request as well as to signup and login.
export const getEmailVerificationPolicy = cache(async () => {
  const { data, error } = await createAdminClient().from("settings").select("value").eq("key", EMAIL_POLICY_KEY).maybeSingle();
  if (error) throw new Error("Account security settings are temporarily unavailable.");
  return parseEmailVerificationPolicy(data?.value);
});
export async function emailVerificationRequired(role: UserRole): Promise<boolean> {
  return (await getEmailVerificationPolicy())[role];
}
