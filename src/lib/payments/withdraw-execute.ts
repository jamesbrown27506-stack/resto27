import "server-only";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { getWithdrawalFeeConfig } from "@/lib/data/settings";
import { paymentMode } from "@/lib/data/billing";
import { computeWithdrawalFee } from "@/lib/payments/withdrawal-fee";
import { normalisePhone, recordWithdrawalFee } from "@/lib/payments/camerpay/client";
import { gatewayRange, payoutGateway, sendGatewayPayout } from "@/lib/payments/gateway";
import { requireConfirmedRecipient, type RecipientGate } from "@/lib/payments/recipient";
import { readCamerPayBalance } from "@/lib/payments/camerpay/balance";
import type { ActionResult } from "@/lib/data/admin-actions";
import type { getTranslator } from "@/lib/i18n/locale-server";

/**
 * Sending a withdrawal — THE one path money leaves a restaurant wallet by.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  DELIBERATELY NOT A SERVER ACTION. It moved here from wallet-actions.ts
 *  (a "use server" file, where it was safely unexported) so that the nightly
 *  scheduled payouts can send through exactly the same claim → debit → send
 *  → stamp sequence as a person at the wallet screen. Every caller checks
 *  who may send BEFORE calling it: the withdrawal gate (right + PIN + saved
 *  number) for people, the schedule's own checks for the night run.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Every failure carries a stable code as well as its prose: callers key off
 * `reason`, never off the sentence.
 */
export type WalletResult = ActionResult & {
  reason?: string;
  status?: "pending" | "succeeded" | "failed";
  requestId?: string;
};

export type Translate = Awaited<ReturnType<typeof getTranslator>>;

/**
 * Book a withdrawal fee as PLATFORM REVENUE (platform_revenue_ledger).
 *
 * The fee was only ever written to `withdrawal_fees`, a log with no
 * restaurant and no request — so the platform's own revenue ledger, which
 * already counts payment fees, never saw this income. Keyed on the request
 * (unique per source), so a retried settlement books it once; a payout that
 * later fails removes it again (withdrawals.ts). Never throws.
 */
export async function bookWithdrawalFeeRevenue(input: {
  requestId: string;
  restaurantId: string;
  gross: number;
  fee: number;
  reference: string;
}): Promise<void> {
  if (input.fee <= 0) return;
  const { error } = await createAdminClient().from("platform_revenue_ledger").insert({
    source_type: "withdrawal_fee",
    source_id: input.requestId,
    restaurant_id: input.restaurantId,
    gross: input.gross,
    amount: input.fee,
    reference: input.reference,
    note: "Restaurant withdrawal fee",
  });
  // 23505: already booked by an earlier attempt at the same settlement.
  if (error && error.code !== "23505") console.error("[wallet:feeRevenue]", input.requestId, error.message);
}

/** A recipient check that failed, in the viewer's words. */
export function recipientRefusal(gate: Extract<RecipientGate, { ok: false }>, t: Translate): WalletResult {
  switch (gate.reason) {
    case "badPhone":
      return { ok: false, reason: "badPhone", error: t("est.withdrawPhoneInvalid") };
    case "notIdentified":
      return { ok: false, reason: "recipientUnidentified", error: t("est.recipientUnidentified") };
    case "notConfirmed":
      return { ok: false, reason: "recipientNotConfirmed", error: t("est.recipientNotConfirmed") };
    case "changed":
      return { ok: false, reason: "recipientChanged", error: t("est.recipientChanged", { name: gate.name ?? "?" }) };
    default:
      return { ok: false, reason: "recipientUnavailable", error: t("est.recipientUnavailable") };
  }
}


export async function createQueuedWithdrawal(input: { restaurantId: string; profileId: string; amount: number; payoutAccountId: string; note?: string | null; recipientName?: string | null; keep?: number }) {
  const { data, error } = await createAdminClient().rpc("request_withdrawal_secure", {
    p_restaurant_id: input.restaurantId, p_profile_id: input.profileId, p_amount: input.amount,
    p_payout_account_id: input.payoutAccountId, p_note: input.note ?? null,
    p_recipient_name: input.recipientName ?? null, p_keep: input.keep ?? 0,
  });
  return { data: !error && typeof data === "string" ? { id: data } : null, error };
}

