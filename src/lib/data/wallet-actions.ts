"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireRole, type AuthProfile } from "@/lib/auth/session";
import { requireCapability } from "@/lib/auth/branch";
import { writeAudit } from "./platform-actions";
import { rateLimit } from "@/lib/rate-limit";
import { getWithdrawalFeeConfig } from "./settings";
import { paymentMode } from "./billing";
import { computeWithdrawalFee } from "@/lib/payments/withdrawal-fee";
import {
  acceptedTransactionId,
  isPayableAmount,
  latestTransactionId,
  MAX_AMOUNT_XAF,
  MIN_AMOUNT_XAF,
  normalisePhone,
  recordAcceptedRequest,
  recordWithdrawalFee,
  sendPayout,
} from "@/lib/payments/camerpay/client";
import type { ActionResult } from "./admin-actions";
import { checkPaymentAttempt, initiatePaymentAttempt, settlePayment } from "@/lib/payments/collect";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";
import { settleWithdrawalPayout } from "@/lib/payments/withdrawals";

/**
 * Wallet mutations (migration 0024).
 *
 * Money lands in a restaurant's wallet only when it has actually been
 * received — credited here by an admin (audited) until online order payment
 * is wired, at which point the same credit path fires automatically. Money
 * leaves only through a withdrawal request the admin approves, which sends a
 * CamerPay payout with the configured fee withheld — real in `live` mode,
 * simulated in `sandbox`, exactly as the collect path simulates a charge.
 */

/**
 * Every failure carries a stable code as well as its prose: the strings here
 * are still English-only and a later pass translates them, so callers key off
 * `reason`, never off the sentence. Same convention as checkout-actions.
 */
type WalletResult = ActionResult & {
  reason?: string;
  status?: "pending" | "succeeded" | "failed";
  requestId?: string;
};

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
): Promise<WalletResult & { balance?: number }> {
  const admin = await requireRole("admin");
  const value = Math.round(amount);

  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, reason: "badAmount", error: "Amount must be a positive number of francs." };
  }
  const supabase = createAdminClient();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("name")
    .eq("id", restaurantId)
    .maybeSingle();
  if (!restaurant) return { ok: false, reason: "restaurantNotFound", error: "Restaurant not found." };

  const { data: balance, error } = await supabase.rpc("wallet_credit", {
    p_restaurant_id: restaurantId,
    p_amount: value,
    p_kind: "payment",
    p_note: note?.trim() || null,
  });

  if (error) {
    console.error("[wallet:creditWallet]", error.message);
    return {
      ok: false,
      reason: "creditFailed",
      error: "Could not credit the wallet. Is migration 0024 applied?",
    };
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

/**
 * Collect real Mobile Money before crediting a restaurant wallet. The admin
 * chooses the beneficiary, but CamerPay decides whether money was received.
 */
export async function fundWallet(
  restaurantId: string,
  phone: string,
  amount: number,
): Promise<WalletResult & {
  status?: "succeeded" | "pending";
  attemptId?: string;
  instruction?: PaymentInstruction;
}> {
  await requireRole("admin");
  const value = Math.round(amount);
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, reason: "badAmount", error: "Amount must be a positive number of francs." };
  }
  const normalizedPhone = normalisePhone(phone);
  if (!normalizedPhone) {
    return { ok: false, reason: "badPhone", error: "Enter a valid Mobile Money number." };
  }

  const supabase = createAdminClient();
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, name")
    .eq("id", restaurantId)
    .maybeSingle();
  if (!restaurant) return { ok: false, reason: "restaurantNotFound", error: "Restaurant not found." };

  const { data: attempts, error: lookupError } = await supabase
    .from("payment_attempts")
    .select("id, status, transaction_id")
    .eq("restaurant_id", restaurantId)
    .eq("amount", value)
    .eq("phone", normalizedPhone)
    .contains("raw_response", { walletFunding: true })
    .in("status", ["pending", "succeeded"])
    .is("settled_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  if (lookupError) return { ok: false, error: "Could not verify the wallet payment." };
  const open = (attempts ?? []).find(
    (attempt) => attempt.status === "succeeded" || Boolean(attempt.transaction_id),
  );
  if (open?.status === "succeeded") {
    const settled = await settlePayment(open.id as string);
    return settled.ok
      ? { ok: true, status: "succeeded", attemptId: open.id as string }
      : { ok: false, error: settled.error ?? "Wallet settlement failed." };
  }
  if (open?.status === "pending" && open.transaction_id) {
    return { ok: true, status: "pending", attemptId: open.id as string };
  }

  const initiated = await initiatePaymentAttempt({
    kind: "wallet",
    restaurantId,
    reference: "Wallet " + restaurant.name,
    phone: normalizedPhone,
    amount: value,
  });
  if (!initiated.ok || !initiated.attemptId) {
    return { ok: false, reason: initiated.reason, error: initiated.error ?? "CamerPay payment failed." };
  }
  if (initiated.status === "pending") {
    return { ok: true, status: "pending", attemptId: initiated.attemptId };
  }

  const settled = await settlePayment(initiated.attemptId);
  return settled.ok
    ? { ok: true, status: "succeeded", attemptId: initiated.attemptId }
    : { ok: false, error: settled.error ?? "Wallet settlement failed." };
}

