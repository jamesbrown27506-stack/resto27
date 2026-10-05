import "server-only";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { isMissingColumn } from "./missing-column";
import { refreshBranchInvoices, syncBranchCoverage } from "@/lib/branches/account";

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

export async function activateFromInvoice(
  invoiceId: string,
  /**
   * What the payment that settles it actually moved. Omitted only by an
   * admin confirming by hand. See "THE AMOUNT PAID IS THE AMOUNT BILLED".
   */
  options: { paidAmount?: number } = {},
): Promise<ActivationResult> {
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
  // `*` so the branch columns (0072) come back when they exist and their
  // absence reads as an ordinary plan invoice when they do not.
  const { data: invoiceRow } = await supabase.from("invoices").select("*").eq("id", invoiceId).maybeSingle();

  if (!invoiceRow) return { ok: false, reason: "invoiceNotFound", error: "Facture introuvable." };

  const invoice = invoiceRow as {
    id: string;
    restaurant_id: string;
    plan_id: string | null;
    amount: number;
    status: string;
    kind?: string;
    extra_branches?: number;
  };
  const isBranchTopUp = invoice.kind === "branches";
  const extraBranches = Math.max(0, Number(invoice.extra_branches ?? 0));

  // The cheap replay guard. The claim below is the one that actually holds.
  if (invoice.status === "paid") return { ok: true, note: "Cette facture était déjà réglée." };
  if (invoice.status === "void") {
    return { ok: false, reason: "invoiceVoid", error: "Cette facture a été annulée." };
  }

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("restaurant_id", invoice.restaurant_id)
    .maybeSingle();

  if (!subscription) {
    return { ok: false, reason: "noSubscription", error: "Aucun abonnement pour cet établissement." };
  }

  /*
    ─────────────────────────────────────────────────────────────────────────
     THE AMOUNT PAID IS THE AMOUNT BILLED (security review 2026-10-05).

     An unpaid invoice is re-priced when branches open or close (0072), and
     activation used to honour the invoice as it stood when the money
     landed. Start paying the base price, let that attempt lapse, reopen
     branches (the invoice grows), then complete the old Orange code: the
     cheap payment settled the dear invoice — N branches for the price of
     none. The claim now includes the amount the payment moved; a mismatch
     activates nothing and the caller hands the payment to an admin.
    ─────────────────────────────────────────────────────────────────────────
  */
  if (options.paidAmount !== undefined && Number(invoice.amount) !== Number(options.paidAmount)) {
    return {
      ok: false,
      reason: "invoiceRepriced",
      error: "Le montant payé ne correspond plus à la facture. Notre équipe va régulariser.",
    };
  }

  const paidAt = new Date().toISOString();

  // THE CLAIM. Two concurrent activations both reach here; one gets a row back
  // and grants the month, the other gets nothing and grants nothing. It also
  // pins the amount read above, so a re-price in between wins nothing.
  let claim = supabase
    .from("invoices")
    .update({ status: "paid", paid_at: paidAt })
    .eq("id", invoiceId)
    .eq("status", "unpaid");
  if (options.paidAmount !== undefined) claim = claim.eq("amount", options.paidAmount);
  const { data: claimed, error: claimError } = await claim.select("id").maybeSingle();

  if (claimError) {
    console.error("[subscribe:activate] invoice", claimError.message);
    return { ok: false, reason: "invoiceClaimFailed", error: "La facture n'a pas pu être réglée." };
  }
  if (!claimed) {
    // Lost the claim: settled by a racing path — or re-priced in between.
    const { data: now } = await supabase.from("invoices").select("status, amount").eq("id", invoiceId).maybeSingle();
    if (now?.status === "unpaid" && options.paidAmount !== undefined && Number(now.amount) !== Number(options.paidAmount)) {
      return {
        ok: false,
        reason: "invoiceRepriced",
        error: "Le montant payé ne correspond plus à la facture. Notre équipe va régulariser.",
      };
    }
    return { ok: true, note: "Cette facture était déjà réglée." };
  }

  /**
   * A BRANCH TOP-UP BUYS BRANCHES, NOT TIME (0072).
   *
   * It paid for extra branches until the CURRENT end date, so the end date
   * does not move. `extra_branches` on the invoice is the total it was
   * raised for, and the subscription takes the larger of that and what it
   * already had — a renewal paid in between may have counted them already,
   * and paying twice for one branch must not count it twice.
   */
  if (isBranchTopUp) {
    const current = Math.max(0, Number((subscription as { extra_branches?: number }).extra_branches ?? 0));
    const { error: topUpError } = await supabase
      .from("subscriptions")
      .update({ extra_branches: Math.max(current, extraBranches) })
      .eq("id", subscription.id);

    if (topUpError) {
      console.error("[subscribe:activate] branch top-up", topUpError.message);
      await supabase
        .from("invoices")
        .update({ status: "unpaid", paid_at: null })
        .eq("id", invoiceId)
        .eq("status", "paid");
      return {
        ok: false,
        reason: "subscriptionExtendFailed",
        error: "Le paiement a abouti mais les succursales n'ont pas été activées.",
      };
    }

    await syncBranchCoverage(invoice.restaurant_id);
    revalidatePath("/m", "layout");
    revalidatePath("/a/subscriptions");
    return { ok: true };
  }

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

  /*
    The month bought also sets how many extra branches are paid for: the
    count this invoice billed (0072). Before 0072 there is no column, and the
    update is retried without it — a plan month must never fail over the
    branches nobody can have yet.
  */
  const patch = { plan_id: invoice.plan_id, end_date: endDate, cancelled_at: null };
  let { error: subError } = await supabase
    .from("subscriptions")
    .update({ ...patch, extra_branches: extraBranches })
    .eq("id", subscription.id);

  if (subError && isMissingColumn(subError, "extra_branches")) {
    ({ error: subError } = await supabase.from("subscriptions").update(patch).eq("id", subscription.id));
  }

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

  // The month may have changed the plan or the paid extras: branches start
  // or stop accordingly, and a top-up this month now covers is retired.
  await syncBranchCoverage(invoice.restaurant_id);
  await refreshBranchInvoices(invoice.restaurant_id);

  revalidatePath("/m", "layout");
  revalidatePath("/a/subscriptions");
  return { ok: true };
}
