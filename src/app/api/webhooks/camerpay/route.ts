import { NextResponse, type NextRequest } from "next/server";
import { confirmTransaction, findRequestByReplyTo } from "@/lib/payments/camerpay/client";
import { settleConfirmedAttempt } from "@/lib/payments/collect";
import { createAdminClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { notify } from "@/lib/notify";
import { settleReservationRefundByReplyTo } from "@/lib/payments/reservation-refunds";
import { settleWithdrawalPayoutByReplyTo } from "@/lib/payments/withdrawals";

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

/**
 * A real callback is a few hundred bytes. Anything past this is junk, and
 * reading it would mean buffering a stranger's upload and storing 20KB of it.
 */
const MAX_BODY_BYTES = 16_384;

/**
 * The flood ceiling, per source address.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A LIMIT THAT COULD DROP A REAL CALLBACK WOULD BE WORSE THAN NO LIMIT.
 *
 *  CamerPay retries nothing indefinitely and signs nothing, so a callback we
 *  refuse is a payment that only the reconciler will ever notice. The ceiling
 *  is therefore set far above anything this platform's real traffic produces —
 *  it sheds a flood, not a burst. The expensive half (an authenticated report
 *  fetch per novel tracking id) is bounded separately, by refusing to look up
 *  a `replyTo` we never issued.
 * ─────────────────────────────────────────────────────────────────────────
 */
const FLOOD_LIMIT = 120;
const FLOOD_WINDOW_MS = 60_000;

interface CamerPayCallback {
  id?: string;
  replyTo?: string;
  type?: string;
  etat?: boolean;
  // The docs do not pin the payload shape, so `replyTo` and `etat` are
  // accepted nested inside `data` as well as at the top level — a callback
  // whose tracking id is missed is a callback that can never be confirmed.
  data?: {
    date?: string;
    numero?: string;
    message?: string;
    id?: number;
    replyTo?: string;
    etat?: boolean;
  };
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
    /**
     * WHICH COMMIT IS SERVING. Three watcher fixes were tested against a
     * deployment that turned out to still be running the previous build, and
     * nothing on any screen could say so. Vercel injects the SHA; exposing
     * seven characters of a public repo's commit id costs nothing and ends
     * that class of confusion — open this URL, compare to `git log`.
     */
    build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local-dev",
    note: "Alive. CamerPay should POST callbacks here; a GET only proves the URL resolves.",
  });
}

