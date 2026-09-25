import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export interface WalletLedgerRow {
  id: string;
  /** Signed XAF: positive = credited to the customer, negative = spent. */
  amount: number;
  kind: "refund" | "payment" | "adjustment" | string;
  reference: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface CustomerWalletOverview {
  /** False when migration 0051 is not applied (or the read failed). */
  available: boolean;
  balance: number;
  recent: WalletLedgerRow[];
}

/**
 * The customer's Resto237 wallet: balance plus the latest ledger rows.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  REFUNDS WERE BEING CREDITED WHERE NOBODY COULD SEE THEM.
 *
 *  A cancelled order paid from the wallet is refunded to the wallet (0051,
 *  and the auto-cancel refunds of 0059), but the only place the balance was
 *  ever shown was the checkout's payment button. A customer told "vous êtes
 *  remboursé" opened their account, found nothing, and concluded the money
 *  was gone. The account page now shows the balance and the movements.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Read with the admin client, scoped explicitly to the signed-in profile the
 * CALLER resolved (requireUser) — never to an id from the request. Tolerates
 * a database without 0051: `available: false`, and the card explains itself
 * instead of the page failing.
 */
export async function fetchCustomerWalletOverview(profileId: string, limit = 5): Promise<CustomerWalletOverview> {
  const db = createAdminClient();
  const [wallet, ledger] = await Promise.all([
    db.from("customer_wallets").select("balance").eq("profile_id", profileId).maybeSingle(),
    db.from("customer_wallet_ledger")
      .select("id, amount, kind, reference, balance_after, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (wallet.error || ledger.error) {
    console.warn("[customer:walletOverview]", wallet.error?.message ?? ledger.error?.message);
    return { available: false, balance: 0, recent: [] };
  }

  const rows = (ledger.data ?? []) as {
    id: string;
    amount: number;
    kind: string;
    reference: string | null;
    balance_after: number;
    created_at: string;
  }[];

  return {
    available: true,
    balance: Number(wallet.data?.balance ?? 0),
    recent: rows.map((row) => ({
      id: row.id,
      amount: Number(row.amount) || 0,
      kind: row.kind,
      reference: row.reference,
      balanceAfter: Number(row.balance_after) || 0,
      createdAt: row.created_at,
    })),
  };
}
