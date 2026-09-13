import "server-only";

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { activateFromInvoice } from "@/lib/data/invoice-activation";
import { paymentMode } from "@/lib/data/billing";
import { notify } from "@/lib/notify";
import {
  acceptedTransactionId,
  confirmTransaction,
  isPayableAmount,
  latestTransactionId,
  normalisePhone,
  recordAcceptedRequest,
  requestCollection,
} from "@/lib/payments/camerpay/client";

/**
 * One payment, one place to initiate it, one place to settle it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHAT MOVES THROUGH HERE, AND WHO CALLS IT
 *
 *  Two kinds of thing are paid on this platform:
 *
 *    subscription — an invoice for a plan month (the manager's pay page).
 *    reservation  — a fixed reservation deposit (the customer's booking).
 *
 *  The payment_mode setting (migration 0031) decides HOW money moves:
 *
 *    sandbox — nothing moves. The attempt is recorded as instantly
 *              'succeeded', so every flow can be exercised end to end with
 *              zero real money. This is the default and the only safe state
 *              for a fresh deployment.
 *    live    — a real CamerPay collection: requestCollection() returns a 202
 *              and a `replyTo` (NOT a payment — the customer still approves
 *              on their handset), the attempt sits 'pending', and the
 *              verdict comes from confirmTransaction(), the ONLY trust
 *              anchor.
 *
 *  THREE ROUTES REACH A PENDING ATTEMPT, AND THEY ALL RUN THE SAME CODE:
 *
 *    the poll        checkPaymentAttempt()   — the browser, while it is open.
 *    the webhook     settleConfirmedAttempt() — CamerPay's callback.
 *    the reconciler  resolveAttemptOutcome()  — the cron sweep.
 *
 *  All three funnel into resolveAttemptOutcome(): ask the provider, claim the
 *  terminal state with a CONDITIONAL update, settle only from 'succeeded'.
 *  Every step is a compare-and-swap, so all three racing at the same instant
 *  credit exactly once — and none of them may take a verdict from anything but
 *  CamerPay's own report.
 *
 *  This file is a PLAIN server module, never a `"use server"` export: the
 *  same rule as invoice-activation.ts — anything that grants paid service
 *  must not be reachable from a URL.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  SETTLED_AT MEANS ONE THING, EVERYWHERE IT IS WRITTEN:
 *
 *    THIS ATTEMPT IS FINISHED. It will not move again and no money-side work
 *    is outstanding on it.
 *
 *  So a failure is stamped the moment it is claimed (nothing is owed on a
 *  failure), and a success is stamped only once the subscription was extended
 *  or the wallet was credited — never at confirmation time. That is what makes
 *  "succeeded with settled_at null" a real work queue for the reconciler
 *  instead of a permanently empty one.
 *
 *  Every failure also carries a `reason` — a stable machine code, mapped to
 *  the dictionaries by the caller, the same convention as checkout-actions.ts.
 *  The French `error` string is the fallback for callers that do not map it.
 */

export type AttemptKind = "subscription" | "reservation";

export type PaymentStatus = "succeeded" | "pending" | "failed";

export interface PaymentOutcome {
  ok: boolean;
  error?: string;
  /** Stable machine code for the failure. Never shown to a customer as-is. */
  reason?: string;
  status?: PaymentStatus;
  attemptId?: string;
}

export interface SettleResult {
  ok: boolean;
  error?: string;
  reason?: string;
  /** A CODE, not prose: "alreadySettled" when there was nothing left to do. */
  note?: string;
}

/**
 * Where a pending attempt stands after asking the provider.
 *
 * `settled` is the money side, not the payment: a succeeded attempt whose
 * wallet credit failed is `{ status: "succeeded", settled: false }` and the
 * reconciler will try again. `error` here is a reason CODE — the callers are
 * internal (webhook, cron, poll), none of them render it.
 */
export interface AttemptResolution {
  status: PaymentStatus;
  settled: boolean;
  error?: string;
  note?: string;
}

