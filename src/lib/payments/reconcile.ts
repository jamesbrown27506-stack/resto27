import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { resolveAttemptOutcome, settlePayment } from "@/lib/payments/collect";
import { settleReservationRefund } from "@/lib/payments/reservation-refunds";
import { settleWithdrawalPayout } from "@/lib/payments/withdrawals";

/**
 * The sweep — the third and last route by which a payment settles.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY A PAYMENT CANNOT BE LEFT TO THE POLL AND THE CALLBACK.
 *
 *  The poll only runs while the customer's page is open, and the customer
 *  closes it the moment the PIN is accepted. The callback only arrives if
 *  CamerPay reaches us — a deploy, a cold start or a network blip and it is
 *  gone, because CamerPay does not retry indefinitely and signs nothing we
 *  could ask it to resend. Without this sweep, "approved on the handset, tab
 *  closed, callback lost" is a customer who paid and got nothing, for ever.
 *
 *  It asks CamerPay about every attempt still pending, settles the ones that
 *  really landed, and gives up on the ones old enough to be conclusively dead.
 *  It also retries attempts that ARE succeeded but whose money side failed
 *  halfway — the wallet credit that errored, the extension that did not take.
 *
 *  SAFE TO RUN CONCURRENTLY WITH ITSELF AND WITH THE OTHER TWO ROUTES. Every
 *  transition it makes is a compare-and-swap through collect.ts; two
 *  overlapping cron ticks pick the same rows and exactly one of them wins each
 *  claim. It never settles anything twice.
 *
 *  A PLAIN MODULE, NOT A SERVER ACTION: like collect.ts and
 *  invoice-activation.ts, nothing that grants paid service may be reachable
 *  from a URL. The cron route calls this; the internet cannot.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Young attempts are left alone: the browser poll is still watching them and
 * asking CamerPay twice about the same second of a payment buys nothing.
 */
const STALE_AFTER_MS = 2 * 60_000;

/**
 * The abandonment horizon — deliberately hours, not minutes.
 *
 * Mobile-money PIN entry routinely runs long past any poll window, so age
 * alone is never evidence of failure inside it (see CONCLUSIVE_FAILURE in the
 * CamerPay client). Past this, though, the operator's prompt is long dead and
 * the row has fallen off the 100-row report, so nothing more can be learned:
 * the attempt is closed rather than swept for ever.
 */
const ABANDON_AFTER_MS = 6 * 60 * 60_000;

/**
 * Attempts examined per run, per queue. Each pending attempt costs one
 * authenticated report fetch, and a cron tick has a wall-clock budget — an
 * unbounded run times out halfway and re-does the same head of the queue on
 * the next tick, never reaching the tail.
 */
const BATCH = 25;

export interface ReconciliationSummary {
  checked: number;
  settled: number;
  failed: number;
  stillPending: number;
  abandoned: number;
}

