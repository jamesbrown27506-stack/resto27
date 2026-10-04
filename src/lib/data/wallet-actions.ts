"use server";

import { getTranslator } from "@/lib/i18n/locale-server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { ordersInProgressHold } from "./wallet";
import { requireRole, superAdminOrError } from "@/lib/auth/session";
import { requireCapability } from "@/lib/auth/branch";
import { DICTIONARIES, interpolate } from "@/lib/i18n/dictionaries";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { paymentMode } from "./billing";
// MIN_AMOUNT_XAF stays the platform floor for a withdrawal REQUEST (500 FCFA),
// whichever gateway later sends it.
import { MIN_AMOUNT_XAF, normalisePhone, recordWithdrawalFee } from "@/lib/payments/camerpay/client";
import { getWithdrawalFeeConfig } from "./settings";
import { computeWithdrawalFee } from "@/lib/payments/withdrawal-fee";
import type { ActionResult } from "./admin-actions";
import { checkPaymentAttempt, initiatePaymentAttempt, settlePayment } from "@/lib/payments/collect";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";
import { settleWithdrawalPayout } from "@/lib/payments/withdrawals";
import { identifyRecipient, requireConfirmedRecipient } from "@/lib/payments/recipient";
import {
  bookWithdrawalFeeRevenue,
  executeWithdrawal,
  recipientRefusal,
  type Translate,
  type WalletResult,
} from "@/lib/payments/withdraw-execute";
import type { BranchContext } from "@/lib/auth/branch";
import { BRANCH_ROLE_LABEL, type BranchRole } from "@/lib/capabilities";
import {
  checkWithdrawalPin,
  getPayoutAccount,
  notifyOwners,
  resolveWithdrawRight,
  withdrawControlsReady,
  withdrawnInLast24h,
} from "@/lib/wallet/controls";
import { dailyAllowance, maskPhone, type WithdrawRight } from "@/lib/wallet/withdraw-rules";

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
 * Every failure carries a stable code as well as its prose: callers key off
 * `reason`, never off the sentence. Same convention as checkout-actions. The
 * prose follows the viewer's language on the restaurant side; the admin-only
 * functions stay English, per the admin-area convention.
 */
// The result shape and the executor live in lib/payments/withdraw-execute.ts
// (server-only), so the nightly scheduled payouts can run the very same path.

/**
 * The admin paths share executeWithdrawal / checkWithdrawalForScope with the
 * manager's own, and the admin area answers in English whatever the viewer's
 * cookie says. They hand these helpers this instead of the viewer's translator.
 */