export async function executeWithdrawal(
  requestId: string,
  /** Who sends it — a person, or the owner who set a schedule (scheduled-payouts.ts). */
  actor: { id: string; email: string; role: string },
  t: Translate,
  scopedRestaurantId?: string,
  /**
   * The recipient check. `verifiedName` means the caller has just run it for
   * this number (requestWithdrawal does, before creating the request);
   * otherwise `confirmedName` is what the sender was shown and the check runs
   * here. Neither is a way round it: in live mode a payout with no confirmed
   * holder is refused below.
   */
  recipient: { verifiedName?: string | null; confirmedName?: string | null } = {},
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
    return { ok: false, reason: "notFound", error: t("est.requestNotFound") };
  }
  if (request.status !== "pending") {
    return { ok: false, reason: "alreadyDecided", error: t("est.requestDecided") };
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
      error: t("est.recipientInvalid", { phone: request.phone }),
    };
  }

  // The fee is read fresh, at payout time — a setting changed since the page
  // loaded must still hold here.
  const feeConfig = await getWithdrawalFeeConfig();
  const { fee, net } =
    feeConfig.enabled && feeConfig.percent > 0
      ? computeWithdrawalFee(gross, feeConfig.percent)
      : { fee: 0, net: gross };

  // The payout gateway's own range (CamerPay 500–500 000, SasPay 200–9 999 999).
  const payoutRange = gatewayRange(await payoutGateway());
  if (net < payoutRange.min) {
    return {
      ok: false,
      reason: "belowProviderMinimum",
      error: t("est.netBelowMin", { percent: feeConfig.percent, net, min: payoutRange.min }),
    };
  }

  const mode = await paymentMode();

  /*
    WHO GETS THIS MONEY — asked of the operator before anything is claimed.
    Still nothing has moved at this point, so a refusal costs nothing. In
    sandbox no transfer is made, so there is no recipient to protect.
  */
  let recipientName: string | null = recipient.verifiedName ?? null;
  if (mode === "live" && !recipientName) {
    const gate = await requireConfirmedRecipient(phone, recipient.confirmedName);
    if (!gate.ok) return recipientRefusal(gate, t);
    recipientName = gate.name;
  }

  if (mode === "live" && net > payoutRange.max) {
    return {
      ok: false,
      reason: "outOfProviderRange",
      error: t("est.netOutOfRange", {
        net: net.toLocaleString("fr-CM"),
        min: payoutRange.min,
        max: payoutRange.max.toLocaleString("fr-CM"),
      }),
    };
  }

  // Check platform liquidity before debiting the restaurant. A wallet is a
  // debt the platform owes; adding loyalty credit does not top up CamerPay.
  // The provider remains authoritative if another payout races this snapshot.
  if (mode === "live" && (await payoutGateway()) === "camerpay") {
    const balance = await readCamerPayBalance();
    if (balance === null) return { ok: false, reason: "providerBalanceUnavailable", error: t("est.providerBalanceUnavailable") };
    if (balance < net) {
      await writeAudit(actor, { action: "wallet.withdrawal_funding_needed", entityType: "withdrawal_request", entityId: requestId,
        summary: "Withdrawal queued: platform CamerPay balance does not cover the payout", metadata: { net, balance } });
      return { ok: false, reason: "platformFundingNeeded", error: t("est.platformFundingNeeded") };
    }
  }

  /* ── Claim ─────────────────────────────────────────────────────────────
   * Nothing above touched money. Everything below is guarded by winning
   * one atomic claim, policy check and debit. */
  const { data: claimed, error: claimError } = await supabase
    .rpc("claim_withdrawal_secure", { p_request_id: requestId, p_actor_id: actor.id });

  if (claimError) {
    console.error("[wallet:approveWithdrawal] claim failed", claimError.message);
    if (claimError.message.includes("insufficient_balance")) return { ok: false, reason: "insufficientBalance", error: t("est.walletNoLongerCovers") };
    if (claimError.message.includes("daily_limit")) return { ok: false, reason: "dailyLimit", error: t("est.withdrawNotAllowed") };
    return { ok: false, reason: "claimFailed", error: t("est.claimFailed") };
  }
  if (claimed !== true) {
    return { ok: false, reason: "alreadyDecided", error: t("est.requestDecided") };
  }

  /** Put the gross back: the transfer did NOT go out. */
  async function reverseDebit(why: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("release_withdrawal_secure", {
      p_request_id: requestId,
      p_actor_id: actor.id,
      p_reason: why,
    });
    if (error) console.error("[wallet:approveWithdrawal] reversal failed", error.message);
    return !error && data === true;
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
  // The secure claim RPC has already debited under the wallet lock.
  let replyTo: string;

  if (mode === "sandbox") {
    // No provider call, and no camerpay_requests row either: that ledger
    // exists so a confirmation can be matched to a REAL report row, and a
    // simulated entry would send the reconciler hunting a transfer nobody
    // ever asked for. The reference is deliberately unmistakable.
    replyTo = `SANDBOX-${randomUUID().slice(0, 10).toUpperCase()}`;
  } else {
    // CamerPay or SasPay, per the super admin's payout switch (gateway.ts).
    // The withdrawal id is the idempotency key: a retried request can never
    // send the money twice on SasPay.
    const sent = await sendGatewayPayout({
      phone,
      amount: net,
      idempotencyKey: `withdrawal-${requestId}`,
      description: `Retrait restaurant ${requestId.slice(0, 8)}`,
    });

    if (sent.kind === "unknown") {
      // The request may well have reached the gateway before this broke.
      console.error("[wallet:approveWithdrawal] payout outcome unknown", sent.gateway, sent.message);
      await markUnresolved(`the ${sent.gateway} payout call failed: ${sent.message}`);
      revalidatePath("/a/wallet");
      revalidatePath("/m/wallet");
      return {
        ok: false,
        reason: "payoutUnknown",
        error: t("est.payoutUnknown", { amount: gross.toLocaleString("fr-CM"), phone }),
      };
    }

    if (sent.kind === "refused") {
      // A refusal is definite: nothing left, so undo and requeue.
      const refusal = sent.message;

      if (!(await reverseDebit(`refused: ${refusal}`))) {
        // The claim stays: the wallet really is short by the gross, and the
        // row saying 'paid' is the closest thing to the truth until someone
        // credits it back.
        revalidatePath("/a/wallet");
        revalidatePath("/m/wallet");
        return {
          ok: false,
          reason: "reversalFailed",
          error: t("est.payoutRefusedNoReversal", { refusal, amount: gross.toLocaleString("fr-CM") }),
        };
      }

      await writeAudit(actor, {
        action: "wallet.withdrawal_payout_refused",
        entityType: "withdrawal_request",
        entityId: requestId,
        summary: `${sent.gateway} refused ${net.toLocaleString("fr-CM")} FCFA to ${phone} — ${refusal}`,
        metadata: { gross, fee, net, gateway: sent.gateway },
      });

      revalidatePath("/a/wallet");
      revalidatePath("/m/wallet");
      return {
        ok: false,
        reason: "payoutRefused",
        error: t("est.payoutRefused", { refusal }),
      };
    }

    replyTo = sent.replyTo;
  }

  if (fee > 0) {
    await recordWithdrawalFee({ replyTo, phone, gross, fee, net });
    await bookWithdrawalFeeRevenue({ requestId, restaurantId, gross, fee, reference: replyTo });
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
    summary: `${mode === "sandbox" ? "Simulated a payout of" : "Paid"} ${net.toLocaleString("fr-CM")} FCFA to ${phone}${recipientName ? ` (${recipientName})` : ""}${fee > 0 ? ` (${fee.toLocaleString("fr-CM")} FCFA fee withheld)` : ""}`,
    // The holder's name as the operator gave it when the sender confirmed.
    metadata: { gross, fee, net, replyTo, mode, recipientName },
  });

  revalidatePath("/a/wallet");
  revalidatePath("/m/wallet");

  const feeNote = fee > 0 ? t("est.withdrawFeeNote", { fee: fee.toLocaleString("fr-CM") }) : "";
  const modeNote = mode === "sandbox" ? t("est.withdrawSandboxNote") : "";
  const note = [modeNote, feeNote].filter(Boolean).join(" ");
  return mode === "sandbox"
    ? { ok: true, status: "succeeded", requestId, note: note || undefined }
    : {
        ok: true,
        status: "pending",
        requestId,
        note: t("est.withdrawAcceptedPending"),
      };
}