export async function checkWalletFunding(
  attemptId: string,
): Promise<WalletResult & {
  status?: "succeeded" | "pending" | "failed";
  instruction?: PaymentInstruction;
}> {
  await requireRole("admin");
  const supabase = createAdminClient();
  const { data: attempt } = await supabase
    .from("payment_attempts")
    .select("raw_response")
    .eq("id", attemptId)
    .maybeSingle();
  if (attempt?.raw_response?.walletFunding !== true) {
    return { ok: false, error: "Wallet payment not found." };
  }

  const result = await checkPaymentAttempt(attemptId);
  if (!result.ok) return { ok: false, error: result.error ?? "Wallet payment not found." };
  revalidatePath("/a/wallet");
  revalidatePath("/m/wallet");
  return { ok: true, status: result.status, instruction: result.instruction };
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
}): Promise<WalletResult> {
  const { active, profile } = await requireCapability("finance.manage");

  const amount = Math.round(input.amount);
  if (!Number.isInteger(amount) || amount < MIN_AMOUNT_XAF) {
    return { ok: false, reason: "belowMinimum", error: `Minimum withdrawal is ${MIN_AMOUNT_XAF} FCFA.` };
  }

  const phone = normalisePhone(input.phone);
  if (!phone) {
    return {
      ok: false,
      reason: "badPhone",
      error: "That phone is not valid — 9 digits starting with 6, no +237.",
    };
  }

  const limited = await rateLimit({
    key: "wallet:withdraw",
    limit: 5,
    windowMs: 60 * 60_000,
    identifier: active.restaurantId,
  });
  if (!limited.ok) {
    return {
      ok: false,
      reason: "rateLimited",
      error: "Too many requests from this restaurant. Try again in an hour.",
    };
  }

  const supabase = createAdminClient();

  const [walletResult, queuedResult] = await Promise.all([
    supabase
      .from("restaurant_wallets")
      .select("balance")
      .eq("restaurant_id", active.restaurantId)
      .maybeSingle(),
    supabase
      .from("withdrawal_requests")
      .select("amount")
      .eq("restaurant_id", active.restaurantId)
      .eq("status", "pending"),
  ]);

  const balance = Number((walletResult.data as { balance: number } | null)?.balance ?? 0);

  // Requests already in the queue are spoken for. Checking the bare balance
  // lets five requests for the whole wallet all pass, and the admin then
  // discovers at the fourth approval that there is nothing left to send. The
  // debit at approval time is still the authority — this only keeps the queue
  // from promising money the wallet does not hold.
  const queued = ((queuedResult.data ?? []) as { amount: number }[]).reduce(
    (sum, row) => sum + Number(row.amount),
    0,
  );
  const available = balance - queued;

  if (available < amount) {
    return {
      ok: false,
      reason: "insufficientBalance",
      error: queued
        ? `The wallet has ${balance.toLocaleString("fr-CM")} FCFA with ${queued.toLocaleString("fr-CM")} FCFA already awaiting approval — only ${Math.max(0, available).toLocaleString("fr-CM")} FCFA can be requested.`
        : `The wallet has ${balance.toLocaleString("fr-CM")} FCFA — this request needs ${amount.toLocaleString("fr-CM")} FCFA.`,
    };
  }

  const { data: created, error } = await supabase
    .from("withdrawal_requests")
    .insert({
      restaurant_id: active.restaurantId,
      requested_by: profile.id,
      amount,
      phone,
      note: input.note?.trim() || null,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("[wallet:requestWithdrawal]", error?.message ?? "missing row");
    return { ok: false, reason: "insertFailed", error: "Could not start the withdrawal." };
  }

  return executeWithdrawal(String(created.id), profile, active.restaurantId);
}

/**
 * Approve a withdrawal.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE CLAIM COMES FIRST, THEN THE MONEY.
 *
 *  Two admin tabs, a double click and a retry after a slow response all
 *  arrive here at the same time, and a mobile-money transfer cannot be
 *  un-sent. So the request is CLAIMED first — a conditional pending → paid
 *  update — and only the caller that WINS that claim is allowed to move a
 *  franc. Everyone else reads a decided row and stops.
 *
 *  The wallet is then debited against the claim, BEFORE the transfer. A
 *  balance that moved meanwhile has to fail while the money is still here;
 *  discovering it afterwards means the payout has already left and the
 *  ledger cannot be made to agree.
 *
 *  Three honest endings, never a fourth that guesses:
 *
 *    sent     — reply_to, fee and net are stamped on the claimed row.
 *    refused  — the provider said no, which is definite: the debit is
 *               reversed, the claim released, the request pending again.
 *    unknown  — the call threw, or was accepted with no replyTo. The money
 *               may or may not have gone. The row STAYS claimed (so nobody
 *               sends a second one) and its note says a human must check
 *               CamerPay. Nothing is pretended in either direction.
 *
 *  Payment mode decides whether the transfer is real: in `sandbox` no
 *  provider call is made at all — the same convention as the collect path,
 *  where a sandbox attempt is booked as succeeded without money moving.
 *  Sandbox deposits credit these wallets with francs nobody received, so
 *  approving a withdrawal in sandbox must never send real ones back out.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function approveWithdrawal(requestId: string): Promise<WalletResult> {
  const admin = await requireRole("admin");
  return executeWithdrawal(requestId, admin);
}

/** Start or retry a withdrawal belonging to the manager's active branch. */
export async function processOwnWithdrawal(requestId: string): Promise<WalletResult> {
  const { active, profile } = await requireCapability("finance.manage");
  const limited = await rateLimit({
    key: "wallet:withdraw-retry",
    limit: 5,
    windowMs: 60 * 60_000,
    identifier: active.restaurantId,
  });
  if (!limited.ok) {
    return { ok: false, reason: "rateLimited", error: "Too many payout attempts. Try again in an hour." };
  }
  return executeWithdrawal(requestId, profile, active.restaurantId);
}

async function executeWithdrawal(
  requestId: string,
  actor: AuthProfile,
  scopedRestaurantId?: string,
): Promise<WalletResult> {
  const supabase = createAdminClient();

  const { data: row } = await supabase
    .from("withdrawal_requests")
    .select("id, restaurant_id, amount, phone, status, note")
    .eq("id", requestId)
    .maybeSingle();

  const request = row as {
    id: string;
    restaurant_id: string;
    amount: number;
    phone: string;
    status: string;
    note: string | null;
  } | null;

  if (!request || (scopedRestaurantId && request.restaurant_id !== scopedRestaurantId)) {
    return { ok: false, reason: "notFound", error: "Request not found." };
  }
  if (request.status !== "pending") {
    return { ok: false, reason: "alreadyDecided", error: "That request has already been decided." };
  }

  const restaurantId = request.restaurant_id;
  const existingNote = request.note;
  const gross = Number(request.amount);

  // Re-normalised here rather than trusted from the row: sendPayout throws on
  // a number it cannot dial, and a throw after the claim is an unknown
  // outcome — a certain failure must be caught while it is still cheap.
  const phone = normalisePhone(request.phone);
  if (!phone) {
    return {
      ok: false,
      reason: "badPhone",
      error: `The recipient number "${request.phone}" is not a valid MoMo number — reject this request.`,
    };
  }

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
      reason: "belowProviderMinimum",
      error: `After the ${feeConfig.percent}% fee, the recipient would get ${net} FCFA — below CamerPay's ${MIN_AMOUNT_XAF} FCFA minimum.`,
    };
  }

  const mode = await paymentMode();
  if (mode === "live" && !isPayableAmount(net)) {
    return {
      ok: false,
      reason: "outOfProviderRange",
      error: `${net.toLocaleString("fr-CM")} FCFA is outside CamerPay's ${MIN_AMOUNT_XAF}–${MAX_AMOUNT_XAF.toLocaleString("fr-CM")} FCFA range — split the request.`,
    };
  }

  /* ── Claim ─────────────────────────────────────────────────────────────
   * Nothing above touched money. Everything below is guarded by winning
   * this one update. */
  const { data: claimed, error: claimError } = await supabase
    .from("withdrawal_requests")
    .update({ status: "paid", decided_at: null, decided_by: actor.id })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error("[wallet:approveWithdrawal] claim failed", claimError.message);
    return { ok: false, reason: "claimFailed", error: "Could not take the request — nothing was sent." };
  }
  if (!claimed) {
    return { ok: false, reason: "alreadyDecided", error: "That request has already been decided." };
  }

  /** Hand the request back to the queue — guarded, so only our own claim. */
  async function releaseClaim(): Promise<void> {
    const { error } = await supabase
      .from("withdrawal_requests")
      .update({ status: "pending", decided_at: null, decided_by: null })
      .eq("id", requestId)
      .eq("status", "paid");
    if (error) console.error("[wallet:approveWithdrawal] release failed", error.message);
  }

  /** Put the gross back: the transfer did NOT go out. */
  async function reverseDebit(why: string): Promise<boolean> {
    const { error } = await supabase.rpc("wallet_credit", {
      p_restaurant_id: restaurantId,
      p_amount: gross,
      p_kind: "adjustment",
      p_note: `Withdrawal ${requestId} reversed — ${why}`,
      p_reference: requestId,
    });
    if (error) console.error("[wallet:approveWithdrawal] reversal failed", error.message);
    return !error;
  }

  /**
   * The outcome cannot be known. The claim is kept — a second transfer is
   * the one thing that must not happen — and the row carries what a human
   * needs to resolve it against CamerPay's own report.
   */
  async function markUnresolved(why: string): Promise<void> {
    const marker = `UNRESOLVED PAYOUT (${why}) — the wallet is debited ${gross.toLocaleString("fr-CM")} FCFA; verify with CamerPay before resending or crediting back.`;
    await supabase
      .from("withdrawal_requests")
      .update({ note: existingNote ? `${existingNote} · ${marker}` : marker })
      .eq("id", requestId)
      .eq("status", "paid");

    await writeAudit(actor, {
      action: "wallet.withdrawal_unresolved",
      entityType: "withdrawal_request",
      entityId: requestId,
      summary: `Payout outcome UNKNOWN for ${net.toLocaleString("fr-CM")} FCFA to ${phone} — ${why}`,
      metadata: { gross, fee, net, mode },
    });
  }

  /* ── Debit, against the claim ──────────────────────────────────────────
   * The FULL gross leaves the wallet: the fee comes out of what the
   * restaurant is owed and stays with the platform. */
  const { error: debitError } = await supabase.rpc("wallet_debit", {
    p_restaurant_id: restaurantId,
    p_amount: gross,
    p_kind: "withdrawal",
    p_note: `Withdrawal ${requestId}`,
    p_reference: requestId,
  });

  if (debitError) {
    await releaseClaim();
    console.error("[wallet:approveWithdrawal] debit refused", debitError.message);
    return debitError.message.includes("insufficient")
      ? {
          ok: false,
          reason: "insufficientBalance",
          error: "The wallet no longer covers this amount — nothing was sent.",
        }
      : {
          ok: false,
          reason: "debitFailed",
          error: "The wallet could not be debited — nothing was sent.",
        };
  }

  let replyTo: string;

  if (mode === "sandbox") {
    // No provider call, and no camerpay_requests row either: that ledger
    // exists so a confirmation can be matched to a REAL report row, and a
    // simulated entry would send the reconciler hunting a transfer nobody
    // ever asked for. The reference is deliberately unmistakable.
    replyTo = `SANDBOX-${randomUUID().slice(0, 10).toUpperCase()}`;
  } else {
    // Best effort: the report id just before the transfer, so a later
    // confirmation can match OUR row.
    const afterId = await latestTransactionId();

    let response;
    try {
      response = await sendPayout(phone, net);
    } catch (error) {
      // The request may well have reached CamerPay before this broke.
      console.error("[wallet:approveWithdrawal] payout call failed", error);
      await markUnresolved("the payout call failed");
      revalidatePath("/a/wallet");
      revalidatePath("/m/wallet");
      return {
        ok: false,
        reason: "payoutUnknown",
        error: `The payout call failed and the outcome is unknown. The request is held as paid and ${gross.toLocaleString("fr-CM")} FCFA is debited — check CamerPay for ${phone} before doing anything else.`,
      };
    }

    if (!(response.httpStatus === 202 || response.etat)) {
      // A refusal is definite: nothing left, so undo and requeue.
      const refusal = response.message ?? `HTTP ${response.httpStatus}`;

      if (!(await reverseDebit(`refused: ${refusal}`))) {
        // The claim stays: the wallet really is short by the gross, and the
        // row saying 'paid' is the closest thing to the truth until someone
        // credits it back.
        revalidatePath("/a/wallet");
        revalidatePath("/m/wallet");
        return {
          ok: false,
          reason: "reversalFailed",
          error: `CamerPay refused the payout (${refusal}) but the wallet debit could not be reversed — credit ${gross.toLocaleString("fr-CM")} FCFA back by hand.`,
        };
      }

      await releaseClaim();
      await writeAudit(actor, {
        action: "wallet.withdrawal_payout_refused",
        entityType: "withdrawal_request",
        entityId: requestId,
        summary: `CamerPay refused ${net.toLocaleString("fr-CM")} FCFA to ${phone} — ${refusal}`,
        metadata: { gross, fee, net },
      });

      revalidatePath("/a/wallet");
      revalidatePath("/m/wallet");
      return {
        ok: false,
        reason: "payoutRefused",
        error: `CamerPay refused the payout: ${refusal}. The wallet was credited back and the request is pending again.`,
      };
    }

    const accepted = acceptedTransactionId(response);
    if (!accepted) {
      // Accepted, so money may move, but with nothing to track it by.
      await markUnresolved("accepted without a replyTo");
      revalidatePath("/a/wallet");
      revalidatePath("/m/wallet");
      return {
        ok: false,
        reason: "payoutUnknown",
        error: `CamerPay accepted the payout without a replyTo, so it cannot be tracked. The request is held as paid — check CamerPay for ${phone} before resending.`,
      };
    }

    replyTo = accepted;

    // Ledger the acceptance so the webhook/reconciler can find the report row.
    await recordAcceptedRequest({
      replyTo,
      direction: "payout",
      phone,
      amount: net,
      afterId: afterId ?? null,
      startedAt: new Date().toISOString(),
    });
  }

  if (fee > 0) {
    await recordWithdrawalFee({ replyTo, phone, gross, fee, net });
  }

  const { error: stampError } = await supabase
    .from("withdrawal_requests")
    .update({
      reply_to: replyTo,
      fee: fee > 0 ? fee : null,
      net,
      decided_at: mode === "sandbox" ? new Date().toISOString() : null,
    })
    .eq("id", requestId)
    .eq("status", "paid");

  if (stampError) {
    console.error("[wallet:approveWithdrawal] stamp failed", stampError.message);
  }

  await writeAudit(actor, {
    action: "wallet.withdrawal_approved",
    entityType: "withdrawal_request",
    entityId: requestId,
    summary: `${mode === "sandbox" ? "Simulated a payout of" : "Paid"} ${net.toLocaleString("fr-CM")} FCFA to ${phone}${fee > 0 ? ` (${fee.toLocaleString("fr-CM")} FCFA fee withheld)` : ""}`,
    metadata: { gross, fee, net, replyTo, mode },
  });

  revalidatePath("/a/wallet");
  revalidatePath("/m/wallet");

  const feeNote = fee > 0 ? `Fee of ${fee.toLocaleString("fr-CM")} FCFA withheld.` : "";
  const modeNote = mode === "sandbox" ? "Sandbox mode — the transfer was simulated, no money moved." : "";
  const note = [modeNote, feeNote].filter(Boolean).join(" ");
  return mode === "sandbox"
    ? { ok: true, status: "succeeded", requestId, note: note || undefined }
    : {
        ok: true,
        status: "pending",
        requestId,
        note: "CamerPay accepted the payout. Waiting for confirmation.",
      };
}

