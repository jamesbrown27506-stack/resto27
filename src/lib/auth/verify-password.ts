import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { signInFailureReason } from "@/lib/auth/sign-in-failure";

/**
 * Re-check a signed-in person's account password — before setting a
 * withdrawal PIN, and before changing the password itself.
 *
 * On a throwaway client that keeps no session and touches no cookie, so the
 * browser's own session is never replaced; the session this sign-in opens
 * is closed again at once (`scope: "local"` ends only that one).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE ADDRESS COMES FROM THE AUTH ACCOUNT, AND THE ACCOUNT THAT SIGNS IN
 *  MUST BE THE CALLER'S OWN (security review 2026-10-05).
 *
 *  It used to take `profiles.email`, which a user could edit through the
 *  REST API (until 0076): point it at an account you control, give that
 *  account's password, and you had set the victim's PIN from their
 *  unlocked phone. Only the auth user id is trusted here.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function verifyAccountPassword(
  authUserId: string,
  password: string,
): Promise<"ok" | "wrong" | "unavailable"> {
  if (!password) return "wrong";

  const { data: account, error: lookupError } = await createAdminClient().auth.admin.getUserById(authUserId);
  const email = account?.user?.email;
  if (lookupError || !email) return "unavailable";

  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return signInFailureReason(error) === "invalid" ? "wrong" : "unavailable";
  }
  const same = data.user?.id === authUserId;
  await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  return same ? "ok" : "wrong";
}