export interface PaymentAttemptRow {
  id: string;
  reference: string;
  invoiceId: string | null;
  reservationId: string | null;
  restaurantId: string;
  kind: AttemptKind;
  provider: string;
  transactionId: string | null;
  phone: string | null;
  amount: number;
  status: "pending" | "succeeded" | "failed" | "abandoned";
  settledAt: string | null;
  /** The report row this attempt consumed (0036). Null until it settles. */
  providerRowId: string | null;
}

function attemptRow(row: Record<string, unknown>): PaymentAttemptRow {
  return {
    id: row.id as string,
    reference: row.reference as string,
    invoiceId: (row.invoice_id as string | null) ?? null,
    reservationId: (row.reservation_id as string | null) ?? null,
    restaurantId: row.restaurant_id as string,
    kind: row.kind as AttemptKind,
    provider: row.provider as string,
    transactionId: (row.transaction_id as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    amount: row.amount as number,
    status: row.status as PaymentAttemptRow["status"],
    settledAt: (row.settled_at as string | null) ?? null,
    providerRowId: (row.provider_row_id as string | null) ?? null,
  };
}

/**
 * Start a payment for a subscription invoice or a reservation deposit.
 *
 * Validates the phone and the amount BEFORE any money could move, records
 * the attempt, and returns how it stands. Sandbox attempts come back already
 * 'succeeded' (still unsettled — the caller settles like any other success,
 * so the two modes share one code path for the money side).
 */
export async function initiatePaymentAttempt(input: {
  kind: AttemptKind;
  restaurantId: string;
  /** Required when kind === "subscription". */
  invoiceId?: string;
  /** Required when kind === "reservation". */
  reservationId?: string;
  /** Human-readable reference for the attempt (invoice number, reservation reference). */
  reference: string;
  phone: string;
  amount: number;
}): Promise<PaymentOutcome> {
  const mode = await paymentMode();

  const phone = normalisePhone(input.phone);
  if (!phone) {
    return {
      ok: false,
      reason: "badPhone",
      error: "Numéro invalide. Attendu : 9 chiffres commençant par 6 (6XXXXXXXX).",
    };
  }

  const amount = Math.round(input.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: "badAmount", error: "Montant invalide." };
  }

  // Provider constraint, checked before sending so a live charge is never
  // refused by CamerPay after we told the customer everything was fine.
  if (mode === "live" && !isPayableAmount(amount)) {
    return {
      ok: false,
      reason: "amountOutOfRange",
      error: `Montant hors plage CamerPay (500 – 500 000 FCFA).`,
    };
  }

  if (input.kind === "subscription" && !input.invoiceId) {
    return { ok: false, reason: "invoiceMissing", error: "Facture manquante." };
  }
  if (input.kind === "reservation" && !input.reservationId) {
    return { ok: false, reason: "reservationMissing", error: "Réservation manquante." };
  }

  const reference = `PAY-${randomUUID().slice(0, 10).toUpperCase()}`;
  const base = {
    reference,
    restaurant_id: input.restaurantId,
    invoice_id: input.kind === "subscription" ? input.invoiceId! : null,
    reservation_id: input.kind === "reservation" ? input.reservationId! : null,
    kind: input.kind,
    method: "mobile_money",
    phone,
    amount,
  };

  const supabase = createAdminClient();

  /* ── Sandbox: record an instant success, no money moves ─────────────── */
  if (mode === "sandbox") {
    const { data, error } = await supabase
      .from("payment_attempts")
      .insert({ ...base, provider: "sandbox", status: "succeeded", raw_response: { sandbox: true } })
      .select("id")
      .single();

    if (error || !data) {
      console.error("[pay:initiate:sandbox]", error?.message);
      return { ok: false, reason: "recordFailed", error: "Impossible d'enregistrer le paiement." };
    }

    return { ok: true, status: "succeeded", attemptId: data.id };
  }

  /* ── Live: record the INTENT, then charge ───────────────────────────── */

  // Best effort: the report id just before the charge, so confirmTransaction
  // can match OUR row precisely even if the provider's timestamps lie.
  const afterId = await latestTransactionId();
  const startedAt = new Date().toISOString();

  /**
   * THE ROW EXISTS BEFORE THE HANDSET RINGS.
   *
   * requestCollection() sends a real charge: by the time it returns, the
   * customer's phone is already asking for a PIN. Inserting the attempt
   * afterwards meant a failing insert left a customer charged with no attempt
   * row at all — nothing to poll, nothing for the reconciler to sweep, no
   * record that the money was ever asked for. The intent is recorded first and
   * the provider's tracking id is written onto it a moment later.
   */
  const { data: created, error: createError } = await supabase
    .from("payment_attempts")
    .insert({
      ...base,
      provider: "camerpay",
      status: "pending",
      raw_response: { requested_at: startedAt, afterId },
    })
    .select("id")
    .single();

  if (createError || !created) {
    console.error("[pay:initiate:live] attempt row", createError?.message);
    return { ok: false, reason: "recordFailed", error: "Impossible d'enregistrer le paiement." };
  }

  const attemptId = created.id as string;

  let accepted;
  try {
    accepted = await requestCollection(phone, amount);
  } catch (error) {
    console.error("[pay:initiate:live]", attemptId, error);
    /**
     * Left PENDING on purpose. A throw here is a transport failure, not a
     * refusal: CamerPay may well have accepted the charge and pushed the
     * prompt. With no `replyTo` nothing can confirm it, so the reconciler's
     * abandonment horizon is what eventually closes the row — marking it
     * 'failed' now would assert something we do not know.
     */
    await supabase
      .from("payment_attempts")
      .update({
        raw_response: {
          requested_at: startedAt,
          afterId,
          transport_error: error instanceof Error ? error.message : String(error),
        },
      })
      .eq("id", attemptId);

    return {
      ok: false,
      reason: "providerUnavailable",
      error: "Le service de paiement est indisponible, réessayez dans un instant.",
    };
  }

  const trackingId = acceptedTransactionId(accepted);
  if (!accepted.etat || !trackingId) {
    console.error("[pay:initiate:live] refused", accepted.message ?? accepted.httpStatus);
    // A refusal IS conclusive — no charge was accepted, so the attempt is done.
    await claimAttempt(attemptId, "failed");
    return {
      ok: false,
      reason: "providerRefused",
      error: accepted.message ?? "Le paiement a été refusé par l'opérateur.",
    };
  }

  // Bookkeeping: the webhook arrives carrying only this replyTo, and the
  // report never echoes it — the ledger is what the confirmation matches on.
  await recordAcceptedRequest({
    replyTo: trackingId,
    direction: "collect",
    phone,
    amount,
    afterId,
    startedAt,
  });

  const { error: linkError } = await supabase
    .from("payment_attempts")
    .update({
      transaction_id: trackingId,
      raw_response: {
        etat: accepted.etat,
        httpStatus: accepted.httpStatus,
        message: accepted.message,
        data: accepted.data,
        afterId,
        requested_at: startedAt,
      },
    })
    .eq("id", attemptId);

  if (linkError) {
    // The charge is out and the ledger holds the replyTo, but this attempt can
    // no longer be matched to it — worth an error line, not a customer-facing
    // failure that would invite a second charge.
    console.error("[pay:initiate:live] tracking id", attemptId, linkError.message);
  }

  return { ok: true, status: "pending", attemptId };
}

