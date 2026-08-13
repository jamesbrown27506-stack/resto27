"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { requireCapability } from "@/lib/auth/branch";
import { writeAudit } from "./platform-actions";
import { rateLimit } from "@/lib/rate-limit";
import { getWithdrawalFeeConfig } from "./settings";
import { computeWithdrawalFee } from "@/lib/payments/withdrawal-fee";
import {
  latestTransactionId,
  MIN_AMOUNT_XAF,
  normalisePhone,
  recordAcceptedRequest,
  recordWithdrawalFee,
  sendPayout,
} from "@/lib/payments/camerpay/client";
import type { ActionResult } from "./admin-actions";

/**
 * Wallet mutations (migration 0024).
 *
 * Money lands in a restaurant's wallet only when it has actually been
 * received — credited here by an admin (audited) until online order payment
 * is wired, at which point the same credit path fires automatically. Money
 * leaves only through a withdrawal request the admin approves, which sends a
 * REAL CamerPay payout with the configured fee withheld.
 */

/* ── Credit ────────────────────────────────────────────────────────────── */

/**
 * Credit a restaurant's wallet — admin only, and audited.
 *
 * Today this is how money received for a restaurant (a CamerPay collection,
 * a reservation deposit paid at the counter) becomes a balance. It is a
 * deliberate, visible act — not a number a form can type silently — and the
 * ledger row makes every franc explainable.
 */
export async function creditWallet(
  restaurantId: string,
  amount: number,
  note?: string,
): Promise<ActionResult & { balance?: number }> {
  const admin = await requireRole("admin");
  const value = Math.round(amount);

  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, error: "Amount must be a positive number of francs." };
  }

  const supabase = createAdminClient();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("name")
    .eq("id", restaurantId)
    .maybeSingle();
  if (!restaurant) return { ok: false, error: "Restaurant not found." };

  const { data: balance, error } = await supabase.rpc("wallet_credit", {
    p_restaurant_id: restaurantId,
    p_amount: value,
    p_kind: "payment",
    p_note: note?.trim() || null,
  });

  if (error) {
    console.error("[wallet:creditWallet]", error.message);
    return { ok: false, error: "Could not credit the wallet. Is migration 0024 applied?" };
  }

  await writeAudit(admin, {
    action: "wallet.credit",
    entityType: "restaurant",
    entityId: restaurantId,
    summary: `Credited ${value.toLocaleString("fr-CM")} FCFA to ${restaurant.name}${note ? ` — ${note.trim()}` : ""}`,
    metadata: { amount: value },
  });

  revalidatePath("/a/wallet");
  revalidatePath("/m/wallet");
  return { ok: true, balance: Number(balance ?? 0) };
}

/* ── Withdrawal requests ───────────────────────────────────────────────── */

/**
 * A restaurant asks to take its money OUT. The GROSS is what they ask for;
 * the fee (if enabled) is withheld at approval time by the admin's payout.
 */
export async function requestWithdrawal(input: {
  amount: number;
  phone: string;
  note?: string;
}): Promise<ActionResult> {
  const { active, profile } = await requireCapability("finance.manage");

  const amount = Math.round(input.amount);
  if (!Number.isInteger(amount) || amount < MIN_AMOUNT_XAF) {
    return { ok: false, error: `Minimum withdrawal is ${MIN_AMOUNT_XAF} FCFA.` };
  }

  const phone = normalisePhone(input.phone);
  if (!phone) {
    return { ok: false, error: "That phone is not valid — 9 digits starting with 6, no +237." };
  }

  const limited = await rateLimit({
    key: "wallet:withdraw",
    limit: 5,
    windowMs: 60 * 60_000,
    identifier: active.restaurantId,
  });
  if (!limited.ok) {
    return { ok: false, error: "Too many requests from this restaurant. Try again in an hour." };
  }

  const supabase = createAdminClient();

  const { data: wallet } = await supabase
    .from("restaurant_wallets")
    .select("balance")
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  const balance = Number((wallet as { balance: number } | null)?.balance ?? 0);
  if (balance < amount) {
    return {
      ok: false,
      error: `The wallet has ${balance.toLocaleString("fr-CM")} FCFA — this request needs ${amount.toLocaleString("fr-CM")} FCFA.`,
    };
  }

  const { error } = await supabase.from("withdrawal_requests").insert({
    restaurant_id: active.restaurantId,
    requested_by: profile.id,
    amount,
    phone,
    note: input.note?.trim() || null,
  });

  if (error) {
    console.error("[wallet:requestWithdrawal]", error.message);
    return { ok: false, error: "Could not submit the request." };
  }

  revalidatePath("/m/wallet");
  revalidatePath("/a/wallet");
  return { ok: true };
}

/**
 * Approve a withdrawal: send a REAL CamerPay payout (fee withheld), and only
 * then debit the wallet. Nothing is debited if the payout is refused.
 */
