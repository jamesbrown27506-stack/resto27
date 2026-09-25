import "server-only";

import { createAdminClient } from "@/lib/supabase/server";

/**
 * The admin's refund switch (0062): true → customer refunds are credited to
 * their Resto237 wallet; false (default, and when the row is missing) → sent
 * back to their Mobile Money number. Read fresh — the admin can flip it live.
 */
export async function refundsGoToWallet(): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("settings")
    .select("value")
    .eq("key", "refunds_to_wallet")
    .maybeSingle();
  if (error) console.error("[settings:refundsToWallet]", error.message);
  return (data?.value ?? "false") === "true";
}
