import "server-only";

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { paymentMode } from "@/lib/data/billing";
import { notify } from "@/lib/notify";
import { refundsGoToWallet } from "@/lib/payments/refund-settings";
import {
  acceptedTransactionId,
  confirmTransaction,
  isPayableAmount,
  latestTransactionId,
  normalisePhone,
  recordAcceptedRequest,
  sendPayout,
} from "@/lib/payments/camerpay/client";

/**
 * Sending a refund back to the customer's Mobile Money — the saga half of
 * every refund.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE DATABASE DECIDES THAT MONEY IS OWED; THIS FILE SENDS IT.
 *
 *  A `refunds` row in status `pending` with a phone is a debt: the order or
 *  booking was cancelled, the restaurant was debited, and the customer is
 *  owed `amount`. That row is written inside a Postgres transaction
 *  (cancel_paid_order, cancel_customer_reservation…). The CamerPay payout
 *  cannot join that transaction, so it runs here as three idempotent steps:
 *
 *    1. CLAIM   — a conditional update stamps `raw_response.payoutClaim`.
 *                 Only the caller that wins it may call sendPayout, so the
 *                 action, the reconciler and a double-tap can never send the
 *                 same refund twice.
 *    2. SEND    — sendPayout(); the tracking id goes into `reply_to`.
 *    3. CONFIRM — confirmTransaction() (the only trust anchor, as for
 *                 collections). Success completes the row; a conclusive
 *                 failure releases the claim so the reconciler retries, up to
 *                 MAX_TRIES, then hands it to the admins.
 *
 *  A claim with no `reply_to` older than CLAIM_STUCK_MS is AMBIGUOUS — the
 *  process may have died after CamerPay accepted the payout. It is never
 *  retried automatically (that could pay twice); the admins are told.
 *
 *  Refunds under the Mobile Money minimum (500 FCFA) cannot be paid out; they
 *  are credited to the customer's Resto237 wallet instead.
 *
 *  A plain server module: nothing that moves money is reachable from a URL.
 * ─────────────────────────────────────────────────────────────────────────
 */

const MAX_TRIES = 3;
const CLAIM_STUCK_MS = 15 * 60_000;

export type RefundPayoutOutcome = "refunded" | "pending" | "failed" | "not_found";

interface RefundRow {
  id: string;
  reference: string;
  amount: number;
  status: "pending" | "completed" | "rejected";
  phone: string | null;
  reply_to: string | null;
  order_id: string | null;
  reservation_id: string | null;
  restaurant_id: string;
  raw_response: Record<string, unknown> | null;
  created_at: string;
}

async function loadRefund(refundId: string): Promise<RefundRow | null> {
  const { data } = await createAdminClient()
    .from("refunds")
    .select("id, reference, amount, status, phone, reply_to, order_id, reservation_id, restaurant_id, raw_response, created_at")
    .eq("id", refundId)
    .maybeSingle();
  return (data as RefundRow | null) ?? null;
}

function raw(row: RefundRow): Record<string, unknown> {
  return row.raw_response && typeof row.raw_response === "object" ? row.raw_response : {};
}

/** Mark a refund paid. Reservation refunds also stamp the booking (0050). */
async function completeRefund(row: RefundRow, providerRowId: string | null): Promise<boolean> {
  const supabase = createAdminClient();
  if (row.reservation_id) {
    const { data } = await supabase.rpc("complete_reservation_refund", {
      p_refund_id: row.id,
      p_provider_row_id: providerRowId,
    });
    return Boolean(data);
  }
  const { data, error } = await supabase
    .from("refunds")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      ...(providerRowId ? { provider_row_id: providerRowId } : {}),
    })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) console.error("[refund:complete]", row.id, error.message);
  if (data) await tellCustomer(row, "refunded");
  return Boolean(data) || (await loadRefund(row.id))?.status === "completed";
}