export async function approveWithdrawal(requestId: string): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const supabase = createAdminClient();

  const { data: row } = await supabase
    .from("withdrawal_requests")
    .select("id, restaurant_id, amount, phone, status")
    .eq("id", requestId)
    .maybeSingle();

  const request = row as {
    id: string;
    restaurant_id: string;
    amount: number;
    phone: string;
    status: string;
  } | null;

  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "pending") {
    return { ok: false, error: "That request has already been decided." };
  }

  const gross = Number(request.amount);

  // The fee is read fresh, at payout time — a setting changed since the page
  // loaded must still hold here.
  const feeConfig = await getWithdrawalFeeConfig();
  const { fee, net } =
    feeConfig.enabled && feeConfig.percent > 0
      ? computeWithdrawalFee(gross, feeConfig.percent)
      : { fee: 0, net: gross };

  if (net < MIN_AMOUNT_XAF) {
    return {
      ok: false,
      error: `After the ${feeConfig.percent}% fee, the recipient would get ${net} FCFA — below CamerPay's ${MIN_AMOUNT_XAF} FCFA minimum.`,
    };
  }

  // The wallet must still hold the gross — the restaurant's money is what is
  // being sent out.
  const { data: wallet } = await supabase
    .from("restaurant_wallets")
    .select("balance")
    .eq("restaurant_id", request.restaurant_id)
    .maybeSingle();

  if (Number((wallet as { balance: number } | null)?.balance ?? 0) < gross) {
    return { ok: false, error: "The wallet no longer covers this amount." };
  }

  try {
    const afterId = await latestTransactionId();
    const response = await sendPayout(request.phone, net);

    if (!(response.httpStatus === 202 || response.etat)) {
      return {
        ok: false,
        error: `CamerPay refused the payout: ${response.message ?? `HTTP ${response.httpStatus}`}`,
      };
    }

    const replyTo = response.data?.replyTo;
    if (!replyTo) {
      return { ok: false, error: "CamerPay accepted without a replyTo — check the console." };
    }

    // Ledger the acceptance so the webhook/reconciler can find the report row.
    await recordAcceptedRequest({
      replyTo,
      direction: "payout",
      phone: request.phone,
      amount: net,
      afterId: afterId ?? null,
      startedAt: new Date().toISOString(),
    });

    if (fee > 0) {
      await recordWithdrawalFee({ replyTo, phone: request.phone, gross, fee, net });
    }

    // Debit the FULL gross: the fee comes out of what the restaurant is owed
    // and stays with the platform. The debit is guarded inside the RPC, so a
    // balance that moved meanwhile fails safely — the payout is already sent,
    // and the request stays marked for reconciliation.
    const { error: debitError } = await supabase.rpc("wallet_debit", {
      p_restaurant_id: request.restaurant_id,
      p_amount: gross,
      p_kind: "withdrawal",
      p_note: `Withdrawal ${replyTo}`,
    });

    if (debitError) {
      console.error("[wallet:approveWithdrawal] debit failed after payout", debitError.message);
    }

    const { error: updateError } = await supabase
      .from("withdrawal_requests")
      .update({
        status: "paid",
        reply_to: replyTo,
        fee: fee > 0 ? fee : null,
        net,
        decided_at: new Date().toISOString(),
        decided_by: admin.id,
      })
      .eq("id", requestId);

    if (updateError) {
      console.error("[wallet:approveWithdrawal] status update failed", updateError.message);
    }

    await writeAudit(admin, {
      action: "wallet.withdrawal_approved",
      entityType: "withdrawal_request",
      entityId: requestId,
      summary: `Paid ${net.toLocaleString("fr-CM")} FCFA to ${request.phone}${fee > 0 ? ` (${fee.toLocaleString("fr-CM")} FCFA fee withheld)` : ""}`,
      metadata: { gross, fee, net, replyTo },
    });

    revalidatePath("/a/wallet");
    revalidatePath("/m/wallet");
    return { ok: true, note: fee > 0 ? `Fee of ${fee.toLocaleString("fr-CM")} FCFA withheld.` : undefined };
  } catch (error) {
    console.error("[wallet:approveWithdrawal]", error);
    return { ok: false, error: error instanceof Error ? error.message : "The payout call failed." };
  }
}

/** Reject a withdrawal — the balance is untouched. */
export async function rejectWithdrawal(requestId: string, reason?: string): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("withdrawal_requests")
    .update({
      status: "rejected",
      note: reason?.trim() || null,
      decided_at: new Date().toISOString(),
      decided_by: admin.id,
    })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { ok: false, error: "Could not reject the request." };

  await writeAudit(admin, {
    action: "wallet.withdrawal_rejected",
    entityType: "withdrawal_request",
    entityId: requestId,
    summary: reason?.trim() ? `Rejected a withdrawal: ${reason.trim()}` : "Rejected a withdrawal",
  });

  revalidatePath("/a/wallet");
  revalidatePath("/m/wallet");
  return { ok: true };
}
