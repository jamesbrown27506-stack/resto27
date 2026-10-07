import type { UserRole } from "@/lib/session";

export const EMAIL_POLICY_KEY = "email_verification_roles";
export type EmailVerificationPolicy = Record<UserRole, boolean>;
export const DEFAULT_EMAIL_POLICY: EmailVerificationPolicy = { admin: true, manager: true, customer: false };
export function isEmailVerificationPolicy(value: unknown): value is EmailVerificationPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 3 && ["admin", "manager", "customer"].every(role => typeof record[role] === "boolean");
}
export function parseEmailVerificationPolicy(value: string | null | undefined): EmailVerificationPolicy {
  if (value == null) return { ...DEFAULT_EMAIL_POLICY };
  try { const parsed: unknown = JSON.parse(value); if (isEmailVerificationPolicy(parsed)) return parsed; } catch { /* Invalid configuration fails closed. */ }
  return { admin: true, manager: true, customer: true };
}