/** Poll an accepted payout until CamerPay reports its final outcome. */
export async function checkWithdrawalPayout(requestId: string): Promise<WalletResult> {
  await requireRole("admin");
  return checkWithdrawalForScope(requestId);
}

/** Poll a payout owned by the manager's active branch. */
export async function checkOwnWithdrawalPayout(requestId: string): Promise<WalletResult> {
  const { active } = await requireCapability("finance.manage");
  return checkWithdrawalForScope(requestId, active.restaurantId);
}

async function checkWithdrawalForScope(
  requestId: string,
  scopedRestaurantId?: string,
): Promise<WalletResult> {
  const supabase = createAdminClient();
  let query = supabase
    .from("withdrawal_requests")
    .select("id, restaurant_id")
    .eq("id", requestId);
  if (scopedRestaurantId) query = query.eq("restaurant_id", scopedRestaurantId);
  const { data: owned } = await query.maybeSingle();
  if (!owned) return { ok: false, reason: "notFound", error: "Withdrawal not found." };

  const outcome = await settleWithdrawalPayout(requestId);
  revalidatePath("/a/wallet");
  revalidatePath("/m/wallet");
  if (outcome.error) return { ok: false, reason: "reversalFailed", error: outcome.error };
  if (outcome.status === "not_found") {
    return { ok: false, reason: "notFound", error: "Withdrawal not found." };
  }
  return { ok: true, status: outcome.status, requestId };
}

/**
 * Reject a withdrawal — the balance is untouched.
 *
 * Conditional, and the result is CHECKED: a rejection that silently lost to
 * an approval would tell the admin the money is still in the wallet when it
 * has just been sent.
 */
export async function rejectWithdrawal(requestId: string, reason?: string): Promise<WalletResult> {
  const admin = await requireRole("admin");
  const supabase = createAdminClient();

  const { data: rejected, error } = await supabase
    .from("withdrawal_requests")
    .update({
      status: "rejected",
      note: reason?.trim() || null,
      decided_at: new Date().toISOString(),
      decided_by: admin.id,
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[wallet:rejectWithdrawal]", error.message);
    return { ok: false, reason: "rejectFailed", error: "Could not reject the request." };
  }
  if (!rejected) {
    return { ok: false, reason: "alreadyDecided", error: "That request has already been decided." };
  }

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