/** The customer of the order or booking a refund belongs to, if any. */
async function refundCustomer(row: RefundRow): Promise<string | null> {
  const supabase = createAdminClient();
  if (row.order_id) {
    const { data } = await supabase.from("orders").select("customer_id").eq("id", row.order_id).maybeSingle();
    return (data?.customer_id as string | null) ?? null;
  }
  if (row.reservation_id) {
    const { data } = await supabase.from("reservations").select("customer_id").eq("id", row.reservation_id).maybeSingle();
    return (data?.customer_id as string | null) ?? null;
  }
  return null;
}

async function tellCustomer(row: RefundRow, outcome: "refunded"): Promise<void> {
  const customerId = await refundCustomer(row);
  if (!customerId) return;
  await notify({
    event: "refund",
    tone: "success",
    customerId,
    href: row.order_id ? `/orders/${row.order_id}` : "/reservations",
    params: { reference: row.reference, amount: row.amount, status: outcome === "refunded" ? "completed" : undefined },
  });
}

async function alertAdmins(row: RefundRow, why: string): Promise<void> {
  await notify({
    event: "broadcast",
    tone: "error",
    admins: true,
    href: "/a/refunds",
    params: {
      reference: `refund:${row.id}`,
      subject: `Refund ${row.reference} needs attention`,
      bodyText: `Refund ${row.reference} (${row.amount} FCFA) could not be paid out automatically: ${why}. Check CamerPay and pay it by hand if needed.`,
    },
  });
}

/**
 * A refund too small for Mobile Money (or with no usable number) goes to the
 * customer's Resto237 wallet — still their money, usable on the next order.
 */
