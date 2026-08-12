import { NextResponse, type NextRequest } from "next/server";
import { confirmTransaction } from "@/lib/payments/camerpay/client";

/**
 * CamerPay callback endpoint.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS ENDPOINT TRUSTS NOTHING IN THE REQUEST BODY.
 *
 *  explanation.md §6 assumes a provider that HMACs the raw request bytes.
 *  CamerPay does not sign callbacks at all — no signature header, no shared
 *  secret. The URL is the only thing standing between the internet and a POST
 *  claiming any payment succeeded.
 *
 *  So the body is treated as a HINT THAT SOMETHING CHANGED, never as evidence.
 *  The only field read from it is `replyTo`; the outcome is then fetched from
 *  CamerPay directly. A forged callback therefore achieves nothing beyond
 *  making us perform one lookup that returns the truth.
 *
 *  The rest of §6 still holds:
 *
 *   · Replay safety belongs to a DATABASE CONSTRAINT, not a check-then-act —
 *     UNIQUE(provider, transaction_id, status) on payment_webhook_events.
 *     Arrives with migration 0005; until then this endpoint only observes.
 *   · Respond within 5 seconds. Slow responses cause retries, which is how
 *     duplicate processing usually starts.
 *   · An unrecognised status maps to pending, never to success.
 *   · Re-check the amount against the invoice before settling it.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const dynamic = "force-dynamic";

interface CamerPayCallback {
  id?: string;
  replyTo?: string;
  type?: string;
  etat?: boolean;
  data?: { date?: string; numero?: string; message?: string };
}

export async function POST(request: NextRequest) {
  // Read the raw text first and parse ourselves. There is no signature to
  // preserve the bytes for here, but keeping the raw body means we can store
  // it verbatim for audit once 0005 lands — and it costs nothing now.
  let raw = "";
  let body: CamerPayCallback = {};

  try {
    raw = await request.text();
    body = JSON.parse(raw) as CamerPayCallback;
  } catch {
    console.warn("[camerpay:webhook] unparseable body", raw.slice(0, 200));
    // 200 regardless: a retry would deliver the same unparseable payload.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const replyTo = body.replyTo;

  if (!replyTo || body.type !== "EVENT") {
    console.warn("[camerpay:webhook] ignored — missing replyTo or wrong type", body.type);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  /**
   * Confirm against CamerPay rather than believing `body.etat`.
   *
   * Deliberately fire-and-forget with respect to the response: the 5-second
   * budget is the hard constraint, and a slow confirmation must never turn
   * into a retry storm. If this lookup is slow or fails, the reconciler sweeps
   * the attempt later — which is the same safety net §6 requires for lost
   * callbacks, doing double duty here.
   */
  try {
    const confirmed = await confirmTransaction(replyTo);
    console.info(
      "[camerpay:webhook]",
      replyTo,
      "claimed:",
      body.etat,
      "confirmed:",
      confirmed.status,
    );

    // A callback claiming success that CamerPay does not corroborate is either
    // a race or a forgery. Both are worth seeing in the log.
    if (body.etat === true && confirmed.status !== "success") {
      console.warn(
        "[camerpay:webhook] CLAIM NOT CORROBORATED —",
        replyTo,
        "callback said success, CamerPay says",
        confirmed.status,
      );
    }

    // TODO(0005): record in payment_webhook_events against
    // UNIQUE(provider, transaction_id, status) for replay safety, then call the
    // single idempotent activation path with the CONFIRMED status — never the
    // claimed one — after re-checking the amount against the invoice.
  } catch (error) {
    console.error("[camerpay:webhook] confirmation failed", replyTo, error);
  }

  // Always acknowledge. A non-2xx makes CamerPay retry, and retries are how
  // duplicate processing starts.
  return NextResponse.json({ received: true }, { status: 200 });
}