/**
 * Ask the provider whether a pending attempt resolved, and settle it if so.
 *
 * `scopedRestaurantId` scopes the read when the caller is a tenant — an attempt
 * belongs to one restaurant, and nobody may poll somebody else's payment. The
 * verdict itself comes from resolveAttemptOutcome(), the one implementation the
 * webhook and the reconciler share.
 */
export async function checkPaymentAttempt(
  attemptId: string,
  scopedRestaurantId?: string,
): Promise<PaymentOutcome & { status: PaymentStatus }> {
  const supabase = createAdminClient();

  let query = supabase.from("payment_attempts").select("id").eq("id", attemptId);
  if (scopedRestaurantId) query = query.eq("restaurant_id", scopedRestaurantId);
  const { data } = await query.maybeSingle();
  if (!data) {
    return { ok: false, reason: "attemptNotFound", error: "Paiement introuvable.", status: "failed" };
  }

  const outcome = await resolveAttemptOutcome(attemptId);
  return { ok: true, status: outcome.status };
}

/**
 * THE resolution path. Ask CamerPay, claim the verdict, settle a success.
 *
 * Every route into a pending attempt ends here, so there is exactly one place
 * that decides what a payment did. Safe to call concurrently with itself and
 * with settlePayment(): the pending→terminal transition is a conditional
 * update and the settlement is guarded by `settled_at` plus its own
 * compare-and-swap, so the loser of any race does no work twice.
 */