const englishT: Translate = (key, vars) => interpolate(DICTIONARIES.en[key] ?? key, vars);

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
  const gate = await superAdminOrError(); // money in by hand — super admins only
  if (!gate.ok) return { ...gate, reason: "superAdminOnly" };
  const admin = gate.admin;
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
  const gate = await superAdminOrError(); // chooses whose wallet is credited — super admins only
  if (!gate.ok) return { ...gate, reason: "superAdminOnly" };
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
    returnPath: "/m/wallet",
  });
  if (!initiated.ok || !initiated.attemptId) {
    return { ok: false, reason: initiated.reason, error: initiated.error ?? "CamerPay payment failed." };
  }
  if (initiated.status === "pending") {
    return { ok: true, status: "pending", attemptId: initiated.attemptId, instruction: initiated.instruction };
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
/* ── Who receives a withdrawal ─────────────────────────────────────────── */

/**
 * Step 1 of a withdrawal: whose account is this number?
 *
 * The restaurant types a number; before it can confirm anything it is shown
 * the name registered on that Mobile Money account (lib/payments/recipient).
 * The name returned here is what the confirmation dialog displays — and what
 * requestWithdrawal / processOwnWithdrawal must be handed back, where it is
 * checked against the operator again before any money moves.
 *
 * In sandbox nothing is sent anywhere, so nothing is looked up: `name` is
 * null and the screen says the holder is not checked in test mode.
 */
export async function verifyWithdrawalRecipient(
  phone: string,
): Promise<ActionResult & { reason?: string; name?: string | null }> {
  const t = await getTranslator();
  const { active } = await requireCapability("finance.manage");

  if ((await paymentMode()) === "sandbox") return { ok: true, name: null };

  const limited = await rateLimit({
    key: "wallet:identify",
    limit: 30,
    windowMs: 60 * 60_000,
    identifier: active.restaurantId,
  });
  if (!limited.ok) return { ok: false, reason: "rateLimited", error: t("est.recipientRateLimited") };

  const lookup = await identifyRecipient(phone);
  if (!lookup.ok) return recipientRefusal(lookup, t);
  return { ok: true, name: lookup.name };
}

/* ── Withdrawal requests ───────────────────────────────────────────────── */

/**
 * The three questions every withdrawal answers before a franc moves (0073):
 * may this person withdraw here, is it really them (their PIN), and is the
 * platform able to tell (the control tables exist). In that order — someone
 * without the right never spends a PIN attempt, and a PIN is never checked
 * against a table that is not there.
 *
 * FAIL CLOSED: without 0073 there is no PIN to ask for, and a withdrawal is
 * refused rather than sent unchecked.
 */
async function withdrawGate(
  context: BranchContext,
  pin: string,
  t: Translate,
): Promise<{ ok: true; right: Extract<WithdrawRight, { allowed: true }> } | (WalletResult & { ok: false })> {
  if (!(await withdrawControlsReady())) {
    return { ok: false, reason: "controlsMissing", error: t("est.withdrawControlsMissing") };
  }

  const right = await resolveWithdrawRight(context);
  if (!right.allowed) {
    return {
      ok: false,
      reason: right.reason,
      error: t(right.reason === "impersonating" ? "est.withdrawImpersonating" : "est.withdrawNotAllowed"),
    };
  }

  const pinCheck = await checkWithdrawalPin(context.profile.id, pin.trim(), {
    restaurantId: context.active.restaurantId,
    personName: context.profile.name,
  });
  if (!pinCheck.ok) {
    switch (pinCheck.reason) {
      case "noPin":
        return { ok: false, reason: "noPin", error: t("est.withdrawNoPin") };
      case "locked":
        return {
          ok: false,
          reason: "pinLocked",
          error: t("est.withdrawPinLocked", {
            time: new Date(pinCheck.lockedUntil).toLocaleTimeString("fr-CM", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Africa/Douala",
            }),
          }),
        };
      default:
        return { ok: false, reason: "pinWrong", error: t("est.withdrawPinWrong", { left: pinCheck.attemptsLeft }) };
    }
  }

  return { ok: true, right };
}

/**
 * Tell every owner that money left — whoever sent it, the owner included
 * (a receipt for them, an alarm if it was not them). Never throws.
 */
async function announceWithdrawal(
  context: BranchContext,
  input: { amount: number; phone: string; recipientName: string | null },
): Promise<void> {
  const role = BRANCH_ROLE_LABEL[context.active.role as BranchRole] ?? context.active.role;
  const where =
    context.active.isPrimary || !context.active.branchLabel
      ? context.active.restaurantName
      : `${context.active.restaurantName} — ${context.active.branchLabel}`;
  const to = `${maskPhone(input.phone)}${input.recipientName ? ` (${input.recipientName})` : ""}`;

  await notifyOwners(context.active.restaurantId, {
    tone: "info",
    withdrawalKind: "sent",
    amount: input.amount,
    detail: `${context.profile.name} (${role.toLowerCase()}) a retiré ${input.amount.toLocaleString("fr-CM")} FCFA de ${where} vers ${to}.`,
  });
}

/**
 * A restaurant takes its money OUT. The GROSS is what they ask for; the fee
 * (if enabled) is withheld from the payout.
 *
 * Since 0073 the destination is not typed: it is one of the numbers the
 * owner saved (payout_accounts), named by id — so a delegate can choose
 * WHICH of the owner's numbers, never a number of their own.
 */
