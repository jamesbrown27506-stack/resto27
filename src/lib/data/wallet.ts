import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { summarizeLedger, type LedgerEntry, type WalletBreakdown } from "@/lib/wallet/breakdown";

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
  /** Who asked for it, as what (0073) — the owner's monitoring. */
  requestedByName: string | null;
  requesterRole: string | null;
  /** The Mobile Money account holder it went to, as the operator named it. */
  recipientName: string | null;
}

/** A Supabase many-to-one embed comes back as an object; tolerate an array. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export interface WalletState {
  /** Everything credited to the wallet, including money still held for orders. */
  balance: number;
  /**
   * The restaurant's share of online-paid orders not yet delivered. It is in
   * the balance but cannot be withdrawn until the food arrives — a cancelled
   * paid order is refunded from it (see ordersInProgressHold).
   */
  heldForOrders: number;
  /**
   * Where the balance came from, read off the whole ledger — orders, table
   * bills, reservation deposits, refunds, withdrawals, credits. The buckets
   * sum to the balance (lib/wallet/breakdown.ts). The platform's own payment
   * fee is not among them: it never reaches the restaurant's wallet, and it
   * is not the restaurant's line to read.
   */
  breakdown: WalletBreakdown;
  commissionDue: number;
  estimatedNetIncome: number;
  ledger: WalletLedgerRow[];
  requests: WalletRequestRow[];
}

/**
 * Money credited for orders that are paid but not delivered yet, and for
 * online deposits on bookings still to come.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A paid order credits the restaurant at payment (0053), and a paid order
 *  can now be cancelled with a full refund (0059) — which debits that credit
 *  back. If the restaurant had already withdrawn it, the refund would fail
 *  with "insufficient balance" and the customer would be stuck again. So the
 *  share of every paid order still in the kitchen or on the road is held:
 *  in the balance, not withdrawable, released the moment it is delivered.
 *  Computed, not stored — nothing to keep in sync.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function ordersInProgressHold(restaurantId: string): Promise<number> {
  // The database also uses this reserve during the atomic payout claim.
  // Sharing the RPC prevents the UI from omitting platform-funded loyalty.
  const { data, error } = await createAdminClient().rpc("wallet_refund_hold", { p_restaurant_id: restaurantId });
  const held = Number(data);
  if (error || data === null || !Number.isSafeInteger(held) || held < 0) {
    console.error("[wallet:hold]", error?.code ?? "invalid_reserve");
    throw new Error("Refund reserves could not be verified.");
  }
  return held;
}

/**
 * Every ledger entry of one wallet, for the breakdown — paged, because the
 * API returns at most 1 000 rows a call and a busy restaurant has more.
 */
async function allLedgerEntries(restaurantId: string): Promise<LedgerEntry[]> {
  const supabase = createAdminClient();
  const PAGE = 1000;
  const entries: LedgerEntry[] = [];
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await supabase
      .from("wallet_ledger")
      .select("amount, kind, note, reference")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[wallet:ledgerEntries]", error.message);
      break;
    }
    entries.push(...((data ?? []) as LedgerEntry[]));
    if ((data ?? []).length < PAGE) break;
  }
  return entries;
}