export async function resolveAttemptOutcome(attemptId: string): Promise<AttemptResolution> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("payment_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();

  if (!data) return { status: "failed", settled: false, error: "attemptNotFound" };

  const row = attemptRow(data);

  // Already terminal: nothing to ask the provider, but a success may still owe
  // its money side — an earlier settlement can have failed halfway.
  if (row.status === "succeeded") return settledResolution(row.id);
  if (row.status !== "pending") return { status: "failed", settled: false };

  // A pending sandbox attempt, or one whose 202 never came back with a
  // tracking id, has nothing to ask. It stays pending until it is abandoned.
  if (row.provider !== "camerpay" || !row.transactionId) {
    return { status: "pending", settled: false, error: "notConfirmable" };
  }

  let confirmed;
  try {
    // No facts hint: the request ledger written at acceptance supplies the
    // number, amount and direction the report is matched on. The exclusion
    // list keeps a retry off the row its own first try already consumed.
    confirmed = await confirmTransaction(row.transactionId, {
      excludeRowIds: await consumedRowIds(row),
    });
  } catch (error) {
    console.error("[pay:resolve]", attemptId, error);
    return { status: "pending", settled: false, error: "providerUnavailable" };
  }

  if (confirmed.status === "failed") {
    await claimAttempt(attemptId, "failed");
    return { status: "failed", settled: false };
  }

  if (confirmed.status !== "success") return { status: "pending", settled: false };

  if (!confirmed.rowId) {
    // The row carried neither an id nor a ref, so it cannot be claimed and the
    // constraint that stops two attempts settling from it cannot apply. Worth
    // seeing: it means the report's shape changed under us.
    console.warn("[pay:resolve] confirmed row has no identity", attemptId);
  }

  const claim = await claimAttempt(attemptId, "succeeded", confirmed.rowId);

  if (claim === "rowTaken") {
    /**
     * Another attempt already settled from this exact report row. That is the
     * database refusing a double credit from one real payment — the customer
     * retried, both attempts matched the one row they approved, and only the
     * first may have it. This one stays pending: if a second payment really
     * was made it will appear as its own row and match on the next sweep,
     * and if it was not, the abandonment horizon closes this out.
     */
    console.warn("[pay:resolve] report row already claimed", attemptId, confirmed.rowId);
    return { status: "pending", settled: false, error: "providerRowTaken" };
  }

  if (claim === "lost") {
    // Somebody else moved the row while we were asking. Believe the row, not
    // our verdict — it may have been claimed 'failed' by a conclusive answer.
    const { data: after } = await supabase
      .from("payment_attempts")
      .select("status")
      .eq("id", attemptId)
      .maybeSingle();
    if (after?.status !== "succeeded") return { status: "failed", settled: false, error: "claimLost" };
  }

  return settledResolution(attemptId);
}