export async function runReconciliation(): Promise<ReconciliationSummary> {
  const supabase = createAdminClient();
  const now = Date.now();

  const summary: ReconciliationSummary = {
    checked: 0,
    settled: 0,
    failed: 0,
    stillPending: 0,
    abandoned: 0,
  };

  /* ── 1. Attempts still waiting on a verdict ───────────────────────────── */

  const { data: pending, error: pendingError } = await supabase
    .from("payment_attempts")
    .select("id, created_at, raw_response")
    .eq("status", "pending")
    .lt("created_at", new Date(now - STALE_AFTER_MS).toISOString())
    // Oldest first: the ones closest to abandonment are the ones a bounded run
    // must not keep postponing.
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (pendingError) {
    console.error("[pay:reconcile] pending queue", pendingError.message);
    return summary;
  }

  for (const row of pending ?? []) {
    const attemptId = row.id as string;
    summary.checked += 1;

    const outcome = await resolveAttemptOutcome(attemptId);

    if (outcome.status === "succeeded") {
      // "Already settled" is another route having won the race — real, but not
      // work this run did, and counting it would make the sweep look busy. A
      // confirmed payment whose money side failed counts as `failed` for want
      // of a sixth counter; the reason is on the log line beside it.
      if (outcome.settled && outcome.note !== "alreadySettled") summary.settled += 1;
      else if (!outcome.settled) summary.failed += 1;
      continue;
    }

    if (outcome.status === "failed") {
      summary.failed += 1;
      continue;
    }

    const startedAt = new Date(row.created_at as string).getTime();
    if (now - startedAt > ABANDON_AFTER_MS) {
      const abandoned = await abandon(attemptId, row.raw_response, outcome.error ?? "unresolved");
      if (abandoned) summary.abandoned += 1;
      else summary.stillPending += 1;
      continue;
    }

    summary.stillPending += 1;
  }

  /* ── 2. Successes whose money side never completed ────────────────────── */

  // `settled_at is null` on a succeeded attempt means the credit or the
  // activation failed after the payment was confirmed. Nobody else retries
  // these — the poll and the webhook are long gone by then.
  const { data: unsettled, error: unsettledError } = await supabase
    .from("payment_attempts")
    .select("id")
    .eq("status", "succeeded")
    .is("settled_at", null)
    // Same staleness rule as above: a success recorded seconds ago is being
    // settled by the caller that recorded it, and racing it buys nothing.
    .lt("created_at", new Date(now - STALE_AFTER_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (unsettledError) {
    console.error("[pay:reconcile] unsettled queue", unsettledError.message);
    return summary;
  }

  for (const row of unsettled ?? []) {
    summary.checked += 1;
    const settled = await settlePayment(row.id as string);
    if (settled.ok && settled.note !== "alreadySettled") summary.settled += 1;
    else if (!settled.ok) summary.failed += 1;
  }

  /* ── 3. Reservation refunds whose customer closed the page ───────────── */

  const { data: refunds, error: refundsError } = await supabase
    .from("refunds")
    .select("id")
    .eq("status", "pending")
    .not("reply_to", "is", null)
    .lt("created_at", new Date(now - STALE_AFTER_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (refundsError) {
    console.error("[pay:reconcile] refund queue", refundsError.message);
    return summary;
  }

  for (const row of refunds ?? []) {
    summary.checked += 1;
    const outcome = await settleReservationRefund(row.id as string);
    if (outcome === "refunded") summary.settled += 1;
    else if (outcome === "failed") summary.failed += 1;
    else summary.stillPending += 1;
  }
  /* ── 4. Restaurant payouts awaiting provider confirmation ──────────── */

  const { data: withdrawals, error: withdrawalsError } = await supabase
    .from("withdrawal_requests")
    .select("id")
    .eq("status", "paid")
    .not("reply_to", "is", null)
    .is("decided_at", null)
    .lt("requested_at", new Date(now - STALE_AFTER_MS).toISOString())
    .order("requested_at", { ascending: true })
    .limit(BATCH);

  if (withdrawalsError) {
    console.error("[pay:reconcile] withdrawal queue", withdrawalsError.message);
    return summary;
  }

  for (const row of withdrawals ?? []) {
    summary.checked += 1;
    const outcome = await settleWithdrawalPayout(String(row.id));
    if (outcome.status === "succeeded") summary.settled += 1;
    else if (outcome.status === "failed") summary.failed += 1;
    else summary.stillPending += 1;
  }

  return summary;
}

/**
 * Close an attempt nothing more can be learned about.
 *
 * Conditional on `pending`, so a verdict that arrived while this run was
 * working wins over the horizon. The reason is merged into `raw_response`
 * rather than replacing it — the initiation payload is the only record of what
 * was actually asked of CamerPay.
 */
async function abandon(
  attemptId: string,
  rawResponse: unknown,
  reason: string,
): Promise<boolean> {
  const supabase = createAdminClient();

  const previous =
    rawResponse && typeof rawResponse === "object" && !Array.isArray(rawResponse)
      ? (rawResponse as Record<string, unknown>)
      : {};

  const { data, error } = await supabase
    .from("payment_attempts")
    .update({
      status: "abandoned",
      // Terminal and nothing owed — the same meaning settled_at carries
      // everywhere else.
      settled_at: new Date().toISOString(),
      raw_response: { ...previous, abandoned: { reason, at: new Date().toISOString() } },
    })
    .eq("id", attemptId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[pay:reconcile] abandon", attemptId, error.message);
    return false;
  }

  return Boolean(data);
}
