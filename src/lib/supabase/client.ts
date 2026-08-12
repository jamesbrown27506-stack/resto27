import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components.
 *
 * Uses the PUBLISHABLE key, which is public by design — it is in the JS
 * bundle. Everything this client can reach is therefore protected by RLS and
 * by RLS alone (B.1). Never put the secret key here.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