/** Run (or re-run) the money side of an attempt already known 'succeeded'. */
async function settledResolution(attemptId: string): Promise<AttemptResolution> {
  const settled = await settlePayment(attemptId);
  return {
    status: "succeeded",
    settled: settled.ok,
    error: settled.ok ? undefined : (settled.reason ?? "settleFailed"),
    note: settled.note,
  };
}

/**
 * Confirm and settle an attempt the provider told us about — THE WEBHOOK'S
 * ENTRY POINT.
 *
 * A callback body is a hint, never evidence (CamerPay signs nothing), so this
 * re-asks CamerPay through the same path the poll uses before claiming
 * anything. Call it as many times as the provider redelivers: the claim is
 * conditional and the settlement is idempotent, so the second call reports
 * `note: "alreadySettled"` and touches no money.
 */
export async function settleConfirmedAttempt(attemptId: string): Promise<{
  ok: boolean;
  error?: string;
  note?: string;
  reason?: string;
  /** What CamerPay says the payment did — independent of whether we applied it. */
  status?: PaymentStatus;
}> {
  const outcome = await resolveAttemptOutcome(attemptId);

  if (outcome.status === "succeeded" && outcome.settled) {
    return outcome.note
      ? { ok: true, status: "succeeded", note: outcome.note }
      : { ok: true, status: "succeeded" };
  }

  if (outcome.status === "succeeded") {
    return {
      ok: false,
      status: "succeeded",
      reason: outcome.error ?? "settleFailed",
      error: "Le paiement est confirmé mais son application a échoué.",
    };
  }

  if (outcome.status === "pending") {
    return {
      ok: false,
      status: "pending",
      reason: outcome.error ?? "notConfirmed",
      error: "Le paiement n'est pas confirmé.",
    };
  }

  return {
    ok: false,
    status: "failed",
    reason: outcome.error ?? "paymentFailed",
    error: "Le paiement a échoué.",
  };
}

/**
 * Report rows already consumed by ANOTHER attempt of the same shape.
 *
 * Narrowed to this provider, number and amount because those are exactly the
 * attempts that can cross-match — a customer who retried, or one invoice paid
 * twice. Advisory only: the partial UNIQUE index on (provider, provider_row_id)
 * is what actually prevents the double settlement (migration 0036).
 */
async function consumedRowIds(row: PaymentAttemptRow): Promise<string[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("payment_attempts")
    .select("provider_row_id")
    .eq("provider", row.provider)
    .eq("amount", row.amount)
    .neq("id", row.id)
    .not("provider_row_id", "is", null);

  if (row.phone) query = query.eq("phone", row.phone);

  const { data, error } = await query.limit(50);
  if (error) {
    console.error("[pay:consumed]", row.id, error.message);
    return [];
  }

  return (data ?? [])
    .map((entry) => (entry as { provider_row_id: string | null }).provider_row_id)
    .filter((value): value is string => Boolean(value));
}

/**
 * The pending → terminal transition.
 *
 *   "won"      this caller made the transition and owes the money side.
 *   "lost"     somebody else got there first; read the row, do nothing.
 *   "rowTaken" the provider's report row belongs to another attempt — the
 *              UNIQUE index refused the claim, and refusing it is the point.
 *
 * A failure is stamped settled_at here (nothing is owed on a failure); a
 * success is not — settlePayment() stamps it once the money has moved.
 */
async function claimAttempt(
  attemptId: string,
  verdict: "succeeded" | "failed",
  providerRowId?: string,
): Promise<"won" | "lost" | "rowTaken"> {
  const supabase = createAdminClient();

  const patch: Record<string, unknown> = { status: verdict };
  if (verdict === "failed") patch.settled_at = new Date().toISOString();
  if (verdict === "succeeded" && providerRowId) patch.provider_row_id = providerRowId;

  const { data, error } = await supabase
    .from("payment_attempts")
    .update(patch)
    .eq("id", attemptId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 is payment_attempts_provider_row_idx doing its job.
    if (error.code === "23505") return "rowTaken";
    console.error("[pay:claim]", attemptId, error.message);
    return "lost";
  }

  return data ? "won" : "lost";
}

