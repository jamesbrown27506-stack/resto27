import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { settleConfirmedAttempt } from "@/lib/payments/collect";
import { settleRefundByReplyTo } from "@/lib/payments/refund-payouts";
import { settleWithdrawalPayoutByReplyTo } from "@/lib/payments/withdrawals";
import { SASPAY_REPLY_PREFIX } from "@/lib/payments/gateway";
import { verifySaspaySignature } from "@/lib/payments/saspay/cameroon";

/**
 * SasPay webhook endpoint — https://<site>/api/webhooks/saspay
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  SIGNED, AND STILL ONLY A HINT.
 *
 *  Unlike CamerPay, SasPay signs every delivery: HMAC-SHA256 over
 *  `${X-Webhook-Timestamp}.${raw body}` with the endpoint's signing secret
 *  (SASPAY_WEBHOOK_SECRET), and a delivery older than five minutes is
 *  refused so a captured request cannot be replayed. An unsigned or
 *  mis-signed request is rejected with 401 before anything is read.
 *
 *  Even a valid signature only tells us WHICH transaction changed. The
 *  outcome is re-read from SasPay's /verify/ endpoint through the same
 *  resolver the browser poll and the reconciler use — so the webhook, the
 *  poll and the cron can race and still credit exactly once.
 *
 *  Configure in the SasPay dashboard (Webhooks): URL as above, events
 *  transaction.success, transaction.failed, transaction.cancelled.
 *  SasPay retries 5 times (+30 s, +5 min, +30 min, +2 h); any non-2xx here
 *  means "try again later", so only a bad signature gets a 4xx.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32_768;

export async function POST(request: NextRequest) {
  const secret = process.env.SASPAY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Fail closed: without the secret nothing can be authenticated.
    console.error("[saspay:webhook] SASPAY_WEBHOOK_SECRET is not set — delivery refused");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const valid = verifySaspaySignature({
    rawBody,
    signature: request.headers.get("x-webhook-signature"),
    timestamp: request.headers.get("x-webhook-timestamp"),
    secret,
  });
  if (!valid) {
    console.warn("[saspay:webhook] rejected: bad signature or stale timestamp");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: { event?: string; data?: { id?: string; type?: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const event = String(payload.event ?? request.headers.get("x-webhook-event") ?? "");
  const id = typeof payload.data?.id === "string" ? payload.data.id : "";

  if (event === "webhook.test") return NextResponse.json({ received: true, test: true });
  if (!event.startsWith("transaction.") || !id) {
    // Settlement / wallet-transfer events concern SasPay's own dashboard
    // withdrawals, not money this app moved. Acknowledge and ignore.
    return NextResponse.json({ received: true, ignored: event || "unknown" });
  }

  try {
    // A collection we started?
    const { data: attempt } = await createAdminClient()
      .from("payment_attempts")
      .select("id")
      .eq("provider", "saspay")
      .eq("transaction_id", id)
      .maybeSingle();
    if (attempt?.id) {
      const settled = await settleConfirmedAttempt(attempt.id as string);
      return NextResponse.json({ received: true, kind: "collection", status: settled.status ?? "pending" });
    }

    // A payout we sent (refund or restaurant withdrawal)?
    const replyTo = SASPAY_REPLY_PREFIX + id;
    const refund = await settleRefundByReplyTo(replyTo);
    if (refund !== "not_found") return NextResponse.json({ received: true, kind: "refund", status: refund });

    const withdrawal = await settleWithdrawalPayoutByReplyTo(replyTo);
    if (withdrawal.status !== "not_found") {
      return NextResponse.json({ received: true, kind: "withdrawal", status: withdrawal.status });
    }

    return NextResponse.json({ received: true, kind: "unknown" });
  } catch (error) {
    // Our failure, not SasPay's: a 500 makes SasPay retry later, and the
    // reconciler sweeps the attempt meanwhile.
    console.error("[saspay:webhook] handling failed", id, error);
    return NextResponse.json({ error: "temporary failure" }, { status: 500 });
  }
}
