import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { confirmTransaction } from "@/lib/payments/camerpay/client";

export type ReservationRefundOutcome = "refunded" | "pending" | "failed" | "not_found";

export async function settleReservationRefund(refundId: string): Promise<ReservationRefundOutcome> {
  const supabase = createAdminClient();
  const { data: refund } = await supabase
    .from("refunds")
    .select("id, amount, status, phone, reply_to")
    .eq("id", refundId)
    .maybeSingle();

  if (!refund) return "not_found";
  if (refund.status === "completed") return "refunded";
  if (refund.status === "rejected") return "failed";
  if (!refund.reply_to || !refund.phone) return "pending";

  const outcome = await confirmTransaction(refund.reply_to, {
    direction: "payout",
    phone: refund.phone,
    amount: Number(refund.amount),
  });
  if (outcome.status === "pending") return "pending";

  if (outcome.status === "failed") {
    await supabase
      .from("refunds")
      .update({ status: "rejected", raw_response: { confirmation: outcome.raw } })
      .eq("id", refundId)
      .eq("status", "pending");
    return "failed";
  }

  const { data: completed } = await supabase.rpc("complete_reservation_refund", {
    p_refund_id: refundId,
    p_provider_row_id: outcome.rowId ?? null,
  });
  return completed ? "refunded" : "pending";
}

export async function settleReservationRefundByReplyTo(
  replyTo: string,
): Promise<ReservationRefundOutcome> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("refunds")
    .select("id")
    .eq("reply_to", replyTo)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  return data?.id ? settleReservationRefund(data.id as string) : "not_found";
}