export async function requestWithdrawal(input: {
  amount: number;
  /** One of the owner's saved numbers (payout_accounts.id). */
  payoutAccountId: string;
  /** The withdrawer's own PIN. */
  pin: string;
  note?: string;
}): Promise<WalletResult> {
  const t = await getTranslator();
  const context = await requireCapability("finance.manage");
  const { active, profile } = context;

  const amount = Math.round(input.amount);
  if (!Number.isInteger(amount) || amount < MIN_AMOUNT_XAF) {
    return { ok: false, reason: "belowMinimum", error: t("est.withdrawMin", { amount: MIN_AMOUNT_XAF }) };
  }

  const gate = await withdrawGate(context, input.pin, t);
  if (!gate.ok) return gate;

  const account = await getPayoutAccount(active.restaurantId, input.payoutAccountId);
  if (!account) return { ok: false, reason: "accountMissing", error: t("est.withdrawAccountMissing") };

  const phone = normalisePhone(account.phone);
  if (!phone) {
    return {
      ok: false,
      reason: "badPhone",
      error: t("est.withdrawPhoneInvalid"),
    };
  }

  // A delegate's ceiling over the last 24 hours, at this branch.
  if (gate.right.kind === "delegate" && gate.right.dailyLimit !== null) {
    const left = dailyAllowance(gate.right.dailyLimit, await withdrawnInLast24h(active.restaurantId, profile.id)) ?? 0;
    if (amount > left) {
      return {
        ok: false,
        reason: "dailyLimit",
        error: t("est.withdrawDailyLimit", {
          limit: gate.right.dailyLimit.toLocaleString("fr-CM"),
          left: left.toLocaleString("fr-CM"),
        }),
      };
    }
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
      error: t("est.withdrawRateLimited"),
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
  // Paid orders still in progress are refundable, so their share stays in
  // the wallet until delivered (ordersInProgressHold).
  const held = await ordersInProgressHold(active.restaurantId);
  const available = balance - queued - held;

  if (available < amount) {
    return {
      ok: false,
      reason: "insufficientBalance",
      error:
        held > 0
          ? t("est.withdrawHeld", {
              balance: balance.toLocaleString("fr-CM"),
              held: held.toLocaleString("fr-CM"),
              available: Math.max(0, available).toLocaleString("fr-CM"),
            })
          : queued
            ? t("est.withdrawQueued", {
                balance: balance.toLocaleString("fr-CM"),
                queued: queued.toLocaleString("fr-CM"),
                available: Math.max(0, available).toLocaleString("fr-CM"),
              })
            : t("est.withdrawShort", { balance: balance.toLocaleString("fr-CM"), amount: amount.toLocaleString("fr-CM") }),
    };
  }

  // The holder is checked BEFORE the request exists: a number that fails the
  // check must not leave a "pending" request behind asking to be sent. The
  // name to match is the one the OWNER confirmed when saving the number, so
  // a number since handed to someone else by the operator is caught here.
  let recipientName: string | null = account.holderName;
  if ((await paymentMode()) === "live") {
    if (!account.holderName) {
      return { ok: false, reason: "accountUnverified", error: t("est.withdrawAccountUnverified") };
    }
    const recipient = await requireConfirmedRecipient(phone, account.holderName);
    if (!recipient.ok) return recipientRefusal(recipient, t);
    recipientName = recipient.name;
  }

  const { data: created, error } = await supabase
    .from("withdrawal_requests")
    .insert({
      restaurant_id: active.restaurantId,
      requested_by: profile.id,
      amount,
      phone,
      note: input.note?.trim() || null,
      recipient_name: recipientName,
      requester_role: active.role,
      payout_account_id: account.id,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("[wallet:requestWithdrawal]", error?.message ?? "missing row");
    return { ok: false, reason: "insertFailed", error: t("est.withdrawStartFailed") };
  }

  const result = await executeWithdrawal(String(created.id), profile, t, active.restaurantId, {
    verifiedName: recipientName,
  });
  if (result.ok) await announceWithdrawal(context, { amount, phone, recipientName });
  return result;
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
export async function approveWithdrawal(requestId: string, confirmedName?: string | null): Promise<WalletResult> {
  const gate = await superAdminOrError(); // sends real money out — super admins only
  if (!gate.ok) return { ...gate, reason: "superAdminOnly" };
  return executeWithdrawal(requestId, gate.admin, englishT, undefined, { confirmedName });
}

/**
 * Start or retry a withdrawal belonging to the manager's active branch.
 *
 * A retry is a payout like any other: the same right, the same PIN, the same
 * holder check. The name matched is the one stored on the request (0073);
 * `confirmedName` is only for requests made before that, which never stored
 * one — the sender is shown the holder again and confirms it.
 */
export async function processOwnWithdrawal(
  requestId: string,
  pin: string,
  confirmedName?: string | null,
): Promise<WalletResult> {
  const t = await getTranslator();
  const context = await requireCapability("finance.manage");
  const { active, profile } = context;
  const limited = await rateLimit({
    key: "wallet:withdraw-retry",
    limit: 5,
    windowMs: 60 * 60_000,
    identifier: active.restaurantId,
  });
  if (!limited.ok) {
    return { ok: false, reason: "rateLimited", error: t("est.payoutRateLimited") };
  }

  const gate = await withdrawGate(context, pin, t);
  if (!gate.ok) return gate;

  const { data: row } = await createAdminClient()
    .from("withdrawal_requests")
    .select("*")
    .eq("id", requestId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();
  const stored = row as {
    amount?: number;
    phone?: string;
    recipient_name?: string | null;
    requested_by?: string | null;
    payout_account_id?: string | null;
  } | null;
  const name = stored?.recipient_name ?? confirmedName ?? null;

  // A delegate re-sends only their OWN requests (an owner's large request is
  // the owner's to send), and never to a number the owner has since removed.
  if (stored && gate.right.kind === "delegate" && stored.requested_by !== profile.id) {
    return { ok: false, reason: "notOwnRequest", error: t("est.withdrawNotAllowed") };
  }
  if (stored?.payout_account_id && !(await getPayoutAccount(active.restaurantId, stored.payout_account_id))) {
    return { ok: false, reason: "accountMissing", error: t("est.withdrawAccountMissing") };
  }

  const result = await executeWithdrawal(requestId, profile, t, active.restaurantId, { confirmedName: name });
  if (result.ok && stored) {
    await announceWithdrawal(context, {
      amount: Number(stored.amount ?? 0),
      phone: String(stored.phone ?? ""),
      recipientName: name,
    });
  }
  return result;
}

/** Poll an accepted payout until CamerPay reports its final outcome. */
export async function checkWithdrawalPayout(requestId: string): Promise<WalletResult> {
  await requireRole("admin");
  return checkWithdrawalForScope(requestId, englishT);
}

/** Poll a payout owned by the manager's active branch. */
export async function checkOwnWithdrawalPayout(requestId: string): Promise<WalletResult> {
  const { active } = await requireCapability("finance.manage");
  const t = await getTranslator();
  return checkWithdrawalForScope(requestId, t, active.restaurantId);
}

async function checkWithdrawalForScope(
  requestId: string,
  t: Translate,
  scopedRestaurantId?: string,
): Promise<WalletResult> {
  const supabase = createAdminClient();
  let query = supabase
    .from("withdrawal_requests")
    .select("id, restaurant_id")
    .eq("id", requestId);
  if (scopedRestaurantId) query = query.eq("restaurant_id", scopedRestaurantId);
  const { data: owned } = await query.maybeSingle();
  if (!owned) return { ok: false, reason: "notFound", error: t("est.withdrawalNotFound") };

  const outcome = await settleWithdrawalPayout(requestId);
  revalidatePath("/a/wallet");
  revalidatePath("/m/wallet");
  // withdrawals.ts sets `error` in exactly one case — the payout failed and
  // the wallet refund could not be recorded — so it maps to that one key.
  if (outcome.error) return { ok: false, reason: "reversalFailed", error: t("est.payoutRefundNotRecorded") };
  if (outcome.status === "not_found") {
    return { ok: false, reason: "notFound", error: t("est.withdrawalNotFound") };
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
  const gate = await superAdminOrError(); // a withdrawal decision — super admins only
  if (!gate.ok) return { ...gate, reason: "superAdminOnly" };
  const admin = gate.admin;
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

/**
 * Settle a payout whose outcome was UNKNOWN (executeWithdrawal → markUnresolved).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Such a row is `paid` with no operator reference and no decision date:
 *  the wallet is debited, and nobody can tell from here whether the money
 *  reached the phone. Nothing automatic can answer that — CamerPay's
 *  callbacks are unsigned and the call that would have told us is the one
 *  that failed. A SUPER ADMIN looks it up in the provider's own report and
 *  records the answer:
 *
 *    sent      — with the operator reference they found. The row is stamped
 *                paid for good and the fee is booked, as a normal payout.
 *    not_sent  — the row is claimed as rejected FIRST (so two admins cannot
 *                both refund it), then the gross is credited back. A failed
 *                credit hands the claim back rather than leave a rejected
 *                row with no money behind it.
 *
 *  Either way the owners are told, and the audit log names who decided.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function resolveUnresolvedWithdrawal(input: {
  requestId: string;
  outcome: "sent" | "not_sent";
  /** The operator's transaction reference — required for "sent". */
  reference?: string;
}): Promise<WalletResult> {
  const gate = await superAdminOrError();
  if (!gate.ok) return { ...gate, reason: "superAdminOnly" };
  const admin = gate.admin;
  const supabase = createAdminClient();

  const { data: row } = await supabase.from("withdrawal_requests").select("*").eq("id", input.requestId).maybeSingle();
  const request = row as {
    id: string;
    restaurant_id: string;
    amount: number;
    phone: string;
    status: string;
    note: string | null;
    reply_to: string | null;
    decided_at: string | null;
  } | null;

  if (!request) return { ok: false, reason: "notFound", error: "Withdrawal not found." };
  if (request.status !== "paid" || request.reply_to || request.decided_at) {
    return { ok: false, reason: "notUnresolved", error: "This withdrawal is not waiting for a manual decision." };
  }

  const gross = Number(request.amount);
  const stamp = new Date().toISOString();
  const marker = (text: string) => (request.note ? `${request.note} · ${text}` : text);

  if (input.outcome === "sent") {
    const reference = input.reference?.trim() ?? "";
    if (reference.length < 4) {
      return { ok: false, reason: "reference", error: "Enter the operator's transaction reference from the provider report." };
    }

    const feeConfig = await getWithdrawalFeeConfig();
    const { fee, net } =
      feeConfig.enabled && feeConfig.percent > 0 ? computeWithdrawalFee(gross, feeConfig.percent) : { fee: 0, net: gross };

    const { data: settled, error } = await supabase
      .from("withdrawal_requests")
      .update({
        reply_to: `manual:${reference}`,
        fee: fee > 0 ? fee : null,
        net,
        decided_at: stamp,
        note: marker(`RESOLVED: sent (ref ${reference}) by ${admin.email}`),
      })
      .eq("id", request.id)
      .eq("status", "paid")
      .is("reply_to", null)
      .is("decided_at", null)
      .select("id")
      .maybeSingle();

    if (error) return { ok: false, reason: "saveFailed", error: "Could not record the outcome." };
    if (!settled) return { ok: false, reason: "alreadyDecided", error: "Someone else resolved it a moment ago." };

    if (fee > 0) {
      await recordWithdrawalFee({ replyTo: `manual:${reference}`, phone: request.phone, gross, fee, net });
      await bookWithdrawalFeeRevenue({
        requestId: request.id,
        restaurantId: request.restaurant_id,
        gross,
        fee,
        reference: `manual:${reference}`,
      });
    }
  } else {
    const { data: claimed, error } = await supabase
      .from("withdrawal_requests")
      .update({
        status: "rejected",
        decided_at: stamp,
        decided_by: admin.id,
        note: marker(`RESOLVED: not sent — credited back by ${admin.email}`),
      })
      .eq("id", request.id)
      .eq("status", "paid")
      .is("reply_to", null)
      .is("decided_at", null)
      .select("id")
      .maybeSingle();

    if (error) return { ok: false, reason: "saveFailed", error: "Could not record the outcome." };
    if (!claimed) return { ok: false, reason: "alreadyDecided", error: "Someone else resolved it a moment ago." };

    const { error: creditError } = await supabase.rpc("wallet_credit", {
      p_restaurant_id: request.restaurant_id,
      p_amount: gross,
      p_kind: "adjustment",
      p_note: `Withdrawal ${request.id} not sent — credited back`,
      p_reference: request.id,
    });

    if (creditError) {
      // Hand the claim back: a rejected row with no money returned is worse
      // than an unresolved one, which still asks for a decision.
      await supabase
        .from("withdrawal_requests")
        .update({ status: "paid", decided_at: null, decided_by: null, note: request.note })
        .eq("id", request.id)
        .eq("status", "rejected");
      console.error("[wallet:resolveUnresolved] credit back failed", creditError.message);
      return { ok: false, reason: "creditFailed", error: "The wallet could not be credited back. Nothing was changed." };
    }
  }

  await writeAudit(admin, {
    action: input.outcome === "sent" ? "wallet.withdrawal_resolved_sent" : "wallet.withdrawal_resolved_refunded",
    entityType: "withdrawal_request",
    entityId: request.id,
    summary:
      input.outcome === "sent"
        ? `Confirmed the unresolved payout of ${gross.toLocaleString("fr-CM")} FCFA as SENT (ref ${input.reference?.trim()})`
        : `Recorded the unresolved payout of ${gross.toLocaleString("fr-CM")} FCFA as NOT SENT and credited it back`,
  });

  await notifyOwners(request.restaurant_id, {
    tone: input.outcome === "sent" ? "success" : "warning",
    withdrawalKind: "sent",
    amount: gross,
    detail:
      input.outcome === "sent"
        ? `Le retrait de ${gross.toLocaleString("fr-CM")} FCFA vers ${maskPhone(request.phone)} est confirmé par l'équipe de la plateforme.`
        : `Le retrait de ${gross.toLocaleString("fr-CM")} FCFA vers ${maskPhone(request.phone)} n'a pas abouti : le montant a été recrédité sur votre portefeuille.`,
  });

  revalidatePath("/a/wallet");
  revalidatePath("/m/wallet");
  return { ok: true };
}
