import "server-only";
import { can, type BranchRole } from "@/lib/capabilities";
import { createAdminClient } from "@/lib/supabase/server";
import { ordersInProgressHold } from "@/lib/data/wallet";
import type { BranchWalletSummary } from "@/lib/wallet/summary";

/** Caller supplies a server-verified membership, never a browser-supplied role. */
export async function readBranchWalletSummary(branch: {
  restaurantId: string;
  role: BranchRole;
}): Promise<BranchWalletSummary | null> {
  // This guard also keeps non-finance layouts from querying or serializing money.
  if (!can(branch.role, "finance.manage")) return null;
  const checkedAt = new Date().toISOString();
  const unavailable: BranchWalletSummary = { restaurantId: branch.restaurantId, available: null, held: null, checkedAt };
  try {
    const [wallet, held] = await Promise.all([
      createAdminClient().from("restaurant_wallets").select("balance")
        .eq("restaurant_id", branch.restaurantId).maybeSingle(),
      ordersInProgressHold(branch.restaurantId),
    ]);
    const balance = wallet.data ? wallet.data.balance : 0;
    if (wallet.error || !Number.isSafeInteger(balance) || !Number.isSafeInteger(held) || held < 0) {
      console.warn("[wallet:summary]", wallet.error?.code ?? "invalid_balance");
      return unavailable;
    }
    return { restaurantId: branch.restaurantId, available: Math.max(0, balance - held), held, checkedAt };
  } catch {
    console.warn("[wallet:summary] unavailable");
    return unavailable;
  }
}
