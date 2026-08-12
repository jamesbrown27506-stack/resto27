import { NextResponse, type NextRequest } from "next/server";
import { confirmTransaction } from "@/lib/payments/camerpay/client";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * CamerPay callback endpoint.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS ENDPOINT TRUSTS NOTHING IN THE REQUEST BODY.
 *
 *  CamerPay does not sign callbacks — no signature header, no shared secret.
 *  The URL is the only thing standing between the internet and a POST claiming
 *  any payment succeeded.
 *
 *  So the body is a HINT THAT SOMETHING CHANGED, never evidence. The only
 *  field read from it is `replyTo`; the outcome is then fetched from CamerPay
 *  directly. A forged callback achieves nothing beyond making us perform one
 *  lookup that returns the truth.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EVERY CALLBACK IS RECORDED BEFORE IT IS INTERPRETED. That is what makes
 * "did the callback ever arrive?" answerable — previously this logged to the
 * console and kept nothing, so a missing callback and a mishandled one looked
 * identical from the outside.
 */

export const dynamic = "force-dynamic";

interface CamerPayCallback {
  id?: string;
  replyTo?: string;
  type?: string;
  etat?: boolean;
  data?: { date?: string; numero?: string; message?: string; id?: number };
}

/**
 * A browser hitting this URL gets 405 from a POST-only route, which looks
 * broken and tells you nothing. This answers plainly instead — so the endpoint
 * can be checked from an address bar, and so any provider-side reachability
 * probe that uses GET succeeds.
 *
 * It reports only that the route is alive. No tenant data, nothing that would
 * be worth finding.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "camerpay-callback",
    expects: "POST",
    note: "Alive. CamerPay should POST callbacks here; a GET only proves the URL resolves.",
  });
}

export async function POST(request: NextRequest) {
  // Read the raw text first and parse ourselves — the verbatim body is stored
  // for audit, and parsing it back is lossy.
  let raw = "";
  let body: CamerPayCallback = {};

  try {
    raw = await request.text();
    body = JSON.parse(raw) as CamerPayCallback;
  } catch {
    console.warn("[camerpay:webhook] unparseable body", raw.slice(0, 200));
    await record({ transactionId: "unparseable", status: "invalid", raw });
    // 200 regardless: a retry would deliver the same unparseable payload.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const replyTo = body.replyTo ?? null;

  /**
   * Recorded FIRST, before any judgement about what it means.
   *
   * `payment_webhook_events` has UNIQUE(provider, transaction_id, status), so
   * replay safety is a database constraint rather than a check-then-act race:
   * a duplicate delivery collides instead of being processed twice.
   */
  const stored = await record({
    transactionId: replyTo ?? body.id ?? "unknown",
    status: body.etat === true ? "claimed_success" : "claimed_failure",
    raw,
  });

  if (!replyTo || body.type !== "EVENT") {
    console.warn("[camerpay:webhook] ignored — missing replyTo or wrong type", body.type);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (stored === "duplicate") {
    // Already seen. Acknowledging without reprocessing is the whole point of
    // the unique constraint.
    console.info("[camerpay:webhook] duplicate", replyTo);
    return NextResponse.json({ received: true }, { status: 200 });
  }

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
    // a race or a forgery. Both are worth seeing.
    if (body.etat === true && confirmed.status !== "success") {
      console.warn(
        "[camerpay:webhook] CLAIM NOT CORROBORATED —",
        replyTo,
        "callback said success, CamerPay says",
        confirmed.status,
      );
    }

    await markProcessed(replyTo, confirmed.status);
  } catch (error) {
    // Never fail the response on our own error. A non-2xx makes CamerPay
    // retry, and retries are how duplicate processing starts; the reconciler
    // sweeps anything left unsettled.
    console.error("[camerpay:webhook] confirmation failed", replyTo, error);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

/** Store the delivery. Never throws — an audit failure must not lose the ack. */
async function record(input: {
  transactionId: string;
  status: string;
  raw: string;
}): Promise<"stored" | "duplicate" | "failed"> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("payment_webhook_events").insert({
      provider: "camerpay",
      transaction_id: input.transactionId,
      status: input.status,
      raw_body: input.raw.slice(0, 20_000),
      // Null, not false: CamerPay sends no signature, so "did not verify" is
      // the honest value. `false` would read as "verified and wrong".
      signature_valid: null,
      processed: false,
    });

    if (error) {
      // 23505 is the unique constraint doing its job on a redelivery.
      if (error.code === "23505") return "duplicate";
      console.error("[camerpay:webhook] could not record event", error.message);
      return "failed";
    }
    return "stored";
  } catch (error) {
    console.error("[camerpay:webhook] could not record event", error);
    return "failed";
  }
}

async function markProcessed(transactionId: string, outcome: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase
      .from("payment_webhook_events")
      .update({ processed: true, status: `confirmed_${outcome}` })
      .eq("provider", "camerpay")
      .eq("transaction_id", transactionId)
      .eq("processed", false);
  } catch (error) {
    console.error("[camerpay:webhook] could not mark processed", error);
  }
}
