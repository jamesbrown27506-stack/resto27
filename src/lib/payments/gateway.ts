import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import {
  acceptedTransactionId,
  confirmTransaction,
  isPayableAmount,
  latestTransactionId,
  MAX_AMOUNT_XAF,
  MIN_AMOUNT_XAF,
  recordAcceptedRequest,
  sendPayout,
} from "@/lib/payments/camerpay/client";
import { SASPAY_MAX_XAF, SASPAY_MIN_XAF } from "@/lib/payments/saspay/cameroon";
import { saspayConfigured, startSaspayPayout, verifySaspayPayout } from "@/lib/payments/saspay/client";

/**
 * WHICH GATEWAY MOVES CAMEROON MONEY — the one switch (0063).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Two independent settings, changed only by a super admin
 *  (Payments → Gateways):
 *
 *    payment_provider_collect  customers paying (orders, deposits,
 *                              subscriptions, wallet top-ups)
 *    payment_provider_payout   money going out (refunds, withdrawals)
 *
 *  Values: "camerpay" (default) | "saspay". SasPay is only used when its
 *  key is configured — a switch set to saspay with no SASPAY_API_KEY falls
 *  back to CamerPay rather than failing every payment.
 *
 *  THE SWITCH DECIDES NEW MONEY ONLY. Every attempt stores its provider
 *  (payment_attempts.provider) and every payout its tracking id with a
 *  "saspay:" prefix (refunds.reply_to, withdrawal_requests.reply_to), so
 *  confirmation always goes back to the gateway that took the money, even
 *  after the switch is flipped mid-flight.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type GatewayId = "camerpay" | "saspay";

export const SASPAY_REPLY_PREFIX = "saspay:";

async function readGateway(key: "payment_provider_collect" | "payment_provider_payout"): Promise<GatewayId> {
  const { data, error } = await createAdminClient().from("settings").select("value").eq("key", key).maybeSingle();
  if (error) console.error("[gateway:read]", key, error.message);
  const wanted = data?.value === "saspay" ? "saspay" : "camerpay";
  if (wanted === "saspay" && !saspayConfigured()) {
    console.error(`[gateway] ${key}=saspay but SASPAY_API_KEY is not set — using CamerPay.`);
    return "camerpay";
  }
  return wanted;
}

export function collectionGateway(): Promise<GatewayId> {
  return readGateway("payment_provider_collect");
}

export function payoutGateway(): Promise<GatewayId> {
  return readGateway("payment_provider_payout");
}

/** What each gateway accepts per transaction, in whole XAF. */
export function gatewayRange(gateway: GatewayId): { min: number; max: number } {
  return gateway === "saspay"
    ? { min: SASPAY_MIN_XAF, max: SASPAY_MAX_XAF }
    : { min: MIN_AMOUNT_XAF, max: MAX_AMOUNT_XAF };
}

export function payableOn(gateway: GatewayId, amount: number): boolean {
  if (gateway === "camerpay") return isPayableAmount(amount);
  const { min, max } = gatewayRange(gateway);
  return Number.isInteger(amount) && amount >= min && amount <= max;
}

/* ── Payouts, whichever gateway ─────────────────────────────────────────── */

export type PayoutStart =
  /** Accepted; `replyTo` is what confirmGatewayPayout() takes later. */
  | { kind: "accepted"; replyTo: string; gateway: GatewayId }
  /** Definitely NOT sent — safe to put the money back / retry. */
  | { kind: "refused"; message: string; gateway: GatewayId }
  /** May or may not have been sent — never resend automatically. */
  | { kind: "unknown"; message: string; gateway: GatewayId };

/**
 * Send `amount` XAF to a Cameroon number through the payout gateway.
 * `idempotencyKey` must identify the intent (refund id, withdrawal id): a
 * retry with the same key can never pay twice on SasPay.
 */
export async function sendGatewayPayout(input: {
  phone: string;
  amount: number;
  idempotencyKey: string;
  description: string;
}): Promise<PayoutStart> {
  const gateway = await payoutGateway();

  if (gateway === "saspay") {
    let result;
    try {
      result = await startSaspayPayout(input);
    } catch (error) {
      return { kind: "unknown", gateway, message: error instanceof Error ? error.message : String(error) };
    }
    if (!result.ok) {
      // A 4xx is SasPay refusing before anything moved; a 5xx is ambiguous.
      return result.error.status >= 500
        ? { kind: "unknown", gateway, message: `${result.error.code}: ${result.error.message}` }
        : { kind: "refused", gateway, message: `${result.error.code}: ${result.error.message}` };
    }
    if (!result.data.id) return { kind: "unknown", gateway, message: "accepted without a transaction id" };
    return { kind: "accepted", gateway, replyTo: SASPAY_REPLY_PREFIX + result.data.id };
  }

  const afterId = await latestTransactionId();
  let response;
  try {
    response = await sendPayout(input.phone, input.amount);
  } catch (error) {
    return { kind: "unknown", gateway, message: error instanceof Error ? error.message : String(error) };
  }
  if (!(response.httpStatus === 202 || response.etat)) {
    return { kind: "refused", gateway, message: response.message ?? `HTTP ${response.httpStatus}` };
  }
  const replyTo = acceptedTransactionId(response);
  if (!replyTo) return { kind: "unknown", gateway, message: "accepted without a replyTo" };
  await recordAcceptedRequest({
    replyTo,
    direction: "payout",
    phone: input.phone,
    amount: input.amount,
    afterId: afterId ?? null,
    startedAt: new Date().toISOString(),
  });
  return { kind: "accepted", gateway, replyTo };
}

/**
 * Did a sent payout land? Dispatches on the tracking id: "saspay:<id>" goes
 * to SasPay's /payouts/{id}/verify/, anything else to CamerPay's report.
 */
export async function confirmGatewayPayout(
  replyTo: string,
  facts: { phone?: string; amount: number },
): Promise<{ status: "success" | "failed" | "pending"; rowId?: string }> {
  if (replyTo.startsWith(SASPAY_REPLY_PREFIX)) {
    const id = replyTo.slice(SASPAY_REPLY_PREFIX.length);
    const result = await verifySaspayPayout(id);
    if (!result.ok) {
      // 404: SasPay has no such payout — it was never created.
      return result.error.status === 404 ? { status: "failed" } : { status: "pending" };
    }
    return { status: result.data.verdict, rowId: result.data.verdict === "success" ? replyTo : undefined };
  }

  const outcome = await confirmTransaction(replyTo, {
    direction: "payout",
    phone: facts.phone,
    amount: facts.amount,
  });
  return { status: outcome.status, rowId: outcome.rowId ?? undefined };
}
