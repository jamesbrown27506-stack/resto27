import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Reads cookies itself rather than taking a cookie store as an argument — the
 * dashboard boilerplate passes one in, which forces every call site to import
 * `cookies` too and makes it easy to hand in a stale store.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A NOTE ON `getUser()` vs `getSession()`
 *
 *  `getSession()` reads the JWT out of the cookie and decodes it. It does not
 *  verify anything — a cookie can be forged. `getUser()` calls the Supabase
 *  auth server and verifies.
 *
 *  On the server, ALWAYS use `getUser()`. This matters more here than in most
 *  apps: this is a multi-tenant system where the difference between two users
 *  is the difference between two restaurants' revenue.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. Safe to ignore because the
            // middleware refreshes the session on every request — if that
            // middleware is ever removed, sessions silently stop refreshing
            // and users get logged out after an hour with no error anywhere.
          }
        },
      },
    },
  );
}

/**
 * Admin client — BYPASSES RLS ENTIRELY.
 *
 * For the handful of operations that legitimately act outside a user's
 * permissions: the SebPay webhook (unauthenticated by definition), the
 * reconciler cron, and platform-admin operations on other tenants' rows.
 *
 * Throws rather than falling back if the key is absent, because a silent
 * fallback to the publishable key would make privileged writes fail in ways
 * that look like RLS bugs.
 */
/** The value shipped in .env.local, which must be swapped for a real key. */
const SECRET_PLACEHOLDER = "sb_secret_REPLACE_ME_FROM_SUPABASE_DASHBOARD";

export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;

  /**
   * Fail with a message that names the actual problem.
   *
   * Handing an unset or placeholder key to Supabase gets you "Invalid API key"
   * from the other end of a network call — which reads like a wrong key, a
   * revoked key or a broken project, and sends you looking in the wrong place.
   * The three cases below are all detectable locally, so they are.
   */
  if (!key || key.trim() === "") {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set in .env.local. " +
        "Get it from Supabase → Settings → API keys → Secret keys, then restart the dev server.",
    );
  }

  if (key === SECRET_PLACEHOLDER || key.includes("REPLACE_ME")) {
    throw new Error(
      "SUPABASE_SECRET_KEY is still the placeholder from .env.local. " +
        "Replace it with the real key from Supabase → Settings → API keys → Secret keys, " +
        "then RESTART the dev server — Next only reads .env.local at startup.",
    );
  }

  if (!key.startsWith("sb_secret_") && !key.startsWith("eyJ")) {
    throw new Error(
      `SUPABASE_SECRET_KEY does not look like a Supabase key (starts with "${key.slice(0, 12)}…"). ` +
        'Expected the "Secret key" (sb_secret_…), not the publishable key and not the project URL.',
    );
  }

  /**
   * New `sb_secret_…` keys are API keys, not JWTs. supabase-js currently puts
   * its fallback credential in both `apikey` and `Authorization: Bearer` for
   * PostgREST calls. Some Supabase gateway paths try to interpret that opaque
   * Bearer value as a JWT; in this project that intermittently returned
   * "JWT issued at future". A failed subscription lookup then looked exactly
   * like "this user has no phone", and push was silently skipped.
   *
   * Keep the secret in the correct `apikey` header and remove ONLY the exact
   * invalid fallback Bearer value. A real user access token, should a future
   * caller explicitly provide one, is left untouched.
   */
  const fetchWithApiKeyOnly: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    return fetch(input, { ...init, headers });
  };

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchWithApiKeyOnly },
  });
}
