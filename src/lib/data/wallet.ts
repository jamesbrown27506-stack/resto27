import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Wallet reads (migration 0024).
 *
 * The balance lives in `restaurant_wallets`, every change in `wallet_ledger`,
 * and withdrawals in `withdrawal_requests`. All service-role reads — the
 * tenant boundary is enforced by the caller (a manager sees only their own
 * branch; an admin sees everything).
 */

export interface WalletLedgerRow {
  id: string;
  amount: number;
  kind: string;
  note: string | null;
  reference: string | null;
  createdAt: string;
}

export interface WalletRequestRow {
  id: string;
  amount: number;
  phone: string;
  status: "pending" | "paid" | "rejected";
  note: string | null;
  fee: number | null;
  net: number | null;
  requestedAt: string;
  decidedAt: string | null;
  replyTo: string | null;
}

export interface WalletState {
  balance: number;
  ledger: WalletLedgerRow[];
  requests: WalletRequestRow[];
}

/** One branch's wallet: the balance and everything that explains it. */
export async function getWalletState(restaurantId: string): Promise<WalletState> {
  const supabase = createAdminClient();

  const [balanceResult, ledgerResult, requestsResult] = await Promise.all([
    supabase.from("restaurant_wallets").select("balance").eq("restaurant_id", restaurantId).maybeSingle(),
    supabase
      .from("wallet_ledger")
      .select("id, amount, kind, note, reference, created_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("withdrawal_requests")
      .select("id, amount, phone, status, note, fee, net, reply_to, requested_at, decided_at")
      .eq("restaurant_id", restaurantId)
      .order("requested_at", { ascending: false })
      .limit(20),
  ]);

  if (balanceResult.error || ledgerResult.error || requestsResult.error) {
    console.warn(
      "[wallet:getWalletState]",
      balanceResult.error?.message ?? ledgerResult.error?.message ?? requestsResult.error?.message ?? "",
    );
    return { balance: 0, ledger: [], requests: [] };
  }

  return {
    balance: Number((balanceResult.data as { balance: number } | null)?.balance ?? 0),
    ledger: ((ledgerResult.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      amount: Number(r.amount),
      kind: String(r.kind),
      note: (r.note as string | null) ?? null,
      reference: (r.reference as string | null) ?? null,
      createdAt: String(r.created_at),
    })),
    requests: ((requestsResult.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      amount: Number(r.amount),
      phone: String(r.phone),
      status: r.status as WalletRequestRow["status"],
      note: (r.note as string | null) ?? null,
      fee: r.fee === null ? null : Number(r.fee),
      net: r.net === null ? null : Number(r.net),
      requestedAt: String(r.requested_at),
      decidedAt: (r.decided_at as string | null) ?? null,
      replyTo: (r.reply_to as string | null) ?? null,
    })),
  };
}

export interface AdminWithdrawalRequest {
  id: string;
  restaurantId: string;
  restaurantName: string;
  requestedByName: string | null;
  amount: number;
  phone: string;
  status: "pending" | "paid" | "rejected";
  note: string | null;
  fee: number | null;
  net: number | null;
  requestedAt: string;
  decidedAt: string | null;
  replyTo: string | null;
}

/** Every withdrawal request, newest first — for the /a/wallet inbox. */
export async function listWithdrawalRequests(limit = 50): Promise<AdminWithdrawalRequest[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("withdrawal_requests")
    .select(
      `id, restaurant_id, amount, phone, status, note, fee, net, requested_at, decided_at,
       reply_to,
       restaurants ( name ),
       profiles ( name )`,
    )
    .order("requested_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[wallet:listWithdrawalRequests]", error.message);
    return [];
  }

  return ((data ?? []) as unknown as {
    id: string;
    restaurant_id: string;
    amount: number;
    phone: string;
    status: string;
    note: string | null;
    fee: number | null;
    net: number | null;
    requested_at: string;
    decided_at: string | null;
    reply_to: string | null;
    restaurants: { name: string }[] | null;
    profiles: { name: string }[] | null;
  }[]).map((r) => ({
    id: r.id,
    restaurantId: r.restaurant_id,
    restaurantName: r.restaurants?.[0]?.name ?? "—",
    requestedByName: r.profiles?.[0]?.name ?? null,
    amount: Number(r.amount),
    phone: r.phone,
    status: r.status as AdminWithdrawalRequest["status"],
    note: r.note,
    fee: r.fee === null ? null : Number(r.fee),
    net: r.net === null ? null : Number(r.net),
    requestedAt: r.requested_at,
    decidedAt: r.decided_at,
    replyTo: r.reply_to,
  }));
}
