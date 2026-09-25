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
  /** Everything credited to the wallet, including money still held for orders. */
  balance: number;
  /**
   * The restaurant's share of online-paid orders not yet delivered. It is in
   * the balance but cannot be withdrawn until the food arrives — a cancelled
   * paid order is refunded from it (see ordersInProgressHold).
   */
  heldForOrders: number;
  grossIncome: number;
  paymentFees: number;
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
  const { data, error } = await createAdminClient()
    .from("orders")
    .select("total, service_charge")
    .eq("restaurant_id", restaurantId)
    .eq("is_paid", true)
    .in("payment_method", ["mobile_money", "wallet"])
    .in("status", ["confirmed", "preparing", "shipped"]);
  if (error) {
    console.error("[wallet:hold]", error.message);
    return 0;
  }
  const orders = ((data ?? []) as { total: number; service_charge: number | null }[]).reduce(
    (sum, o) => sum + Math.max(0, Number(o.total) - Number(o.service_charge ?? 0)),
    0,
  );

  // Same reasoning for a deposit paid ONLINE on a booking still to come: the
  // restaurant may cancel it (full refund, 0060) or the customer may (0050),
  // and both debit the wallet. Cash deposits never entered the wallet.
  const { data: bookings } = await createAdminClient()
    .from("reservations")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("status", "confirmed")
    .eq("deposit_paid", true)
    .gt("reserved_for", new Date().toISOString());
  const ids = ((bookings ?? []) as { id: string }[]).map((b) => b.id);
  let deposits = 0;
  if (ids.length > 0) {
    const { data: attempts } = await createAdminClient()
      .from("payment_attempts")
      .select("reservation_id, amount")
      .in("reservation_id", ids)
      .eq("status", "succeeded");
    const perBooking = new Map<string, number>();
    for (const a of (attempts ?? []) as { reservation_id: string; amount: number }[]) {
      perBooking.set(a.reservation_id, Math.max(perBooking.get(a.reservation_id) ?? 0, Number(a.amount)));
    }
    deposits = [...perBooking.values()].reduce((sum, n) => sum + n, 0);
  }

  return orders + deposits;
}

/** One branch's wallet: the balance and everything that explains it. */
export async function getWalletState(restaurantId: string): Promise<WalletState> {
  const supabase = createAdminClient();

  const [balanceResult, ledgerResult, requestsResult, ordersResult, commissionsResult] = await Promise.all([
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
    // Cancelled paid orders were refunded; they are not income.
    supabase.from("orders").select("subtotal, discount_amount, service_charge").eq("restaurant_id", restaurantId).eq("is_paid", true).neq("status", "cancelled"),
    supabase.from("commission_statements").select("commission_amount, status").eq("restaurant_id", restaurantId).in("status", ["draft", "issued"]),
  ]);
  const heldForOrders = await ordersInProgressHold(restaurantId);

  if (balanceResult.error || ledgerResult.error || requestsResult.error) {
    console.warn(
      "[wallet:getWalletState]",
      balanceResult.error?.message ?? ledgerResult.error?.message ?? requestsResult.error?.message ?? "",
    );
    return { balance: 0, heldForOrders: 0, grossIncome: 0, paymentFees: 0, commissionDue: 0, estimatedNetIncome: 0, ledger: [], requests: [] };
  }

  const balance = Number((balanceResult.data as { balance: number } | null)?.balance ?? 0);
  const paidOrders = (ordersResult.data ?? []) as { subtotal: number; discount_amount: number; service_charge: number }[];
  // Food only: the delivery fee is paid in cash to the rider and never passes
  // through the wallet (0059).
  const grossIncome = paidOrders.reduce((sum, order) => sum + Math.max(0, Number(order.subtotal) - Number(order.discount_amount)), 0);
  const paymentFees = paidOrders.reduce((sum, order) => sum + Number(order.service_charge), 0);
  const commissionDue = ((commissionsResult.data ?? []) as { commission_amount: number }[]).reduce((sum, statement) => sum + Number(statement.commission_amount), 0);

  return {
    balance,
    heldForOrders,
    grossIncome,
    paymentFees,
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
