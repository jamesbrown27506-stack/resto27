import "server-only";

import { confirmGatewayPayout } from "@/lib/payments/gateway";
import { createAdminClient } from "@/lib/supabase/server";

export type WithdrawalSettlementOutcome = {
  status: "succeeded" | "pending" | "failed" | "not_found";
  requestId?: string;
  gross?: number;
  net?: number;
  phone?: string;
  error?: string;
};

/**
 * Confirm one accepted restaurant payout against CamerPay.
 *
 * The row transition is conditional, so browser polling, the callback and the
 * scheduled reconciler may all race safely. A confirmed failure restores the
 * full gross amount before the request is exposed as failed.
 */
export async function settleWithdrawalPayout(
  requestId: string,
): Promise<WithdrawalSettlementOutcome> {
  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("withdrawal_requests")
    .select("id, restaurant_id, amount, phone, status, reply_to, net, decided_at")
    .eq("id", requestId)
    .maybeSingle();

  if (error || !row) return { status: "not_found" };

  const base = {
    requestId: String(row.id),
    gross: Number(row.amount),
    net: Number(row.net ?? row.amount),
    phone: String(row.phone),
  };
  if (row.status === "rejected") return { status: "failed", ...base };
  if (row.status !== "paid" || !row.reply_to) return { status: "pending", ...base };
  if (row.decided_at || String(row.reply_to).startsWith("SANDBOX-")) {
    return { status: "succeeded", ...base };
  }

  // Back to whichever gateway sent it: "saspay:<id>" or a CamerPay replyTo.
  const outcome = await confirmGatewayPayout(String(row.reply_to), {
    phone: base.phone,
    amount: base.net,
  });
  if (outcome.status === "pending") return { status: "pending", ...base };

  if (outcome.status === "success") {
    await supabase
      .from("withdrawal_requests")
      .update({ decided_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("status", "paid")
      .is("decided_at", null);
    return { status: "succeeded", ...base };
  }

  const { data: rejected } = await supabase
    .from("withdrawal_requests")
    .update({ status: "rejected", decided_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "paid")
    .is("decided_at", null)
    .select("id")
    .maybeSingle();

  if (rejected) {
    const { error: reversalError } = await supabase.rpc("wallet_credit", {
      p_restaurant_id: row.restaurant_id,
      p_amount: base.gross,
      p_kind: "adjustment",
      p_note: `Withdrawal ${requestId} reversed - CamerPay reported failure`,
      p_reference: requestId,
    });
    if (reversalError) {
      await supabase
        .from("withdrawal_requests")
        .update({ status: "paid", decided_at: null })
        .eq("id", requestId)
        .eq("status", "rejected");
      return {
        status: "pending",
        ...base,
        error: "Payout failed, but the wallet refund could not be recorded.",
      };
    }
  }

  return { status: "failed", ...base };
}

export async function settleWithdrawalPayoutByReplyTo(
  replyTo: string,
): Promise<WithdrawalSettlementOutcome> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("withdrawal_requests")
    .select("id")
    .eq("reply_to", replyTo)
    .eq("status", "paid")
    .is("decided_at", null)
    .limit(1)
    .maybeSingle();
  return data?.id ? settleWithdrawalPayout(String(data.id)) : { status: "not_found" };
}