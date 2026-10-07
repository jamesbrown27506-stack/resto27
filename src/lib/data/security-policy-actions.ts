"use server";
import { revalidatePath } from "next/cache";
import { superAdminOrError } from "@/lib/auth/session";
import { EMAIL_POLICY_KEY, isEmailVerificationPolicy, type EmailVerificationPolicy } from "@/lib/auth/email-policy-rules";
import { createAdminClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import type { ActionResult } from "./admin-actions";

export async function saveEmailVerificationPolicy(policy: EmailVerificationPolicy): Promise<ActionResult> {
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  if (!isEmailVerificationPolicy(policy)) return { ok: false, error: "Choose a verification requirement for each account type." };
  const { error } = await createAdminClient().from("settings").upsert({
    key: EMAIL_POLICY_KEY, value: JSON.stringify(policy), value_type: "json", category: "security",
    label: "Email verification by account type", description: "Require verified email before account access.",
  }, { onConflict: "key" });
  if (error) return { ok: false, error: "Could not save email verification settings. Please try again." };
  await writeAudit(gate.admin, { action: "settings.email_verification", entityType: "settings", summary: "Changed email verification requirements", metadata: policy });
  revalidatePath("/", "layout");
  return { ok: true };
}