export async function POST(request: NextRequest) {
  // Shed a flood before touching the database or the provider. Nothing is
  // recorded for a request refused here — that is the point of refusing it.
  const flood = await rateLimit({
    key: "webhook:camerpay",
    limit: FLOOD_LIMIT,
    windowMs: FLOOD_WINDOW_MS,
  });
  if (!flood.ok) {
    console.warn("[camerpay:webhook] rate limited");
    return NextResponse.json({ received: false }, { status: 429 });
  }

  // Refuse an oversized body BEFORE buffering it.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    console.warn("[camerpay:webhook] body too large", declared);
    return NextResponse.json({ received: false }, { status: 413 });
  }

  // Read the raw text first and parse ourselves — the verbatim body is stored
  // for audit, and parsing it back is lossy.
  let raw = "";
  let body: CamerPayCallback = {};

  try {
    raw = await request.text();
    // A chunked request declares no length; the same ceiling applies to what
    // actually arrived.
    if (raw.length > MAX_BODY_BYTES) {
      console.warn("[camerpay:webhook] body too large", raw.length);
      return NextResponse.json({ received: false }, { status: 413 });
    }
    body = JSON.parse(raw) as CamerPayCallback;
  } catch {
    console.warn("[camerpay:webhook] unparseable body", raw.slice(0, 200));
    await record({ transactionId: "unparseable", status: "invalid", raw });
    // 200 regardless: a retry would deliver the same unparseable payload.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // The tracking id can sit at the top level or inside data — accept both.
  const replyTo = body.replyTo ?? body.data?.replyTo ?? null;
  const claimed = body.etat ?? body.data?.etat;

  /**
   * Recorded FIRST, before any judgement about what it means.
   *
   * `payment_webhook_events` has UNIQUE(provider, transaction_id, status), so
   * replay safety is a database constraint rather than a check-then-act race:
   * a duplicate delivery collides instead of being processed twice.
   *
   * THE STATUS WRITTEN HERE IS THE DEDUPE KEY, SO IT NEVER CHANGES AGAIN.
   * Processing used to rename it to `confirmed_*`, which freed the slot the
   * constraint was holding — every redelivery after that then reprocessed from
   * scratch: another report fetch, another settlement, another "paid" alert.
   * What the confirmation found is recorded where verdicts belong (the attempt
   * row and the request ledger); this table stays the raw delivery log, and
   * `processed` is the only field that moves.
   */
  const eventStatus = claimed === true ? "claimed_success" : "claimed_failure";
  const stored = await record({
    transactionId: replyTo ?? body.id ?? "unknown",
    status: eventStatus,
    raw,
  });

  if (!replyTo) {
    // Recorded above; a callback without a tracking id has nothing to confirm.
    console.warn("[camerpay:webhook] ignored — no replyTo", body.type);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // CamerPay's transaction result carries no documented `type` field, so only
  // a type that is present AND clearly not a transaction event is ignored.
  // Requiring `type === "EVENT"` dropped every real callback.
  if (body.type && body.type !== "EVENT") {
    console.warn("[camerpay:webhook] ignored — unexpected type", body.type);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (stored === "duplicate") {
    // Already seen. Acknowledging without reprocessing is the whole point of
    // the unique constraint.
    console.info("[camerpay:webhook] duplicate", replyTo);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  /**
   * A TRACKING ID WE NEVER ISSUED BUYS NOTHING.
   *
   * Confirming means an authenticated 100-row report fetch against CamerPay, so
   * an endpoint that confirms whatever it is handed is an amplifier: a stranger
   * posting novel `replyTo` values drives one provider call each. Every real
   * callback matches a request we made — the ledger row written at acceptance,
   * or the attempt row carrying the same id when that write failed. Anything
   * else is recorded above and goes no further.
   */
  const attempt = await findAttempt(replyTo);
  if (!attempt && !(await findRequestByReplyTo(replyTo))) {
    console.warn("[camerpay:webhook] ignored — unknown replyTo", replyTo);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    /**
     * SETTLE THROUGH THE ONE PATH — and confirm exactly once.
     *
     * settleConfirmedAttempt() asks CamerPay itself (with no hint: it reads the
     * request ledger written when the 202 was accepted, since the report never
     * echoes the `replyTo` a callback carries), CLAIMS pending→succeeded with a
     * conditional update, and only then moves money. So nothing here trusts the
     * body, the poll and the reconciler can be doing the same thing at the same
     * instant, and the customer is credited once.
     *
     * It is also the only route left for a customer who approved on the handset
     * and closed the page — the poll that was watching may never run again.
     *
     * With no attempt of ours behind the id (a payout initiated from the admin
     * console), confirming is all there is to do: that call is what writes the
     * verdict into the request ledger.
     */
    const settled = attempt ? await settleConfirmedAttempt(attempt.id) : null;
    const refund = attempt ? "not_found" : await settleReservationRefundByReplyTo(replyTo);
    const withdrawal =
      !attempt && refund === "not_found"
        ? await settleWithdrawalPayoutByReplyTo(replyTo)
        : { status: "not_found" as const };
    const payoutStatus =
      refund !== "not_found"
        ? refund === "refunded"
          ? "succeeded"
          : refund
        : withdrawal.status;
    const verdict = settled
      ? (settled.status ?? "pending")
      : payoutStatus === "succeeded"
        ? "succeeded"
        : payoutStatus === "failed"
          ? "failed"
          : payoutStatus === "pending"
            ? "pending"
            : (await confirmTransaction(replyTo)).status;
    const corroborated = verdict === "success" || verdict === "succeeded";

    console.info("[camerpay:webhook]", replyTo, "claimed:", claimed, "confirmed:", verdict);

    // A callback claiming success that CamerPay does not corroborate is either
    // a race or a forgery. Both are worth seeing.
    if (claimed === true && !corroborated) {
      console.warn(
        "[camerpay:webhook] CLAIM NOT CORROBORATED —",
        replyTo,
        "callback said success, CamerPay says",
        verdict,
      );
    }

    await markProcessed(replyTo, eventStatus);

    if (settled && !settled.ok && corroborated) {
      console.error("[camerpay:webhook] settlement failed", replyTo, settled.reason, settled.error);
    }

    // A payment that really landed is news the tenant must not discover by
    // looking at an invoice. Non-fatal, like every delivery here. Sent once per
    // distinct delivery — the replay guard above is what keeps a redelivery
    // from announcing the same payment twice.
    // Subscriptions only: a reservation deposit and an order payment are
    // announced by settlePayment itself, whichever route settled them — this
    // used to add a second "billing paid" alert linking order payments to the
    // reservations page.
    if (attempt && corroborated && attempt.kind === "subscription") {
      try {
        await notify({
          event: "billing_paid",
          tone: "success",
          restaurantId: attempt.restaurantId,
          href: attempt.kind === "subscription" ? "/m/billing" : "/m/reservations",
          params: {
            invoiceNumber: attempt.invoiceNumber,
            amount: attempt.amount,
          },
        });
      } catch (error) {
        console.error("[camerpay:webhook] could not notify", replyTo, error);
      }
    }
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

/**
 * Flip the delivery to processed. `status` is part of the unique key, so it is
 * passed in and written back UNCHANGED — moving it would release the replay
 * guard on the row it is guarding.
 */
async function markProcessed(transactionId: string, eventStatus: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase
      .from("payment_webhook_events")
      .update({ processed: true })
      .eq("provider", "camerpay")
      .eq("transaction_id", transactionId)
      .eq("status", eventStatus)
      .eq("processed", false);
  } catch (error) {
    console.error("[camerpay:webhook] could not mark processed", error);
  }
}

interface WebhookAttempt {
  id: string;
  kind: string;
  amount: number;
  restaurantId: string;
  invoiceNumber?: string;
}

/** The attempt a callback's tracking id belongs to, if we started one. */
async function findAttempt(replyTo: string): Promise<WebhookAttempt | null> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("payment_attempts")
      .select("id, kind, amount, restaurant_id, invoices ( number )")
      .eq("provider", "camerpay")
      .eq("transaction_id", replyTo)
      // One tracking id, one attempt — ordered and limited rather than
      // single() so a stray duplicate answers instead of throwing.
      .order("created_at", { ascending: false })
      .limit(1);

    const row = data?.[0];
    if (!row) return null;

    return {
      id: row.id as string,
      kind: row.kind as string,
      amount: row.amount as number,
      restaurantId: row.restaurant_id as string,
      invoiceNumber: (row.invoices as unknown as { number?: string } | null)?.number ?? undefined,
    };
  } catch (error) {
    console.error("[camerpay:webhook] could not read attempt", replyTo, error);
    return null;
  }
}
