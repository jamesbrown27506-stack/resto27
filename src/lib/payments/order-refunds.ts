import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { releaseOrderHoldings } from "@/lib/orders/cancellation-effects";
import { startRefundPayout } from "@/lib/payments/refund-payouts";
import { refundsGoToWallet } from "@/lib/payments/refund-settings";

/**
 * Cancel an order the customer already paid for online, and refund them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Shared by the restaurant's cancel button and the admin console. The money
 *  side is ONE Postgres transaction (cancel_paid_order, migration 0059):
 *  order cancelled, restaurant debited what it was credited, platform fee
 *  reversed, refund row written. Only then does the Mobile Money payout
 *  start (refund-payouts.ts), which the reconciler finishes if this request
 *  dies half-way. Wallet-paid orders are credited back inside the
 *  transaction itself.
 *
 *  A plain server module — never a "use server" export — because it moves
 *  money. The callers are actions that have already checked who is asking.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type CancelPaidReason =
  | "insufficientBalance"
  | "notCancellable"
  | "migrationMissing"
  | "failed";

export interface CancelPaidResult {
  ok: boolean;
  reason?: CancelPaidReason;
  refundAmount?: number;
  refundTo?: "mobile_money" | "customer_wallet";
  refundStatus?: "pending" | "completed";
}

interface CancelClaim {
  orderId: string;
  reference: string;
  restaurantId: string;
  customerId: string | null;
  refundId: string | null;
  refundAmount: number;
  refundStatus: "pending" | "completed" | null;
  destination: "mobile_money" | "customer_wallet";
  alreadyCancelled: boolean;
}

export async function cancelPaidOrder(input: {
  orderId: string;
  actor: string;
  reason: string;
  restaurantName?: string;
  /** Who is cancelling — the customer's copy differs for support. */
  by: "restaurant" | "admin";
}): Promise<CancelPaidResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("cancel_paid_order", {
    p_order_id: input.orderId,
    p_actor: input.actor,
    p_reason: input.reason,
  });

  if (error) {
    console.error("[orders:cancelPaid]", input.orderId, error.code, error.message);
    if (error.message.includes("insufficient balance")) return { ok: false, reason: "insufficientBalance" };
    if (error.message.includes("order_not_cancellable") || error.message.includes("order_not_paid_online")) {
      return { ok: false, reason: "notCancellable" };
    }
    // 42883 undefined_function / PGRST202: migration 0059 not applied yet.
    if (error.code === "42883" || error.code === "PGRST202") return { ok: false, reason: "migrationMissing" };
    return { ok: false, reason: "failed" };
  }

  const claim = data as CancelClaim;
  // The payout honours the admin's refund switch (0062); say so up front.
  if (claim.destination === "mobile_money" && (await refundsGoToWallet())) claim.destination = "customer_wallet";
  if (!claim.alreadyCancelled) {
    await releaseOrderHoldings(claim.orderId);

    if (claim.customerId) {
      await notify({
        event: "order_cancelled",
        tone: "error",
        customerId: claim.customerId,
        href: `/orders/${claim.orderId}`,
        params: {
          reference: claim.reference,
          restaurantName: input.restaurantName,
          cancelledBy: "restaurant",
          reason: input.reason,
          refundAmount: claim.refundAmount,
          refundTo: claim.destination,
        },
      });
    }
    if (input.by === "admin") {
      await notify({
        event: "order_cancelled",
        tone: "warning",
        restaurantId: claim.restaurantId,
        href: `/m/orders/${claim.orderId}`,
        params: { reference: claim.reference, cancelledBy: "restaurant", reason: `Resto237 : ${input.reason}` },
      });
    }
  }

  if (claim.refundId && claim.refundStatus === "pending") {
    // Best effort now; the reconciler sweeps whatever this does not finish.
    await startRefundPayout(claim.refundId).catch((err) =>
      console.error("[orders:cancelPaid] payout start", claim.refundId, err),
    );
  }

  return {
    ok: true,
    refundAmount: claim.refundAmount,
    refundTo: claim.destination,
    refundStatus: claim.refundStatus ?? undefined,
  };
}
