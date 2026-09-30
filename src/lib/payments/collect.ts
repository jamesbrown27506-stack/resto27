import "server-only";

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { activateFromInvoice } from "@/lib/data/invoice-activation";
import { isMissingColumn } from "@/lib/data/missing-column";
import { paymentMode } from "@/lib/data/billing";
import { notify } from "@/lib/notify";
import { notifyDiningPartPaid, notifyDiningPaymentSettled } from "@/lib/dining/guest-alerts";
import { refundUnpayableAttempt, startRefundPayout } from "@/lib/payments/refund-payouts";
import { collectionGateway, gatewayRange, payableOn } from "@/lib/payments/gateway";
import { cameroonNetwork } from "@/lib/payments/saspay/cameroon";
import { startSaspayPayment, verifySaspayPayment } from "@/lib/payments/saspay/client";
import { siteUrl } from "@/lib/site-url";
import { dialInstructionFromRefusal, type PaymentInstruction } from "@/lib/payments/camerpay/notification";
import { PROVIDER_REFUSED_FALLBACK } from "@/lib/payments/payment-error";
import { orderCouldBePaidBy, orderNamesItsPayer, orderPayerVerdict } from "@/lib/payments/order-payer";
import {
  acceptedTransactionId,
  confirmTransaction,
  latestNotificationId,
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
 *  The French `error` string is the fallback for callers that do not map it;
 *  customer and restaurant actions map it through paymentErrorMessage
 *  (./payment-error.ts), so a new code needs a key there too.
 */

/**
 * `dining` (0068) is one part-payment of an Enterprise table bill — the guest
 * paid everything, their own dishes, an equal share or an amount, plus an
 * optional tip. Like `order` it is stored with the reservation-shaped row and
 * recognised by `raw_response.diningPaymentId`.
 */
export type AttemptKind = "subscription" | "reservation" | "order" | "wallet" | "dining";

export type PaymentStatus = "succeeded" | "pending" | "failed";

export interface PaymentOutcome {
  ok: boolean;
  error?: string;
  /** Stable machine code for the failure. Never shown to a customer as-is. */
  reason?: string;
  status?: PaymentStatus;
  attemptId?: string;
  instruction?: PaymentInstruction;
}

export interface SettleResult {
  ok: boolean;
  error?: string;
  reason?: string;
  /** A CODE, not prose: "alreadySettled" when there was nothing left to do. */
  note?: string;
  instruction?: PaymentInstruction;
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
  instruction?: PaymentInstruction;
}

export interface PaymentAttemptRow {
  id: string;
  reference: string;
  invoiceId: string | null;
  reservationId: string | null;
  orderId: string | null;
  /** The table-bill payment this attempt pays (0068). */
  diningPaymentId: string | null;
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
  rawResponse: Record<string, unknown> | null;
  createdAt: string;
}

function attemptRow(row: Record<string, unknown>): PaymentAttemptRow {
  const rawResponse = (row.raw_response as Record<string, unknown> | null) ?? null;
  const orderId = typeof rawResponse?.orderId === "string" ? rawResponse.orderId : null;
  const diningPaymentId = typeof rawResponse?.diningPaymentId === "string" ? rawResponse.diningPaymentId : null;
  return {
    id: row.id as string,
    reference: row.reference as string,
    invoiceId: (row.invoice_id as string | null) ?? null,
    reservationId: (row.reservation_id as string | null) ?? null,
    orderId,
    diningPaymentId,
    restaurantId: row.restaurant_id as string,
    kind: rawResponse?.walletFunding === true
      ? "wallet"
      : diningPaymentId
        ? "dining"
        : orderId ? "order" : (row.kind as AttemptKind),
    provider: row.provider as string,
    transactionId: (row.transaction_id as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    amount: row.amount as number,
    status: row.status as PaymentAttemptRow["status"],
    settledAt: (row.settled_at as string | null) ?? null,
    providerRowId: (row.provider_row_id as string | null) ?? null,
    rawResponse,
    createdAt: row.created_at as string,
  };
}

/** Cameroon Mobile Money prompts are only valid for a short confirmation window. */
export const MOBILE_MONEY_CONFIRMATION_WINDOW_MS = 5 * 60_000;

/**
 * SasPay can hand the customer a hosted page (Orange Money often settles
 * there) instead of a USSD prompt: opening it, choosing, confirming takes
 * longer than a PIN, so its attempts get a wider window.
 */
export const SASPAY_CONFIRMATION_WINDOW_MS = 15 * 60_000;

/**
 * An Orange payment the customer starts themselves: leave the app, dial the
 * code, enter the PIN, come back. Twice the time a pushed prompt gets.
 */
export const CUSTOMER_DIAL_WINDOW_MS = 10 * 60_000;

/**
 * Shown in place of the code once an ask has been accepted: the customer has
 * dialled, and dialling again would pay again.
 */
const DIAL_RECEIVED: PaymentInstruction = { message: "", customerInitiated: true, received: true };

/**
 * Once CamerPay has accepted an ask after the customer dialled, the window is
 * not allowed to close on it for this long: the money has very probably moved,
 * and the report showing it a minute late must not turn that into a failure.
 */
const DIAL_ACCEPTED_GRACE_MS = 5 * 60_000;

/**
 * How long to wait before asking CamerPay again about a dial payment.
 *
 * EVERY ASK LEAVES A ROW in CamerPay's transaction report ("Aucun retrait
 * Orange… détecté"), and that report is where every other payment is looked
 * up. Asking every few seconds for ten minutes would bury it. So: often while
 * the customer is most likely dialling, then less and less — about 25 asks
 * over the whole window instead of a hundred.
 */
export function dialReaskDelayMs(attemptAgeMs: number): number {
  if (attemptAgeMs < 2 * 60_000) return 10_000;
  if (attemptAgeMs < 5 * 60_000) return 20_000;
  return 40_000;
}

export function confirmationWindowMs(provider: string, rawResponse?: unknown): number {
  if (provider === "saspay") return SASPAY_CONFIRMATION_WINDOW_MS;
  const raw = rawResponse as { customerDial?: unknown } | null | undefined;
  return raw?.customerDial === true ? CUSTOMER_DIAL_WINDOW_MS : MOBILE_MONEY_CONFIRMATION_WINDOW_MS;
}

/** The code-to-dial stored on an attempt Orange refused to push (null otherwise). */
function storedDialInstruction(row: PaymentAttemptRow): PaymentInstruction | null {
  if (row.rawResponse?.customerDial !== true) return null;
  const stored = row.rawResponse.dialInstruction as Partial<PaymentInstruction> | undefined;
  if (!stored || typeof stored.code !== "string") return null;
  return {
    message: typeof stored.message === "string" ? stored.message : "",
    code: stored.code,
    merchantName: typeof stored.merchantName === "string" ? stored.merchantName : undefined,
    customerInitiated: true,
  };
}

/**
 * Atomically close an unconfirmed CamerPay request after the customer-facing
 * five-minute window. The created-at predicate matters: a concurrent callback
 * or poll can settle first, but a late report can never revive an expired
 * request and credit money twice.
 */
async function expireUnconfirmedMobileMoneyAttempt(
  row: PaymentAttemptRow,
  options: { evenIfDialAccepted?: boolean } = {},
): Promise<boolean> {
  if (row.provider !== "camerpay" && row.provider !== "saspay") return false;
  const windowMs = confirmationWindowMs(row.provider, row.rawResponse);

  const createdAt = Date.parse(row.createdAt);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt < windowMs) {
    return false;
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  let expire = supabase
    .from("payment_attempts")
    .update({ status: "failed", settled_at: now })
    .eq("id", row.id)
    .eq("status", "pending")
    .lt("created_at", cutoff);
  /*
    A dial payment is checked by several routes at once. One of them, holding
    a copy of the row read a second ago, must not close an attempt whose ask
    another route has JUST had accepted — the customer has paid. The condition
    is on the database row, not on the stale copy.
  */
  if (row.rawResponse?.customerDial === true && !options.evenIfDialAccepted) {
    expire = expire.is("raw_response->>claimAcceptedAt", null);
  }
  const { data, error } = await expire.select("id").maybeSingle();

  if (error) {
    console.error("[pay:expire]", row.id, error.message);
    return false;
  }
  return Boolean(data);
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
  /** Required when kind === "order". */
  orderId?: string;
  /** Required when kind === "dining": the dining_payments row (0068). */
  diningPaymentId?: string;
  /** Human-readable reference for the attempt (invoice number, reservation reference). */
  reference: string;
  phone: string;
  amount: number;
  /**
   * Where a customer sent to a hosted payment page (SasPay) comes back to,
   * e.g. "/orders/<id>". Same-site path; the site origin is added here.
   */
  returnPath?: string;
  /** Shown on SasPay's hosted page; placeholders are used when absent. */
  customer?: { name?: string | null; email?: string | null };
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

  // Which gateway takes this payment (super admin's switch, 0063). Sandbox
  // never reaches a gateway, whichever is selected.
  const gateway = mode === "live" ? await collectionGateway() : "camerpay";

  // Provider constraint, checked before sending so a live charge is never
  // refused by the gateway after we told the customer everything was fine.
  if (mode === "live" && !payableOn(gateway, amount)) {
    const { min, max } = gatewayRange(gateway);
    return {
      ok: false,
      reason: "amountOutOfRange",
      error: `Montant hors plage (${min.toLocaleString("fr-CM")} – ${max.toLocaleString("fr-CM")} FCFA).`,
    };
  }

  if (input.kind === "subscription" && !input.invoiceId) {
    return { ok: false, reason: "invoiceMissing", error: "Facture manquante." };
  }
  if (input.kind === "reservation" && !input.reservationId) {
    return { ok: false, reason: "reservationMissing", error: "Réservation manquante." };
  }
  if (input.kind === "order" && !input.orderId) {
    return { ok: false, reason: "orderMissing", error: "Commande manquante." };
  }
  if (input.kind === "dining" && !input.diningPaymentId) {
    return { ok: false, reason: "orderMissing", error: "Addition manquante." };
  }

  const reference = `PAY-${randomUUID().slice(0, 10).toUpperCase()}`;
  const base = {
    reference,
    restaurant_id: input.restaurantId,
    invoice_id: input.kind === "subscription" ? input.invoiceId! : null,
    reservation_id: input.kind === "reservation" ? input.reservationId! : null,
    kind: input.kind === "order" || input.kind === "wallet" || input.kind === "dining" ? "reservation" : input.kind,
    method: "mobile_money",
    phone,
    amount,
  };

  const supabase = createAdminClient();

  /* ── Sandbox: record an instant success, no money moves ─────────────── */
  if (mode === "sandbox") {
    const { data, error } = await supabase
      .from("payment_attempts")
      .insert({ ...base, provider: "sandbox", status: "succeeded", raw_response: { sandbox: true, orderId: input.orderId, walletFunding: input.kind === "wallet", diningPaymentId: input.diningPaymentId } })
      .select("id")
      .single();

    if (error || !data) {
      console.error("[pay:initiate:sandbox]", error?.message);
      return { ok: false, reason: "recordFailed", error: "Impossible d'enregistrer le paiement." };
    }

    return { ok: true, status: "succeeded", attemptId: data.id };
  }

  if (gateway === "saspay") {
    return initiateSaspayAttempt({ input, base, phone, amount });
  }

  /* ── Live: record the INTENT, then charge ───────────────────────────── */

  // Best effort: the report id just before the charge, so confirmTransaction
  // can match OUR row precisely even if the provider's timestamps lie.
  const [afterId, notificationAfterId] = await Promise.all([
    latestTransactionId(),
    latestNotificationId(),
  ]);
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
      raw_response: { requested_at: startedAt, afterId, notificationAfterId, orderId: input.orderId, walletFunding: input.kind === "wallet", diningPaymentId: input.diningPaymentId },
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
          notificationAfterId,
          orderId: input.orderId,
          walletFunding: input.kind === "wallet", diningPaymentId: input.diningPaymentId,
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

  /*
    ORANGE: THE CUSTOMER STARTS IT (2026-09).

    Orange stopped letting a merchant pull money at a distance — people were
    being scammed by withdrawal requests they never asked for. CamerPay now
    answers an Orange `retrait` with etat:false / HTTP 404 and the code the
    customer must dial. That is not a refusal of the payment: it is its first
    half. The attempt stays PENDING with the code stored on it, the customer is
    shown the code (and the name Orange will display when they confirm), and
    every later check sends the same request again — accepted once they have
    dialled (claimDialledCollection). Treating this as providerRefused is what
    showed customers CamerPay's raw sentence as a failed payment.

    The tracking id of the refused ask is kept as transaction_id so the attempt
    is "in flight" to every resume path (they look for a pending attempt with
    one), and replaced by the accepted ask's id later.
  */
  const dial = accepted.etat ? null : dialInstructionFromRefusal(accepted.message, amount);
  if (dial) {
    const { error: dialError } = await supabase
      .from("payment_attempts")
      .update({
        transaction_id: trackingId ?? reference,
        raw_response: {
          etat: accepted.etat,
          httpStatus: accepted.httpStatus,
          message: accepted.message,
          afterId,
          notificationAfterId,
          orderId: input.orderId,
          walletFunding: input.kind === "wallet", diningPaymentId: input.diningPaymentId,
          requested_at: startedAt,
          customerDial: true,
          dialInstruction: dial,
          lastClaimAt: startedAt,
        },
      })
      .eq("id", attemptId);
    if (dialError) console.error("[pay:initiate:live] dial instruction", attemptId, dialError.message);
    return { ok: true, status: "pending", attemptId, instruction: dial };
  }

  /*
    A GATEWAY ERROR IS NOT A REFUSAL. A 5xx (or a body with no verdict in it)
    says CamerPay broke, not that it declined: the prompt may already be on
    the customer's phone. It is left pending like a transport failure, for the
    window to close — marking it failed would be asserting what nobody knows.
  */
  if (accepted.httpStatus >= 500 || typeof accepted.etat !== "boolean") {
    console.error("[pay:initiate:live] gateway error", attemptId, accepted.httpStatus, accepted.message ?? "");
    await supabase
      .from("payment_attempts")
      .update({
        raw_response: {
          requested_at: startedAt,
          afterId,
          notificationAfterId,
          orderId: input.orderId,
          walletFunding: input.kind === "wallet", diningPaymentId: input.diningPaymentId,
          gateway_error: { httpStatus: accepted.httpStatus, message: accepted.message ?? null },
        },
      })
      .eq("id", attemptId);
    return {
      ok: false,
      reason: "providerUnavailable",
      error: "Le service de paiement est indisponible, réessayez dans un instant.",
    };
  }

  if (!accepted.etat || !trackingId) {
    console.error("[pay:initiate:live] refused", accepted.message ?? accepted.httpStatus);
    // A refusal IS conclusive — no charge was accepted, so the attempt is done.
    await claimAttempt(attemptId, "failed");
    return {
      ok: false,
      reason: "providerRefused",
      error: accepted.message ?? PROVIDER_REFUSED_FALLBACK,
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
        notificationAfterId,
        orderId: input.orderId,
        walletFunding: input.kind === "wallet", diningPaymentId: input.diningPaymentId,
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


  /*
   * Mirror the admin console's first verification immediately after CamerPay
   * accepts the request. Orange often publishes its USSD instruction in the
   * notification report before the browser's first scheduled poll; returning
   * it here lets every customer-facing pending view show Copy/Open Phone at
   * once, while the attempt remains pending until a later verified success.
   */
  let instruction: PaymentInstruction | undefined;
  try {
    const initial = await confirmTransaction(trackingId, {
      phone,
      amount,
      direction: "collect",
      startedAt,
      afterId: afterId ?? undefined,
      notificationAfterId: notificationAfterId ?? undefined,
    });
    instruction = initial.instruction;
  } catch (error) {
    // A read failure cannot turn an accepted payment into a failed one.
    console.warn("[pay:initiate:initial-check]", attemptId, error);
  }

  return { ok: true, status: "pending", attemptId, instruction };
}

/**
 * Start a collection through SasPay (Cameroon: MTN / Orange, XAF).
 *
 * Same discipline as the CamerPay path: the attempt row exists BEFORE the
 * customer's phone is asked, the attempt id is SasPay's Idempotency-Key (a
 * network retry can never push a second charge), and a transport failure
 * leaves the row pending for the resolver instead of asserting a failure.
 *
 * SasPay may answer with a `checkout_url` instead of pushing a prompt (the
 * normal case for Orange Money): nothing is charged until the customer opens
 * it, so it travels back as `instruction.url` for the pending screen.
 */
async function initiateSaspayAttempt(args: {
  input: Parameters<typeof initiatePaymentAttempt>[0];
  base: Record<string, unknown>;
  phone: string;
  amount: number;
}): Promise<PaymentOutcome> {
  const { input, base, phone, amount } = args;
  if (!cameroonNetwork(phone)) {
    return {
      ok: false,
      reason: "unsupportedNetwork",
      error: "Seuls les numéros MTN et Orange Cameroun sont acceptés.",
    };
  }

  const supabase = createAdminClient();
  const startedAt = new Date().toISOString();
  const rawBase = { requested_at: startedAt, orderId: input.orderId, walletFunding: input.kind === "wallet", diningPaymentId: input.diningPaymentId };
  const { data: created, error: createError } = await supabase
    .from("payment_attempts")
    .insert({ ...base, provider: "saspay", status: "pending", raw_response: rawBase })
    .select("id")
    .single();
  if (createError || !created) {
    console.error("[pay:initiate:saspay] attempt row", createError?.message);
    return { ok: false, reason: "recordFailed", error: "Impossible d'enregistrer le paiement." };
  }
  const attemptId = created.id as string;

  const [first, ...rest] = (input.customer?.name ?? "").trim().split(/\s+/).filter(Boolean);
  const origin = await siteUrl().catch(() => "https://resto237.online");
  const returnPath = input.returnPath && input.returnPath.startsWith("/") && !input.returnPath.startsWith("//")
    ? input.returnPath
    : "/";

  let started;
  try {
    started = await startSaspayPayment({
      phone,
      amount,
      idempotencyKey: attemptId,
      description: input.reference,
      returnUrl: origin.replace(/\/+$/, "") + returnPath,
      customer: { firstName: first, lastName: rest.join(" ") || undefined, email: input.customer?.email ?? undefined },
      metadata: { attemptId, reference: input.reference, kind: input.kind },
    });
  } catch (error) {
    // Unknown, not refused: SasPay may have pushed the prompt. Left pending
    // with no transaction id, the resolver expires it after its window.
    console.error("[pay:initiate:saspay]", attemptId, error);
    await supabase
      .from("payment_attempts")
      .update({ raw_response: { ...rawBase, transport_error: error instanceof Error ? error.message : String(error) } })
      .eq("id", attemptId);
    return { ok: false, reason: "providerUnavailable", error: "Le service de paiement est indisponible, réessayez dans un instant." };
  }

  if (!started.ok) {
    if (started.error.status >= 500 || started.error.status === 0) {
      console.error("[pay:initiate:saspay] ambiguous", attemptId, started.error);
      return { ok: false, reason: "providerUnavailable", error: "Le service de paiement est indisponible, réessayez dans un instant." };
    }
    // A 4xx is a refusal before anything moved.
    console.error("[pay:initiate:saspay] refused", attemptId, started.error);
    await claimAttempt(attemptId, "failed");
    return {
      ok: false,
      reason: started.error.code === "invalid_method" ? "unsupportedNetwork" : "providerRefused",
      error: started.error.message || "Le paiement a été refusé par l'opérateur.",
    };
  }

  const instruction = saspayInstruction(started.data.checkoutUrl, started.data.instructions);
  await supabase
    .from("payment_attempts")
    .update({
      transaction_id: started.data.id,
      raw_response: { ...rawBase, checkoutUrl: started.data.checkoutUrl, instructions: started.data.instructions },
    })
    .eq("id", attemptId);

  return { ok: true, status: "pending", attemptId, instruction };
}

function saspayInstruction(checkoutUrl: string | null | undefined, instructions: string | null | undefined): PaymentInstruction | undefined {
  if (checkoutUrl) {
    return {
      message: "Terminez le paiement sur la page sécurisée de votre opérateur, puis revenez ici.",
      url: checkoutUrl,
    };
  }
  if (instructions) return { message: instructions };
  return undefined;
}

/** The SasPay half of resolveAttemptOutcome(): verify, claim, settle. */
async function resolveSaspayAttempt(row: PaymentAttemptRow): Promise<AttemptResolution> {
  const stored = saspayInstruction(
    typeof row.rawResponse?.checkoutUrl === "string" ? row.rawResponse.checkoutUrl : null,
    typeof row.rawResponse?.instructions === "string" ? row.rawResponse.instructions : null,
  );

  if (!row.transactionId) {
    if (await expireUnconfirmedMobileMoneyAttempt(row)) {
      return { status: "failed", settled: false, error: "confirmationExpired" };
    }
    return { status: "pending", settled: false, error: "notConfirmable" };
  }

  let verified;
  try {
    verified = await verifySaspayPayment(row.transactionId);
  } catch (error) {
    console.error("[pay:resolve:saspay]", row.id, error);
    return { status: "pending", settled: false, error: "providerUnavailable", instruction: stored };
  }

  if (!verified.ok) {
    if (verified.error.status === 404) {
      await claimAttempt(row.id, "failed");
      return { status: "failed", settled: false, error: "providerNotFound" };
    }
    return { status: "pending", settled: false, error: "providerUnavailable", instruction: stored };
  }

  const v = verified.data;
  if (v.verdict === "failed") {
    await claimAttempt(row.id, "failed");
    return { status: "failed", settled: false };
  }
  if (v.verdict === "pending") {
    if (await expireUnconfirmedMobileMoneyAttempt(row)) {
      return { status: "failed", settled: false, error: "confirmationExpired" };
    }
    return { status: "pending", settled: false, instruction: stored };
  }

  if (Number.isFinite(v.requested) && v.requested !== row.amount) {
    // Ours is the amount we asked for; SasPay echoing another is worth an
    // alarm but never a reason to drop money that really arrived.
    console.error("[pay:resolve:saspay] amount mismatch", row.id, v.requested, row.amount);
  }

  const claim = await claimAttempt(row.id, "succeeded", `saspay:${v.id || row.transactionId}`);
  if (claim === "rowTaken") return { status: "pending", settled: false, error: "providerRowTaken" };
  if (claim === "lost") {
    const { data: after } = await createAdminClient()
      .from("payment_attempts")
      .select("status")
      .eq("id", row.id)
      .maybeSingle();
    if (after?.status !== "succeeded") return { status: "failed", settled: false, error: "claimLost" };
  }
  return settledResolution(row.id);
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
  return { ok: true, status: outcome.status, instruction: outcome.instruction };
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

  // An attempt is always confirmed by the gateway that took it, whatever the
  // switch says now.
  if (row.provider === "saspay") return resolveSaspayAttempt(row);

  // A pending sandbox attempt, or one whose 202 never came back with a
  // tracking id, has nothing to ask: past the window it is simply expired.
  if (row.provider !== "camerpay" || !row.transactionId) {
    if (await expireUnconfirmedMobileMoneyAttempt(row)) {
      return { status: "failed", settled: false, error: "confirmationExpired" };
    }
    return { status: "pending", settled: false, error: "notConfirmable" };
  }

  /*
    ASK BEFORE EXPIRING (0059).

    This used to expire any attempt older than the five-minute window BEFORE
    asking CamerPay. An Orange USSD payment approved at minute four and
    reported at minute six was therefore marked failed and never credited —
    the customer paid, the order lapsed, and nothing noticed. The provider is
    now asked first; only an answer that is still "pending" lets the window
    close the attempt. A success that arrives for an order no longer waiting
    for it is refunded automatically in settlePayment().
  */

  // Set when Orange refused to push a prompt and the customer must dial.
  const dial = storedDialInstruction(row);
  const hint = await reportHint(row, Boolean(dial));

  let confirmed;
  try {
    confirmed = await confirmTransaction(row.transactionId, hint);
  } catch (error) {
    console.error("[pay:resolve]", attemptId, error);
    return { status: "pending", settled: false, error: "providerUnavailable", instruction: dial ?? undefined };
  }

  /*
    A dial payment is never failed by a report row. Until the customer dials,
    every ask of ours is "refused" by design, and a row or notice saying so is
    the normal state of a payment that has not started — only the window
    closing ends it.
  */
  if (confirmed.status === "failed" && !dial) {
    await claimAttempt(attemptId, "failed");
    return { status: "failed", settled: false };
  }

  if (confirmed.status !== "success" && dial) {
    // Ask again: this is what makes CamerPay look for the customer's dial.
    let claimed = await claimDialledCollection(row, dial, hint);

    const alreadyAccepted =
      typeof row.rawResponse?.claimAcceptedAt === "string" ? Date.parse(row.rawResponse.claimAcceptedAt) : NaN;
    const windowOver =
      Date.now() - Date.parse(row.createdAt) >= confirmationWindowMs(row.provider, row.rawResponse);

    /*
      THE LAST WORD BEFORE GIVING UP IS CAMERPAY'S, AND IT IS ASKED FOR NOW.

      The ask above may have been skipped (asked a few seconds ago) or may
      have failed to reach CamerPay. Closing the attempt on that would fail a
      customer who dialled in the last half minute: nothing looks at a failed
      attempt again, so their money would sit with Orange, unclaimed. So when
      the window is over, one ask is made with no throttle — and if CamerPay
      cannot be reached, the attempt is kept rather than closed.
    */
    if (windowOver && !claimed.asked && !claimed.accepted && !Number.isFinite(alreadyAccepted)) {
      claimed = await claimDialledCollection(
        { ...row, rawResponse: { ...(row.rawResponse ?? {}), lastClaimAt: null } },
        dial,
        hint,
      );
      if (!claimed.asked) {
        return { status: "pending", settled: false, error: "providerUnavailable", instruction: dial };
      }
    }

    if (claimed.confirmed?.status === "success") {
      confirmed = claimed.confirmed;
    } else {
      const acceptedAt = claimed.accepted ? Date.now() : alreadyAccepted;
      if (Number.isFinite(acceptedAt) && Date.now() - acceptedAt < DIAL_ACCEPTED_GRACE_MS) {
        // "dialClaimAccepted" also tells the reconciler not to abandon it yet.
        return { status: "pending", settled: false, error: "dialClaimAccepted", instruction: claimed.instruction ?? undefined };
      }
      /*
        CamerPay accepted this customer's dial and the report that would prove
        the money cannot be READ. That is not "the report does not show it":
        the grace running out during an outage must not close a payment the
        customer has made. It waits for a readable report (the reconciler keeps
        such attempts for hours).
      */
      if (Number.isFinite(acceptedAt) && (confirmed.unavailable || claimed.confirmed?.unavailable)) {
        return { status: "pending", settled: false, error: "providerUnavailable", instruction: claimed.instruction ?? undefined };
      }
      if (await expireUnconfirmedMobileMoneyAttempt(row, { evenIfDialAccepted: Number.isFinite(acceptedAt) })) {
        if (Number.isFinite(acceptedAt)) {
          // CamerPay accepted the ask after the customer dialled, and its
          // readable report never showed the money. Nothing automatic can be
          // right here, so a person is told — once: only the caller that
          // closed the attempt reaches this line.
          console.error("[pay:resolve] accepted dial claim never confirmed", attemptId);
          await notify({
            event: "broadcast",
            tone: "error",
            admins: true,
            href: "/a/payments",
            params: {
              reference: `dial-unconfirmed:${attemptId}`,
              subject: `Orange payment ${row.reference} needs checking`,
              bodyText: `CamerPay accepted an Orange payment of ${row.amount} FCFA from ${row.phone ?? "an unknown number"} after the customer dialled the code, but its reports never showed the money, so nothing was credited. Check the CamerPay transaction report for that number and amount, and refund or apply it by hand.`,
            },
          });
        }
        return { status: "failed", settled: false, error: "confirmationExpired" };
      }
      return { status: "pending", settled: false, instruction: claimed.instruction ?? undefined };
    }
  }

  if (confirmed.status !== "success") {
    /*
      "Pending" because CamerPay's report could not be read is not "pending
      because nobody paid". Closing the attempt on it would defeat asking
      before expiring: a PIN entered at minute four, during a report outage,
      would be lost. The attempt waits for a readable answer instead (the
      reconciler gives up only after hours of that).
    */
    if (confirmed.unavailable) {
      return { status: "pending", settled: false, error: "providerUnavailable", instruction: confirmed.instruction };
    }
    if (await expireUnconfirmedMobileMoneyAttempt(row)) {
      return { status: "failed", settled: false, error: "confirmationExpired" };
    }
    return { status: "pending", settled: false, instruction: confirmed.instruction };
  }

  if (!confirmed.rowId) {
    /*
      NO IDENTITY, NO MONEY.

      A payment is claimed under the operator's reference, and the unique index
      on that claim is the only thing that stops two attempts settling from one
      real payment (the second would then be "refunded" — money paid out that
      was received once). A verdict with nothing to claim cannot have that
      protection, so it is not settled: it stays pending and says so loudly.
      It means the report's shape changed under us.
    */
    console.error("[pay:resolve] confirmed payment has no claimable identity — NOT settled", attemptId);
    return { status: "pending", settled: false, error: "noProviderIdentity" };
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

/**
 * The facts a collection's report row is matched on. The exclusion list keeps
 * a retry off the row its own first try already consumed.
 */
async function reportHint(row: PaymentAttemptRow, customerInitiated: boolean) {
  return {
    phone: row.phone ?? undefined,
    amount: row.amount,
    direction: "collect" as const,
    startedAt:
      typeof row.rawResponse?.requested_at === "string"
        ? row.rawResponse.requested_at
        : row.createdAt,
    afterId:
      typeof row.rawResponse?.afterId === "number"
        ? row.rawResponse.afterId
        : undefined,
    notificationAfterId:
      typeof row.rawResponse?.notificationAfterId === "number"
        ? row.rawResponse.notificationAfterId
        : undefined,
    excludeRowIds: await consumedRowIds(row),
    customerInitiated,
  };
}

/**
 * Give up an Orange payment nobody has dialled, so the customer can pay from
 * another number.
 *
 * A pushed prompt may be answered at any moment, which is why a live attempt
 * blocks a change of number. A code that was never dialled holds no money —
 * but "never dialled" is CamerPay's to say, not ours: it is asked one last
 * time, now, and only a fresh "not detected, dial this" closes the attempt.
 * Accepted, unreachable or anything else, the attempt stays and the caller
 * keeps refusing the second number.
 */
export async function releaseUndialledAttempt(attemptId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("payment_attempts").select("*").eq("id", attemptId).maybeSingle();
  if (!data) return false;

  const row = attemptRow(data);
  const dial = storedDialInstruction(row);
  if (row.status !== "pending" || row.provider !== "camerpay" || !dial) return false;
  if (typeof row.rawResponse?.claimAcceptedAt === "string") return false;

  // No throttle on this ask: the answer has to be from this instant.
  const unthrottled: PaymentAttemptRow = { ...row, rawResponse: { ...row.rawResponse, lastClaimAt: null } };
  const claimed = await claimDialledCollection(unthrottled, dial, await reportHint(row, true));
  if (!claimed.refused) return false;

  return (await claimAttempt(attemptId, "failed")) === "won";
}

/**
 * One look back at an Orange payment that expired undialled.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE CODE DOES NOT EXPIRE WHEN OUR ATTEMPT DOES.
 *
 *  "#150*14*…*amount#" is a fixed code. A customer who copied it, was
 *  interrupted, and dials it fifteen minutes later is debited by Orange all
 *  the same — and nothing here would ever know: a failed attempt is never
 *  looked at again, so the money would sit with Orange, claimed by nobody,
 *  the order long cancelled.
 *
 *  So the reconciler asks CamerPay ONE more time, a while after such an
 *  attempt closed:
 *
 *    "not detected"  nobody dialled. Noted on the attempt; never asked again.
 *    accepted        they did dial. The attempt is reopened and goes through
 *                    the ordinary resolver: the report confirms the money, and
 *                    settlement either pays the order (if it is still waiting)
 *                    or — the usual case — refunds the customer automatically
 *                    as a late payment.
 *
 *  Skipped while the same number has a live attempt for the same amount: that
 *  attempt is the one the customer is dialling for, and this ask would take
 *  the payment from under it.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function recheckExpiredDialAttempt(attemptId: string): Promise<"notDialled" | "reopened" | "skipped"> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("payment_attempts").select("*").eq("id", attemptId).maybeSingle();
  if (!data) return "skipped";

  const row = attemptRow(data);
  const raw = row.rawResponse ?? {};
  if (row.status !== "failed" || row.provider !== "camerpay" || raw.customerDial !== true || raw.lateCheck || !row.phone) {
    return "skipped";
  }

  const { data: live, error: liveError } = await supabase
    .from("payment_attempts")
    .select("id")
    .eq("provider", "camerpay")
    .eq("status", "pending")
    .eq("phone", row.phone)
    .eq("amount", row.amount)
    .limit(1);
  if (liveError || (live ?? []).length > 0) return "skipped";

  let again;
  try {
    again = await requestCollection(row.phone, row.amount);
  } catch (error) {
    console.warn("[pay:dial-late]", row.id, error);
    return "skipped";
  }
  // A gateway error says nothing either way: try again on a later sweep.
  if (again.httpStatus >= 500 || typeof again.etat !== "boolean") return "skipped";

  const now = new Date().toISOString();

  if (!again.etat) {
    // Only CamerPay's own "not detected — dial this" is a final answer. Any
    // other refusal (a lapsed token, a rate limit) says nothing about the
    // customer, and the attempt is asked about again on a later sweep.
    if (!dialInstructionFromRefusal(again.message, row.amount)) {
      console.warn("[pay:dial-late] inconclusive answer", row.id, again.httpStatus, again.message ?? "");
      return "skipped";
    }
    await supabase
      .from("payment_attempts")
      .update({ raw_response: { ...raw, lateCheck: { at: now, result: "notDialled" } } })
      .eq("id", row.id)
      .eq("status", "failed");
    return "notDialled";
  }

  const trackingId = acceptedTransactionId(again) ?? row.transactionId ?? row.reference;
  console.error("[pay:dial-late] PAID AFTER EXPIRY — reopening", row.id, trackingId);

  await recordAcceptedRequest({
    replyTo: trackingId,
    direction: "collect",
    phone: row.phone,
    amount: row.amount,
    afterId: typeof raw.afterId === "number" ? raw.afterId : null,
    startedAt: typeof raw.requested_at === "string" ? raw.requested_at : row.createdAt,
  });

  const { data: reopened, error: reopenError } = await supabase
    .from("payment_attempts")
    .update({
      status: "pending",
      settled_at: null,
      transaction_id: trackingId,
      raw_response: {
        ...raw,
        claimAcceptedAt: now,
        lateCheck: { at: now, result: "accepted" },
        claimResponse: { etat: again.etat, httpStatus: again.httpStatus, message: again.message, data: again.data },
      },
    })
    .eq("id", row.id)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();
  if (reopenError || !reopened) {
    console.error("[pay:dial-late] could not reopen — LOOK AT THIS ATTEMPT BY HAND", row.id, reopenError?.message);
    return "skipped";
  }

  await resolveAttemptOutcome(row.id);
  return "reopened";
}

/**
 * Ask CamerPay again for an Orange payment the customer must start.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE SAME `retrait`, SENT AGAIN, IS HOW THE PAYMENT IS FOUND.
 *
 *  Nothing reaches us when the customer dials the code: CamerPay looks for
 *  their Orange withdrawal only when asked. So every check of a waiting dial
 *  payment — the customer's open page, the webhook, the reconciler — repeats
 *  the request, at most once every few seconds:
 *
 *    refused again, with the code   the customer has not dialled yet. Pending,
 *                                   and the code is shown again.
 *    accepted                       CamerPay found the withdrawal. The new
 *                                   tracking id replaces the refused one and
 *                                   the report is asked for the verdict.
 *
 *  AN ACCEPTANCE IS STILL NOT A PAYMENT. For MTN the same answer only means a
 *  prompt was pushed, so believing it would hand out unpaid orders the day
 *  Orange's behaviour changes again. The verdict stays with confirmTransaction
 *  — a report row carrying the operator's reference, or the operator's
 *  receipt — like every other payment. (Seen live on 2026-09-30: the refused
 *  ask is row "used, no reference, Aucun retrait… détecté"; the ask sent after
 *  the customer dialled is a new row with reference CO260930.0949.B50907 and a
 *  "RETRAIT_ORANGE validé avec succès" receipt beside it.) Once accepted, the
 *  ask is not repeated: the attempt is an ordinary accepted collection from
 *  then on.
 *
 *  Safe under concurrency: two racing asks can at most both be accepted for
 *  one withdrawal, and the claim that follows is a compare-and-swap on the
 *  attempt plus a unique index on the report row.
 * ─────────────────────────────────────────────────────────────────────────
 */
async function claimDialledCollection(
  row: PaymentAttemptRow,
  dial: PaymentInstruction,
  hint: Parameters<typeof confirmTransaction>[1],
): Promise<{
  confirmed?: Awaited<ReturnType<typeof confirmTransaction>>;
  /** What to show while waiting: the code, until an ask has been accepted. */
  instruction?: PaymentInstruction;
  accepted?: boolean;
  /** CamerPay answered THIS ask with "not detected — dial the code". */
  refused?: boolean;
  /** CamerPay was reached and answered (false when throttled or unreachable). */
  asked?: boolean;
}> {
  const raw = row.rawResponse ?? {};

  // Already accepted on an earlier check: the report decides from here.
  if (typeof raw.claimAcceptedAt === "string") return { instruction: DIAL_RECEIVED };
  if (!row.phone) return { instruction: dial };

  const last = typeof raw.lastClaimAt === "string" ? Date.parse(raw.lastClaimAt) : NaN;
  const age = Date.now() - Date.parse(row.createdAt);
  if (Number.isFinite(last) && Date.now() - last < dialReaskDelayMs(Number.isFinite(age) ? age : 0)) {
    return { instruction: dial };
  }

  let again;
  try {
    again = await requestCollection(row.phone, row.amount);
  } catch (error) {
    console.warn("[pay:dial-claim]", row.id, error);
    return { instruction: dial };
  }

  // A 5xx, or a body with no verdict in it, is CamerPay breaking — not CamerPay
  // saying "not detected". It is no answer at all, so nothing may be closed on it.
  if (again.httpStatus >= 500 || typeof again.etat !== "boolean") {
    console.warn("[pay:dial-claim] gateway error", row.id, again.httpStatus);
    return { instruction: dial };
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  if (!again.etat) {
    const fresh = dialInstructionFromRefusal(again.message, row.amount);
    const { error } = await supabase
      .from("payment_attempts")
      .update({
        raw_response: {
          ...raw,
          lastClaimAt: now,
          // An answer that is neither "accepted" nor "dial this" is kept for
          // whoever investigates; the customer still holds a valid code.
          ...(fresh ? { dialInstruction: fresh } : { lastClaimMessage: again.message ?? `HTTP ${again.httpStatus}` }),
        },
      })
      .eq("id", row.id)
      .eq("status", "pending")
      // Never over an acceptance another route recorded a moment ago: this
      // write is built from a copy of the row that predates it.
      .is("raw_response->>claimAcceptedAt", null);
    if (error) console.error("[pay:dial-claim] stamp", row.id, error.message);
    return { instruction: fresh ?? dial, refused: Boolean(fresh), asked: true };
  }

  const trackingId = acceptedTransactionId(again) ?? row.transactionId ?? row.reference;
  console.info("[pay:dial-claim] accepted", row.id, trackingId, again.httpStatus, again.message ?? "");

  // The webhook arrives carrying only this id — same bookkeeping as a pushed
  // collection's acceptance.
  await recordAcceptedRequest({
    replyTo: trackingId,
    direction: "collect",
    phone: row.phone,
    amount: row.amount,
    afterId: hint?.afterId ?? null,
    startedAt: hint?.startedAt,
  });

  const { error: linkError } = await supabase
    .from("payment_attempts")
    .update({
      transaction_id: trackingId,
      raw_response: {
        ...raw,
        lastClaimAt: now,
        claimAcceptedAt: now,
        claimResponse: {
          etat: again.etat,
          httpStatus: again.httpStatus,
          message: again.message,
          data: again.data,
        },
      },
    })
    .eq("id", row.id)
    .eq("status", "pending");
  if (linkError) console.error("[pay:dial-claim] tracking id", row.id, linkError.message);

  try {
    return { confirmed: await confirmTransaction(trackingId, hint), accepted: true, asked: true, instruction: DIAL_RECEIVED };
  } catch (error) {
    // A read failure cannot turn an accepted ask into a failed payment.
    console.warn("[pay:dial-claim] confirm", row.id, error);
    return { accepted: true, asked: true, instruction: DIAL_RECEIVED };
  }
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
  } else if (row.kind === "wallet") {
    const settledAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from("payment_attempts")
      .update({ settled_at: settledAt })
      .eq("id", row.id)
      .eq("status", "succeeded")
      .is("settled_at", null)
      .select("id")
      .maybeSingle();

    if (claimError) {
      error = "Le paiement est confirmé mais le portefeuille n'a pas pu être crédité.";
      reason = "walletFundingClaimFailed";
    } else if (!claimed) {
      ok = true;
    } else {
      const { error: creditError } = await supabase.rpc("wallet_credit", {
        p_restaurant_id: row.restaurantId,
        p_amount: row.amount,
        p_kind: "payment",
        p_note: "Approvisionnement Mobile Money " + row.reference,
        p_reference: row.reference,
      });
      if (creditError) {
        await supabase
          .from("payment_attempts")
          .update({ settled_at: null })
          .eq("id", row.id)
          .eq("settled_at", settledAt);
        error = "Le paiement est confirmé mais le portefeuille n'a pas pu être crédité.";
        reason = "walletCreditFailed";
      } else {
        ok = true;
      }
    }
  } else if (row.kind === "dining" && row.diningPaymentId) {
    /*
     * ONE PART OF A TABLE BILL (0068).
     *
     * settle_dining_payment locks the payment and its bill, credits the
     * restaurant share + tip, books the gateway fee as platform revenue, and
     * closes the bill when it is covered — one transaction. A payment that
     * lands for a bill that no longer wants it (closed in cash meanwhile,
     * already covered by a friend) is refunded straight away, exactly like a
     * late payment for a cancelled order.
     */
    const { data: settlement, error: settlementError } = await supabase.rpc("settle_dining_payment", {
      p_payment_id: row.diningPaymentId,
      p_amount: row.amount,
    });
    if (settlementError) {
      const message = settlementError.message ?? "";
      if (message.includes("not_payable") || message.includes("amount_mismatch")) {
        const { data: payment } = await supabase
          .from("dining_payments")
          .select("session_id, dining_sessions ( order_id )")
          .eq("id", row.diningPaymentId)
          .maybeSingle();
        const sessionRow = (payment as { dining_sessions?: { order_id: string | null } | { order_id: string | null }[] | null } | null)?.dining_sessions;
        const orderId = (Array.isArray(sessionRow) ? sessionRow[0]?.order_id : sessionRow?.order_id) ?? null;
        const stamp = new Date().toISOString();
        const refundId = orderId
          ? await refundUnpayableAttempt({
              attemptId,
              orderId,
              restaurantId: row.restaurantId,
              amount: row.amount,
              phone: row.phone,
              reason: `Paiement reçu pour une addition qui ne l'attendait plus (${row.reference})`,
            })
          : null;
        if (orderId && !refundId) {
          // The refund could not be recorded: nothing is stamped, so the next
          // sweep comes back to it instead of leaving the money owed to nobody.
          console.error("[pay:settle:dining] refund row could not be recorded — will retry", attemptId);
          error = "Le paiement est confirmé mais son remboursement n'a pas pu être enregistré.";
          reason = "orderSettlementFailed";
        } else {
          if (!refundId) {
            // A bill with no order behind it has nothing a refund can hang on.
            console.error("[pay:settle:dining] LATE PAYMENT WITH NO ORDER — refund by hand", attemptId, row.amount, row.phone);
          }
          await supabase.from("dining_payments").update({ status: "refunded" }).eq("id", row.diningPaymentId).neq("status", "succeeded");
          await supabase
            .from("payment_attempts")
            .update({
              settled_at: stamp,
              raw_response: { ...(row.rawResponse ?? {}), refund_due: { reason: "billNotPayable", at: stamp, refundId } },
            })
            .eq("id", attemptId)
            .is("settled_at", null);
          if (refundId) {
            await startRefundPayout(refundId).catch((err) => console.error("[pay:settle:dining] refund", refundId, err));
          }
          error = "Cette addition n'attend plus ce paiement ; il vous est remboursé.";
          reason = "orderNotPayable";
        }
      } else {
        console.error("[pay:settle:dining] settlement", message);
        error = "Le paiement est confirmé mais l'addition n'a pas pu être mise à jour.";
        reason = "orderSettlementFailed";
      }
    } else {
      const result = (settlement ?? {}) as {
        alreadySettled?: boolean;
        closed?: boolean;
        sessionId?: string;
        amount?: number;
        tip?: number;
        guestId?: string | null;
      };
      if (!result.alreadySettled && result.sessionId) {
        await notifyDiningPartPaid({
          sessionId: result.sessionId,
          restaurantId: row.restaurantId,
          amount: result.amount ?? 0,
          tip: result.tip ?? 0,
          closed: Boolean(result.closed),
          payerGuestId: result.guestId ?? null,
        }).catch((err) => console.error("[pay:settle:dining] notify", err));
      }
      ok = true;
    }
  } else if (row.kind === "order" && row.orderId) {
    /*
     * The RPC locks the order, credits the restaurant only with the amount it
     * earned, records the platform payment fee, and marks the order paid in
     * one database transaction. A callback and a poll can race safely: the
     * losing caller receives `alreadySettled` and creates no second ledger row.
     */
    const order = await readOrderForSettlement(row.orderId, row.restaurantId);
    const payable =
      order !== null &&
      order !== "unreadable" &&
      order.status === "awaiting_customer" &&
      order.payment_method === "mobile_money" &&
      Number(order.total) === row.amount;

    /*
      WHO PAID THIS ORDER? — asked before any money goes back.

      The order is no longer waiting. That is the late-payment case (cancelled
      by the time limit, paid by another attempt, total changed) — and it is
      ALSO exactly what this attempt's own settlement looks like from a second
      caller: the first one marked the order paid a second ago and is still
      sending its notifications, so `settled_at` is not stamped yet. That second
      caller (the webhook beside the poll, a re-tap, the reconciler after a
      crash) used to take the refund branch: the restaurant was credited, the
      order stayed paid, and the customer got the whole amount back.

      So the refund is only issued when this attempt is NOT the one that paid.
      "Unknown" refunds nothing and stamps nothing — the next sweep asks again.
    */
    const paidByThis =
      payable || order === null || order === "unreadable" ? "no" : await orderPaidByAttempt(order, row);

    if (order === "unreadable" || paidByThis === "unknown") {
      error = "Le paiement est confirmé mais la commande n'a pas pu être relue.";
      reason = "orderSettlementFailed";
    } else if (!payable && paidByThis === "yes") {
      // Applied by an earlier or concurrent run of this same attempt.
      ok = true;
    } else if (!payable) {
      /*
        THE MONEY ARRIVED FOR AN ORDER NO LONGER WAITING FOR IT — cancelled
        by the time limit, already paid by another attempt, total changed.
        It was never credited to anyone, so it goes straight back: a refund
        row keyed on this attempt (idempotent), and the payout starts now.
        `refund_due` used to be written here and read by nothing, which
        charged the customer for a cancelled order in silence.

        The attempt is stamped finished ONLY once the refund row exists. It
        used to be stamped whatever the insert answered, and a refund that
        failed to record was then owed to nobody and retried by nothing.
      */
      const stamp = new Date().toISOString();
      const refundId = await refundUnpayableAttempt({
        attemptId,
        orderId: row.orderId,
        restaurantId: row.restaurantId,
        amount: row.amount,
        phone: row.phone,
        reason: `Paiement reçu pour une commande qui ne l'attendait plus (${order?.reference ?? row.reference})`,
      });
      if (!refundId) {
        console.error("[pay:settle:order] refund row could not be recorded — will retry", attemptId);
        error = "Le paiement est confirmé mais son remboursement n'a pas pu être enregistré.";
        reason = "orderSettlementFailed";
      } else {
        await supabase
          .from("payment_attempts")
          .update({
            settled_at: stamp,
            raw_response: { ...(row.rawResponse ?? {}), refund_due: { reason: "orderNotPayable", at: stamp, refundId } },
          })
          .eq("id", attemptId)
          .is("settled_at", null);
        await startRefundPayout(refundId).catch((err) => console.error("[pay:settle:order] refund", refundId, err));
        error = "Cette commande n'attend plus ce paiement ; il vous est remboursé.";
        reason = "orderNotPayable";
      }
    } else {
      // The attempt id travels with the settlement (0070): the order records
      // which attempt paid it, in the same transaction that marks it paid.
      let { data: settlement, error: settlementError } = await supabase.rpc("settle_online_order_payment", {
        p_order_id: row.orderId,
        p_attempt_id: attemptId,
      });
      if (settlementError && isMissingFunction(settlementError)) {
        // 0070 not applied yet: the function takes the order alone.
        ({ data: settlement, error: settlementError } = await supabase.rpc("settle_online_order_payment", {
          p_order_id: row.orderId,
        }));
      }
      if (settlementError) {
        // Lost a race to another run of this attempt (it paid the order between
        // our read and this call)? Then there is nothing left to do here.
        const again = await readOrderForSettlement(row.orderId, row.restaurantId);
        if (again && again !== "unreadable" && (await orderPaidByAttempt(again, row)) === "yes") {
          ok = true;
        } else {
          console.error("[pay:settle:order] settlement", settlementError.message);
          error = "Le paiement est confirmé mais la répartition n'a pas pu être enregistrée.";
          reason = "orderSettlementFailed";
        }
      } else {
        const alreadySettled = Boolean((settlement as { alreadySettled?: boolean } | null)?.alreadySettled);
        if (!alreadySettled) {
          const { error: receiptError } = await supabase.from("order_payments").insert({
            order_id: row.orderId,
            amount: row.amount,
            method: "mobile_money",
            collected_by: "camerpay",
          });
          if (receiptError) console.error("[pay:settle:order] receipt", receiptError.message);

          await notify({
            event: "new_order",
            tone: "success",
            restaurantId: row.restaurantId,
            href: `/m/orders/${row.orderId}`,
            params: {
              reference: order.reference,
              customerName: order.delivery_name ?? undefined,
              amount: row.amount,
              paid: true,
            },
          });
          if (order.dining_session_id) await notifyDiningPaymentSettled(row.orderId, row.amount);
        }
        ok = true;
      }
    }  } else if (row.kind === "reservation" && row.reservationId) {
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
      .select("id, reference, customer_id, guest_name, deposit_amount")
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
        /*
          BUT THE MONEY IS REAL, AND IT IS OURS TO GIVE BACK.

          This branch used to return an error and nothing else: the attempt
          stayed "succeeded, unsettled" for ever, re-tried by every sweep, and
          the customer's deposit sat in the platform's balance with nobody
          told. Booking refunds carry their own bookkeeping (one per booking,
          compensation, 0050), so this one is not sent automatically: the
          attempt is closed with the debt written on it, and the admins are
          told once — whoever wins the stamp sends the alert.

          ONLY when the booking shows the deposit was never applied. A booking
          whose deposit IS marked paid may have been paid by this very attempt
          (a settlement that crashed before its stamp, the customer seated
          since): telling an admin to refund that would give away a deposit
          the restaurant earned. That case stays as it was.
        */
        const stamp = new Date().toISOString();
        // Nor when the booking is still waiting for its deposit: a concurrent
        // run handed its claim back a moment ago, and the next one pays it.
        const notLate = existing.deposit_paid || existing.status === "awaiting_payment";
        const { data: flagged } = notLate ? { data: null } : await supabase
          .from("payment_attempts")
          .update({
            settled_at: stamp,
            raw_response: { ...(row.rawResponse ?? {}), refund_due: { reason: "reservationNotPayable", at: stamp, manual: true } },
          })
          .eq("id", attemptId)
          .is("settled_at", null)
          .select("id")
          .maybeSingle();
        if (flagged) {
          console.error("[pay:settle:reservation] LATE DEPOSIT — refund by hand", attemptId, row.amount, row.phone);
          await notify({
            event: "broadcast",
            tone: "error",
            admins: true,
            href: "/a/payments",
            params: {
              reference: `late-deposit:${attemptId}`,
              subject: `Late deposit ${row.reference} needs a refund`,
              bodyText: `A deposit of ${row.amount} FCFA from ${row.phone ?? "an unknown number"} arrived for booking ${String(existing.reference ?? "")}, which no longer expects it. It was not credited to the restaurant. Refund it from Payments → CamerPay → Withdraw to a wallet.`,
            },
          });
        }
        error = "La réservation n'attend plus ce paiement.";
        reason = "reservationNotPayable";
      }
    } else {
      const booking = claimed as {
        id: string;
        reference: string;
        customer_id: string | null;
        guest_name: string | null;
        deposit_amount: number | null;
      };
      /*
        THE PAYMENT FEE STAYS WITH THE PLATFORM (0068).

        Since 0068 the customer pays the deposit PLUS the payment service fee
        (the gateway takes its percentage on every Mobile Money payment). The
        restaurant is credited the deposit — the amount it set, the amount
        refunds are computed from — and the difference is platform revenue.
        An attempt started before 0068 carried no fee: its amount equals the
        deposit and the whole of it goes to the restaurant, as before.
      */
      const depositDue = Math.max(0, Math.round(Number(booking.deposit_amount ?? row.amount)));
      const depositFee = Math.max(0, row.amount - depositDue);
      const { error: creditError } = await supabase.rpc("wallet_credit", {
        p_restaurant_id: row.restaurantId,
        p_amount: row.amount - depositFee,
        p_kind: "deposit",
        p_note: `Acompte ${booking.reference} (paiement en ligne)`,
        p_reference: booking.reference,
      });

      if (!creditError && depositFee > 0) {
        const { error: feeError } = await supabase.from("platform_revenue_ledger").insert({
          source_type: "online_payment_fee",
          source_id: row.id,
          restaurant_id: row.restaurantId,
          gross: row.amount,
          amount: depositFee,
          reference: booking.reference,
          note: "Reservation deposit payment fee",
        });
        // A duplicate is the retry of a settlement that already booked it.
        if (feeError && feeError.code !== "23505") console.error("[pay:settle:reservation] fee", feeError.message);
      }

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

/** PostgREST could not find the function with those arguments (a migration not applied yet). */
function isMissingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");
}

interface SettlementOrder {
  id: string;
  reference: string;
  delivery_name: string | null;
  status: string;
  payment_method: string;
  total: number;
  is_paid: boolean;
  dining_session_id: string | null;
  /** The attempt whose settlement marked the order paid (0070). Undefined before that migration. */
  paid_attempt_id?: string | null;
}

/** The order an attempt is settling: null when it does not exist, "unreadable" when the read failed. */
async function readOrderForSettlement(orderId: string, restaurantId: string): Promise<SettlementOrder | null | "unreadable"> {
  const supabase = createAdminClient();
  const columns = "id, reference, delivery_name, status, payment_method, total, is_paid, dining_session_id";

  const read = (select: string) =>
    supabase.from("orders").select(select).eq("id", orderId).eq("restaurant_id", restaurantId).maybeSingle();

  let result = await read(columns + ", paid_attempt_id");
  if (result.error && isMissingColumn(result.error)) result = await read(columns);
  if (result.error) {
    console.error("[pay:settle:order] read", orderId, result.error.message);
    return "unreadable";
  }
  return (result.data as unknown as SettlementOrder | null) ?? null;
}

/**
 * Did THIS attempt's settlement pay the order? The rule is orderPayerVerdict
 * (./order-payer, tested); this only fetches what it needs — the other
 * confirmed attempts for the order, and only when the order cannot answer
 * by itself.
 */
async function orderPaidByAttempt(order: SettlementOrder, row: PaymentAttemptRow): Promise<"yes" | "no" | "unknown"> {
  const attempt = { id: row.id, createdAt: row.createdAt, amount: row.amount };
  if (!orderCouldBePaidBy(order, attempt) || orderNamesItsPayer(order)) {
    return orderPayerVerdict(order, attempt, []);
  }

  const { data, error } = await createAdminClient()
    .from("payment_attempts")
    .select("id, created_at, settled_at, raw_response")
    .eq("raw_response->>orderId", order.id)
    .eq("status", "succeeded")
    .neq("id", row.id)
    .limit(50);
  if (error) {
    console.error("[pay:settle:order] payer lookup", order.id, error.message);
    return orderPayerVerdict(order, attempt, null);
  }

  const others = ((data ?? []) as { id: string; created_at: string; settled_at: string | null; raw_response: Record<string, unknown> | null }[])
    .map((other) => ({
      id: other.id,
      createdAt: other.created_at,
      settledAt: other.settled_at,
      refundDue: Boolean(other.raw_response?.refund_due),
    }));
  return orderPayerVerdict(order, attempt, others);
}

/**
 * How long a pending Mobile Money prompt counts as "in flight".
 *
 * MTN and Orange prompts lapse within minutes; past this, a pending attempt is
 * one the customer walked away from, and it must not hold the order hostage
 * until the reconciler's six-hour horizon closes it. A success that still
 * lands later is caught by the refund flag in settlePayment.
 */
const IN_FLIGHT_MS = MOBILE_MONEY_CONFIRMATION_WINDOW_MS;

/**
 * Whether a customer is paying for this order right now.
 *
 * Order attempts carry the order id in `raw_response.orderId` — the column
 * `payment_attempts.order_id` does not exist on the live database — so the
 * lookup filters on the JSON path.
 */
export async function orderPaymentInFlight(orderId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("payment_attempts")
    .select("provider, created_at, raw_response")
    .eq("raw_response->>orderId", orderId)
    .eq("status", "pending")
    .gt("created_at", new Date(Date.now() - SASPAY_CONFIRMATION_WINDOW_MS).toISOString());

  if (error) {
    // Unknown is treated as "maybe": refusing a cancellation for a minute is
    // recoverable, a customer charged for a cancelled order is not.
    console.error("[pay:inFlight]", orderId, error.message);
    return true;
  }
  // Each attempt is "in flight" for its own gateway's window.
  return ((data ?? []) as { provider: string; created_at: string; raw_response: unknown }[]).some(
    (a) => Date.now() - Date.parse(a.created_at) < Math.max(IN_FLIGHT_MS, confirmationWindowMs(a.provider, a.raw_response)),
  );
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
    // The confirmation opens the booking voucher (0068) — the QR the customer
    // shows at the door. Read on its own and tolerated when missing, so a
    // database without 0068 still confirms the booking.
    const { data: voucher } = await createAdminClient()
      .from("reservations")
      .select("voucher_code")
      .eq("reference", input.reference)
      .eq("restaurant_id", input.restaurantId)
      .maybeSingle();
    const code = (voucher as { voucher_code?: string | null } | null)?.voucher_code;
    await notify({
      event: "reservation_decision",
      tone: "success",
      customerId: input.customerId,
      href: code ? `/v/${code}` : "/reservations",
      params: { reference: input.reference, status: "confirmed" },
    });
  }
}

