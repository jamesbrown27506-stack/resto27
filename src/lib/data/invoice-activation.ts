import "server-only";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Mark an invoice paid and extend the subscription. THE ONLY PATH (§6).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  DELIBERATELY NOT A SERVER ACTION.
 *
 *  This file is a plain server module, not a `"use server"` file: an exported
 *  function in a `"use server"` module becomes a POST endpoint that grants
 *  paid service to anyone who can guess an invoice id. Being a plain module
 *  keeps it callable by the server actions on both sides — the admin's
 *  `confirmPaymentAttempt` and the tenant-side flow — and by the CamerPay
 *  webhook and the reconciler, without ever being reachable from a URL.
 *
 *  THIS IS THE ONLY FUNCTION that moves a subscription's end date AND marks
 *  the invoice paid. The moment there are two activation paths they disagree,
 *  and the disagreement is money: one path credits a month the other does
 *  not, and the tenant either gets free service or pays twice.
 *
 *  IDEMPOTENCE IS THE `unpaid → paid` CLAIM, NOT THE READ ABOVE IT. The status
 *  check at the top stops the ordinary replay; the conditional UPDATE is what
 *  stops two activations that read `unpaid` in the same millisecond, which is
 *  exactly what a webhook and a poll landing together do. Nothing is granted
 *  before that claim is won.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Like ActionResult, plus the stable failure code the callers map. */
export type ActivationResult =
  | { ok: true; note?: string; reason?: string }
  | { ok: false; error: string; reason?: string };

/** One plan month. */
const PERIOD_DAYS = 30;

export async function activateFromInvoice(invoiceId: string): Promise<ActivationResult> {
  const supabase = createAdminClient();

  /**
   * `period_end` is NOT read here, and that is deliberate.
   *
   * The invoice's period is the window it was RAISED for — issue date plus a
   * month. Honouring it would mean a tenant who pays ten days late buys twenty
   * days of service. What is sold is a month from the moment it is paid (or
   * from the current end date, whichever is later), so the entitlement is
   * computed below and the invoice period stays what it is: billing history.
   */
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, restaurant_id, plan_id, amount, status")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice) return { ok: false, reason: "invoiceNotFound", error: "Facture introuvable." };

  // The cheap replay guard. The claim below is the one that actually holds.
  if (invoice.status === "paid") return { ok: true, note: "Cette facture était déjà réglée." };
  if (invoice.status === "void") {
    return { ok: false, reason: "invoiceVoid", error: "Cette facture a été annulée." };
  }

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, end_date")
    .eq("restaurant_id", invoice.restaurant_id)
    .maybeSingle();

  if (!subscription) {
    return { ok: false, reason: "noSubscription", error: "Aucun abonnement pour cet établissement." };
  }

  const paidAt = new Date().toISOString();

  // THE CLAIM. Two concurrent activations both reach here; one gets a row back
  // and grants the month, the other gets nothing and grants nothing.
  const { data: claimed, error: claimError } = await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: paidAt })
    .eq("id", invoiceId)
    .eq("status", "unpaid")
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error("[subscribe:activate] invoice", claimError.message);
    return { ok: false, reason: "invoiceClaimFailed", error: "La facture n'a pas pu être réglée." };
  }
  if (!claimed) return { ok: true, note: "Cette facture était déjà réglée." };

  /**
   * Extend from the LATER of now and the current end date.
   *
   * Paying early must add a month to what is left, not reset it — otherwise a
   * tenant who renews three days ahead loses three days for being organised.
   * Paying late starts from today, so the lapsed days are not silently
   * credited either.
   */
  const from = Math.max(Date.now(), subscription.end_date ? new Date(subscription.end_date).getTime() : 0);
  const endDate = new Date(from + PERIOD_DAYS * 86_400_000).toISOString();

  const { error: subError } = await supabase
    .from("subscriptions")
    .update({ plan_id: invoice.plan_id, end_date: endDate, cancelled_at: null })
    .eq("id", subscription.id);

  if (subError) {
    console.error("[subscribe:activate] subscription", subError.message);
    // Give the claim back, or the invoice reads settled with no month behind
    // it and nothing can ever grant one.
    await supabase
      .from("invoices")
      .update({ status: "unpaid", paid_at: null })
      .eq("id", invoiceId)
      .eq("status", "paid");

    return {
      ok: false,
      reason: "subscriptionExtendFailed",
      error: "Le paiement a abouti mais l'abonnement n'a pas été prolongé.",
    };
  }

  revalidatePath("/m", "layout");
  revalidatePath("/a/subscriptions");
  return { ok: true };
}