/** One branch's wallet: the balance and everything that explains it. */
export async function getWalletState(restaurantId: string): Promise<WalletState> {
  const supabase = createAdminClient();

  const [balanceResult, ledgerResult, requestsResult, entries, commissionsResult] = await Promise.all([
    supabase.from("restaurant_wallets").select("balance").eq("restaurant_id", restaurantId).maybeSingle(),
    supabase
      .from("wallet_ledger")
      .select("id, amount, kind, note, reference, created_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(25),
    // `*` so who-and-to-whom (0073) is read when it exists and skipped when not.
    supabase
      .from("withdrawal_requests")
      .select("*, profiles!requested_by ( name )")
      .eq("restaurant_id", restaurantId)
      .order("requested_at", { ascending: false })
      .limit(20),
    allLedgerEntries(restaurantId),
    supabase.from("commission_statements").select("commission_amount, status").eq("restaurant_id", restaurantId).in("status", ["draft", "issued"]),
  ]);
  const heldForOrders = await ordersInProgressHold(restaurantId);

  if (balanceResult.error || ledgerResult.error || requestsResult.error) {
    console.warn(
      "[wallet:getWalletState]",
      balanceResult.error?.message ?? ledgerResult.error?.message ?? requestsResult.error?.message ?? "",
    );
    return {
      balance: 0,
      heldForOrders: 0,
      breakdown: summarizeLedger([]),
      commissionDue: 0,
      estimatedNetIncome: 0,
      ledger: [],
      requests: [],
    };
  }

  const balance = Number((balanceResult.data as { balance: number } | null)?.balance ?? 0);
  const commissionDue = ((commissionsResult.data ?? []) as { commission_amount: number }[]).reduce((sum, statement) => sum + Number(statement.commission_amount), 0);

  return {
    balance,
    heldForOrders,
    breakdown: summarizeLedger(entries),
    commissionDue,
    estimatedNetIncome: Math.max(0, balance - commissionDue),
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
      requestedByName: one(r.profiles as { name: string } | { name: string }[] | null)?.name ?? null,
      requesterRole: (r.requester_role as string | null) ?? null,
      recipientName: (r.recipient_name as string | null) ?? null,
    })),
  };
}

export interface AdminWithdrawalRequest {
  id: string;
  restaurantId: string;
  restaurantName: string;
  requestedByName: string | null;
  /** The requester's role at the branch at the time (0073). */
  requesterRole: string | null;
  recipientName: string | null;
  amount: number;
  phone: string;
  status: "pending" | "paid" | "rejected";
  note: string | null;
  fee: number | null;
  net: number | null;
  requestedAt: string;
  decidedAt: string | null;
  replyTo: string | null;
  /**
   * Debited, but whether the money reached the phone is unknown (the payout
   * call failed mid-way). Waits for a super admin's decision.
   */
  unresolved: boolean;
}

/** Every withdrawal request, newest first — for the /a/wallet inbox. */
export async function listWithdrawalRequests(limit = 50): Promise<AdminWithdrawalRequest[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("withdrawal_requests")
    // `*` so the requester's role and the recipient (0073) come back once
    // they exist.
    .select(`*, restaurants ( name, branch_label, is_primary ), profiles!requested_by ( name )`)
    // `!requested_by`: a request points at two profiles — who asked and who
    // decided — so the unnamed embed is ambiguous and the whole list came back
    // empty (PGRST201). The name shown is the requester's.
    .order("requested_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[wallet:listWithdrawalRequests]", error.message);
    return [];
  }

  type Restaurant = { name: string; branch_label: string; is_primary: boolean };
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
    requester_role?: string | null;
    recipient_name?: string | null;
    restaurants: Restaurant | Restaurant[] | null;
    profiles: { name: string } | { name: string }[] | null;
  }[]).map((r) => {
    // Many-to-one embeds are OBJECTS. Reading them as arrays (`[0]`) showed
    // every restaurant as "—" and every requester as nobody.
    const restaurant = one(r.restaurants);
    return {
      id: r.id,
      restaurantId: r.restaurant_id,
      restaurantName: restaurant
        ? restaurant.is_primary
          ? restaurant.name
          : `${restaurant.name} — ${restaurant.branch_label}`
        : "—",
      requestedByName: one(r.profiles)?.name ?? null,
      requesterRole: r.requester_role ?? null,
      recipientName: r.recipient_name ?? null,
      amount: Number(r.amount),
      phone: r.phone,
      status: r.status as AdminWithdrawalRequest["status"],
      note: r.note,
      fee: r.fee === null ? null : Number(r.fee),
      net: r.net === null ? null : Number(r.net),
      requestedAt: r.requested_at,
      decidedAt: r.decided_at,
      replyTo: r.reply_to,
      unresolved: r.status === "paid" && !r.reply_to && !r.decided_at,
    };
  });
}