async function creditWalletInstead(row: RefundRow, why: string): Promise<RefundPayoutOutcome> {
  const supabase = createAdminClient();
  const customerId = await refundCustomer(row);
  if (!customerId) {
    // Nobody to credit and no number to pay: a human has to. Alert once.
    if (!raw(row).adminAlerted) {
      await supabase
        .from("refunds")
        .update({ raw_response: { ...raw(row), adminAlerted: new Date().toISOString() } })
        .eq("id", row.id);
      await alertAdmins(row, why);
    }
    return "pending";
  }
  // Claim first so two callers cannot both credit.
  const claim = new Date().toISOString();
  const { data: claimed } = await supabase
    .from("refunds")
    .update({ raw_response: { ...raw(row), payoutClaim: claim, destination: "customer_wallet", walletReason: why } })
    .eq("id", row.id)
    .eq("status", "pending")
    .is("raw_response->>payoutClaim", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return "pending";

  const { error } = await supabase.rpc("credit_customer_wallet", {
    p_profile_id: customerId,
    p_amount: row.amount,
    p_kind: "refund",
    p_note: `Refund ${row.reference}`,
    p_reference: row.reference,
  });
  if (error) {
    console.error("[refund:wallet]", row.id, error.message);
    await supabase
      .from("refunds")
      .update({ raw_response: { ...raw(row), walletError: error.message } })
      .eq("id", row.id);
    await alertAdmins(row, "wallet credit failed");
    return "pending";
  }
  return (await completeRefund({ ...row, raw_response: { ...raw(row), destination: "customer_wallet" } }, null))
    ? "refunded"
    : "pending";
}

/**
 * Send a pending refund to the customer's Mobile Money. Safe to call from the
 * cancelling action and from the reconciler at the same moment.
 */
export async function startRefundPayout(refundId: string): Promise<RefundPayoutOutcome> {
  const row = await loadRefund(refundId);
  if (!row) return "not_found";
  if (row.status === "completed") return "refunded";
  if (row.status === "rejected") return "failed";
  if (row.reply_to) return settleRefundPayout(refundId);
  if (raw(row).payoutClaim) return "pending";
  if (raw(row).destination === "customer_wallet") return creditWalletInstead(row, "wallet refund");
  // The admin's switch (0062) decides for everything paid by Mobile Money.
  if (await refundsGoToWallet()) return creditWalletInstead(row, "admin setting: refunds to wallet");

  const phone = normalisePhone(row.phone ?? "");
  if (!phone) return creditWalletInstead(row, "no valid Mobile Money number");
  if (!isPayableAmount(row.amount)) return creditWalletInstead(row, "below the Mobile Money minimum");

  const supabase = createAdminClient();
  const claim = new Date().toISOString();
  const tries = Number(raw(row).payoutTries ?? 0) + 1;
  const { data: claimed } = await supabase
    .from("refunds")
    .update({ raw_response: { ...raw(row), payoutClaim: claim, payoutTries: tries } })
    .eq("id", row.id)
    .eq("status", "pending")
    .is("reply_to", null)
    .is("raw_response->>payoutClaim", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return "pending";

  if ((await paymentMode()) === "sandbox") {
    await supabase
      .from("refunds")
      .update({ reply_to: `SANDBOX-${randomUUID().slice(0, 8)}` })
      .eq("id", row.id);
    return (await completeRefund(row, null)) ? "refunded" : "pending";
  }

  const afterId = await latestTransactionId();
  let response;
  try {
    response = await sendPayout(phone, row.amount);
  } catch (error) {
    // Transport failure: CamerPay may or may not have accepted. Keep the
    // claim — CLAIM_STUCK_MS turns it into an admin alert, never a resend.
    console.error("[refund:payout] transport", row.id, error);
    await supabase
      .from("refunds")
      .update({
        raw_response: {
          ...raw(row), payoutClaim: claim, payoutTries: tries,
          transportError: error instanceof Error ? error.message : String(error),
        },
      })
      .eq("id", row.id);
    return "pending";
  }

  const replyTo = acceptedTransactionId(response);
  if (!(response.httpStatus === 202 || response.etat) || !replyTo) {
    // Conclusive refusal: nothing was sent. Release the claim for a retry.
    await supabase
      .from("refunds")
      .update({
        raw_response: { ...raw(row), payoutTries: tries, lastRefusal: response.message ?? response.httpStatus ?? "refused" },
      })
      .eq("id", row.id)
      .eq("status", "pending");
    if (tries >= MAX_TRIES) await giveUp(row, "CamerPay refused the payout");
    return "pending";
  }

  await recordAcceptedRequest({
    replyTo,
    direction: "payout",
    phone,
    amount: row.amount,
    afterId: afterId ?? null,
    startedAt: claim,
  });
  await supabase
    .from("refunds")
    .update({ reply_to: replyTo, phone, raw_response: { ...raw(row), payoutClaim: claim, payoutTries: tries, afterId } })
    .eq("id", row.id)
    .eq("status", "pending");

  return "pending";
}

async function giveUp(row: RefundRow, why: string): Promise<void> {
  await createAdminClient()
    .from("refunds")
    .update({ status: "rejected", raw_response: { ...raw(row), gaveUp: why } })
    .eq("id", row.id)
    .eq("status", "pending");
  await alertAdmins(row, why);
}

/** Ask CamerPay whether a sent refund landed. */
export async function settleRefundPayout(refundId: string): Promise<RefundPayoutOutcome> {
  const row = await loadRefund(refundId);
  if (!row) return "not_found";
  if (row.status === "completed") return "refunded";
  if (row.status === "rejected") return "failed";
  if (!row.reply_to) return "pending";
  if (row.reply_to.startsWith("SANDBOX-")) return (await completeRefund(row, null)) ? "refunded" : "pending";

  const outcome = await confirmTransaction(row.reply_to, {
    direction: "payout",
    phone: row.phone ?? undefined,
    amount: Number(row.amount),
  });
  if (outcome.status === "pending") return "pending";

  if (outcome.status === "failed") {
    const tries = Number(raw(row).payoutTries ?? 1);
    const supabase = createAdminClient();
    if (tries >= MAX_TRIES) {
      await giveUp(row, "CamerPay reported the payout failed " + tries + " times");
      return "failed";
    }
    // Release for another try: clear the tracking id and the claim.
    const next = { ...raw(row), lastFailure: new Date().toISOString() };
    delete (next as Record<string, unknown>).payoutClaim;
    await supabase
      .from("refunds")
      .update({ reply_to: null, raw_response: next })
      .eq("id", row.id)
      .eq("status", "pending")
      .eq("reply_to", row.reply_to);
    return "pending";
  }

  return (await completeRefund(row, outcome.rowId ?? null)) ? "refunded" : "pending";
}

/** Settle a refund from the CamerPay webhook, which only carries a reply id. */
export async function settleRefundByReplyTo(replyTo: string): Promise<RefundPayoutOutcome> {
  const { data } = await createAdminClient()
    .from("refunds")
    .select("id")
    .eq("reply_to", replyTo)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  return data?.id ? settleRefundPayout(data.id as string) : "not_found";
}

/**
 * The reconciler's refund sweep: confirm sent payouts, send unsent ones, and
 * flag ambiguous claims. Bounded per run like every other queue.
 */
export async function sweepRefunds(limit = 25): Promise<{ refunded: number; failed: number; pending: number }> {
  const supabase = createAdminClient();
  const summary = { refunded: 0, failed: 0, pending: 0 };
  const staleCutoff = new Date(Date.now() - 2 * 60_000).toISOString();

  const { data, error } = await supabase
    .from("refunds")
    .select("id, reference, amount, status, phone, reply_to, order_id, reservation_id, restaurant_id, raw_response, created_at")
    .eq("status", "pending")
    .lt("created_at", staleCutoff)
    // Customer refunds only. Admin refunds of a restaurant's subscription
    // payment (0005) share the table but are settled by hand.
    .or("order_id.not.is.null,reservation_id.not.is.null")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[refund:sweep]", error.message);
    return summary;
  }

  for (const row of (data ?? []) as RefundRow[]) {
    let outcome: RefundPayoutOutcome;
    const claim = typeof raw(row).payoutClaim === "string" ? Date.parse(raw(row).payoutClaim as string) : null;
    if (row.reply_to) {
      outcome = await settleRefundPayout(row.id);
    } else if (claim && Date.now() - claim > CLAIM_STUCK_MS) {
      if (!raw(row).stuckAlerted) {
        await createAdminClient()
          .from("refunds")
          .update({ raw_response: { ...raw(row), stuckAlerted: new Date().toISOString() } })
          .eq("id", row.id);
        await alertAdmins(row, "the payout was started but its CamerPay reference was never recorded");
      }
      outcome = "pending";
    } else if (!claim) {
      outcome = await startRefundPayout(row.id);
    } else {
      outcome = "pending";
    }
    if (outcome === "refunded") summary.refunded += 1;
    else if (outcome === "failed") summary.failed += 1;
    else summary.pending += 1;
  }
  return summary;
}

/**
 * A payment that landed on an order no longer waiting for it (cancelled by
 * the time limit, already paid by another attempt, total changed): the money
 * was never credited to anyone, so it simply goes back. One refund per
 * attempt — the attempt id is the idempotency key.
 */
export async function refundUnpayableAttempt(input: {
  attemptId: string;
  orderId: string;
  restaurantId: string;
  amount: number;
  phone: string | null;
  reason: string;
}): Promise<string | null> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("refunds")
    .select("id")
    .eq("raw_response->>attemptId", input.attemptId)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await supabase
    .from("refunds")
    .insert({
      reference: "RF-" + randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase(),
      restaurant_id: input.restaurantId,
      order_id: input.orderId,
      type: "refund",
      amount: input.amount,
      reason: input.reason,
      status: "pending",
      created_by: "system",
      phone: input.phone,
      raw_response: { attemptId: input.attemptId, destination: "mobile_money", latePayment: true },
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[refund:unpayable]", input.attemptId, error?.message);
    return null;
  }
  return created.id as string;
}
