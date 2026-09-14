import type { RejectionReason } from "./session";

/**
 * Why Supabase refused a sign-in, as the reason the login screen explains.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  EVERY FAILURE USED TO READ "IDENTIFIANTS INCORRECTS".
 *
 *  On 14 Sep 2026 Supabase answered 504 for about two minutes, and every
 *  person who tried to sign in was told their password was wrong. They
 *  retyped correct passwords, reset them, and concluded the accounts were
 *  broken. A wrong password and a service that did not answer are different
 *  facts with different fixes, and the screen now says which one it was.
 *
 *  This is not an account-enumeration leak: only `invalid` is returned
 *  before the credentials are known to be right, and it is returned for a
 *  wrong password and an unknown email alike.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pure — takes the error's shape rather than the class — so it is tested
 * without Supabase.
 */
export function signInFailureReason(
  error: { status?: number; code?: string; name?: string } | null | undefined,
): RejectionReason {
  if (!error) return "invalid";

  if (error.code === "invalid_credentials") return "invalid";
  if (error.code === "email_not_confirmed") return "unconfirmed";
  if (error.status === 429 || error.code?.startsWith("over_")) return "busy";

  // Timeouts, 5xx and fetch failures (supabase-js reports those as status 0
  // or an AuthRetryableFetchError) — nothing was decided about the password.
  if (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    (error.status !== undefined && error.status >= 500)
  ) {
    return "unavailable";
  }

  // Any other 4xx is Supabase refusing these credentials.
  return "invalid";
}