/**
 * THE money-side effect, once an attempt is known 'succeeded'.
 *
 *   subscription → activateFromInvoice() — the one idempotent activation path.
 *   reservation  → credit the restaurant's wallet (the deposit is DEDUCTED
 *                  from the customer's final bill) and mark the booking's
 *                  deposit paid.
 *
 * Called by the poll, by the paying actions (sandbox successes land here
 * immediately), by the webhook and by the reconciler — each call is safe to
 * repeat and safe to run concurrently with the others: the guarded updates make
 * every call after the first a no-op.
 */
export async function settlePayment(attemptId: string): Promise<SettleResult> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("payment_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();
  if (!data) return { ok: false, reason: "attemptNotFound", error: "Paiement introuvable." };

  const row = attemptRow(data);
  if (row.status !== "succeeded") {
    return { ok: false, reason: "notConfirmed", error: "Le paiement n'est pas confirmé." };
  }
  if (row.settledAt) return { ok: true, note: "alreadySettled" };

  let ok = false;
  let error: string | undefined;
  let reason: string | undefined;

  if (row.kind === "subscription" && row.invoiceId) {
    const result = await activateFromInvoice(row.invoiceId);
    ok = result.ok;
    if (!result.ok) {
      error = result.error;
      reason = result.reason ?? "activationFailed";
    }
  } else if (row.kind === "reservation" && row.reservationId) {
    /**
     * THE CLAIM COMES BEFORE THE MONEY.
     *
     * This used to read `deposit_paid`, credit the wallet, and only then run
     * the guarded update — which put the guard AFTER the money moved, so a
     * poll and a webhook arriving together both credited the same deposit. The
     * compare-and-swap is now what buys the right to credit: exactly one caller
     * flips false→true, and only that caller pays out.
     */
    const { data: claimed, error: claimError } = await supabase
      .from("reservations")
      .update({ deposit_paid: true })
      .eq("id", row.reservationId)
      .eq("status", "awaiting_payment")
      .eq("deposit_paid", false)
      .select("id, reference, customer_id, guest_name")
      .maybeSingle();

    if (claimError) {
      console.error("[pay:settle:reservation] claim", claimError.message);
      error = "Le paiement est confirmé mais le suivi a échoué.";
      reason = "reservationClaimFailed";
    } else if (!claimed) {
      // Either the booking is gone, or the deposit was already claimed — by the
      // path that raced us, or by a manager collecting it on the board.
      const { data: existing } = await supabase
        .from("reservations")
        .select("id, reference, customer_id, guest_name, status, deposit_paid")
        .eq("id", row.reservationId)
        .maybeSingle();

      if (!existing) {
        error = "Réservation introuvable.";
        reason = "reservationNotFound";
      } else if (existing.deposit_paid && existing.status === "awaiting_payment") {
        // A previous settlement won the deposit claim but stopped before the
        // status transition. Finish that exact half-completed operation.
        const { data: promoted, error: promoteError } = await supabase
          .from("reservations")
          .update({ status: "confirmed" })
          .eq("id", row.reservationId)
          .eq("status", "awaiting_payment")
          .eq("deposit_paid", true)
          .select("id")
          .maybeSingle();
        if (promoteError || !promoted) {
          error = "Le paiement est reçu mais la réservation n'a pas pu être confirmée.";
          reason = "reservationPromotionFailed";
        } else {
          ok = true;
          await notifyReservationPaid({
            restaurantId: row.restaurantId,
            customerId: existing.customer_id as string | null,
            customerName: existing.guest_name as string | null,
            reference: existing.reference as string,
          });
        }
      } else if (existing.deposit_paid && existing.status === "confirmed") {
        ok = true;
      } else {
        // A late provider success may never turn a cancelled or completed
        // booking back into a live table or credit the restaurant for it.
        error = "La réservation n'attend plus ce paiement.";
        reason = "reservationNotPayable";
      }
    } else {
      const booking = claimed as {
        id: string;
        reference: string;
        customer_id: string | null;
        guest_name: string | null;
      };
      const { error: creditError } = await supabase.rpc("wallet_credit", {
        p_restaurant_id: row.restaurantId,
        p_amount: row.amount,
        p_kind: "deposit",
        p_note: `Acompte ${booking.reference} (paiement en ligne)`,
        p_reference: booking.reference,
      });

      if (!creditError) {
        /*
          PAYING IS WHAT CONFIRMS THE TABLE (0039).

          The restaurant accepted the booking and it went to
          `awaiting_payment`; the seat is held but not earned until the deposit
          lands. This is the single point both the client poll and the CamerPay
          webhook converge on, so it is the only correct place to promote it.

          Guarded on `status = 'awaiting_payment'` so a late settlement can
          never resurrect a booking that was cancelled, completed or marked a
          no-show in the meantime — and so a deposit collected by a manager on
          the board, against a booking already `confirmed`, changes nothing.

          A failure here is logged, not fatal: the money has moved and the
          wallet is credited, and losing the payment over a status update would
          be the worse outcome. The manager sees a paid deposit on the board
          either way.
        */
        const { data: promoted, error: promoteError } = await supabase
          .from("reservations")
          .update({ status: "confirmed" })
          .eq("id", row.reservationId)
          .eq("status", "awaiting_payment")
          .eq("deposit_paid", true)
          .select("id")
          .maybeSingle();

        if (promoteError || !promoted) {
          console.error(
            "[pay:settle:reservation] promote",
            promoteError?.message ?? "reservation no longer awaiting payment",
          );
          error = "Le paiement est reçu mais la réservation n'a pas pu être confirmée.";
          reason = "reservationPromotionFailed";
        } else {
          await notifyReservationPaid({
            restaurantId: row.restaurantId,
            customerId: booking.customer_id,
            customerName: booking.guest_name,
            reference: booking.reference,
          });
        }
      }

      if (creditError) {
        console.error("[pay:settle:reservation] credit", creditError.message);
        /**
         * Hand the claim back. Holding it would mark the booking paid with the
         * wallet never credited and nothing able to try again — the restaurant
         * would simply never see the money. The window in which a manager could
         * mark it collected by hand is a few milliseconds wide; a lost credit
         * is permanent.
         */
        await supabase
          .from("reservations")
          .update({ deposit_paid: false })
          .eq("id", row.reservationId)
          .eq("deposit_paid", true);

        error = "Le paiement est confirmé mais le crédit du portefeuille a échoué.";
        reason = "walletCreditFailed";
      } else if (!error) {
        ok = true;
      }
    }
  } else {
    error = "Tentative de paiement incomplète.";
    reason = "attemptIncomplete";
  }

  if (ok) {
    // Nothing is owed on this attempt any more. `.is(...)` — PostgREST spells
    // a null comparison `is`, and `.eq("settled_at", null)` matched no row at
    // all, so this stamp never landed and every "unsettled" query was wrong.
    await supabase
      .from("payment_attempts")
      .update({ settled_at: new Date().toISOString() })
      .eq("id", attemptId)
      .is("settled_at", null);
  }

  return { ok, error, reason };
}

async function notifyReservationPaid(input: {
  restaurantId: string;
  customerId: string | null;
  customerName: string | null;
  reference: string;
}): Promise<void> {
  await notify({
    event: "reservation",
    tone: "success",
    restaurantId: input.restaurantId,
    href: "/m/reservations",
    params: {
      reference: input.reference,
      customerName: input.customerName ?? undefined,
      status: "confirmed",
    },
  });

  if (input.customerId) {
    await notify({
      event: "reservation_decision",
      tone: "success",
      customerId: input.customerId,
      href: "/reservations",
      params: { reference: input.reference, status: "confirmed" },
    });
  }
}
