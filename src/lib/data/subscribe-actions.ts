"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import { writeAudit } from "./platform-actions";
import type { ActionResult } from "./admin-actions";

/**
 * Subscribing and paying, from the restaurant's side.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  §6 — ONE IDEMPOTENT ACTIVATION PATH.
 *
 *  `activateFromInvoice()` below is the ONLY function that marks an invoice
 *  paid and moves a subscription's end date. The simulator calls it. When
 *  CamerPay lands, its webhook will call the same function and nothing else
 *  changes.
 *
 *  This is not tidiness. The moment there are two activation paths they
 *  disagree, and the disagreement is money: one path credits a month the
 *  other does not, and the tenant either gets free service or pays twice.
 *
 *  Idempotence lives in the guard at the top of it — an invoice that is
 *  already `paid` returns success WITHOUT extending anything. A provider that
 *  retries its webhook must not buy a second month.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Invoice numbers people can read down a phone line. */
function invoiceNumber(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `INV-${stamp}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

/**
 * Mark an invoice paid and extend the subscription. THE ONLY PATH.
 *
 * Not exported as a Server Action — it is called by the ones below and, later,
 * by the payment webhook. Exporting it would make it a POST endpoint that
 * grants paid service to anyone who can guess an invoice id.
 */
async function activateFromInvoice(invoiceId: string): Promise<ActionResult> {
  const supabase = createAdminClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, restaurant_id, plan_id, amount, status, period_end")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice) return { ok: false, error: "Facture introuvable." };

  // THE IDEMPOTENCE GUARD. A replayed webhook lands here and stops.
  if (invoice.status === "paid") return { ok: true, note: "Cette facture était déjà réglée." };
  if (invoice.status === "void") return { ok: false, error: "Cette facture a été annulée." };

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, end_date")
    .eq("restaurant_id", invoice.restaurant_id)
    .maybeSingle();

  if (!subscription) return { ok: false, error: "Aucun abonnement pour cet établissement." };

  /**
   * Extend from the LATER of now and the current end date.
   *
   * Paying early must add a month to what is left, not reset it — otherwise a
   * tenant who renews three days ahead loses three days for being organised.
   * Paying late starts from today, so the lapsed days are not silently
   * credited either.
   */
  const from = Math.max(Date.now(), subscription.end_date ? new Date(subscription.end_date).getTime() : 0);
  const endDate = new Date(from + 30 * 86_400_000).toISOString();

  const { error: subError } = await supabase
    .from("subscriptions")
    .update({ plan_id: invoice.plan_id, end_date: endDate, cancelled_at: null })
    .eq("id", subscription.id);

  if (subError) {
    console.error("[subscribe:activate] subscription", subError.message);
    return { ok: false, error: "Le paiement a abouti mais l'abonnement n'a pas été prolongé." };
  }

  const { error: invError } = await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", invoiceId)
    // Written as a conditional update, not a blind one: two webhooks arriving
    // at the same instant both read `unpaid`, and only one of them wins here.
    .eq("status", "unpaid");

  if (invError) {
    console.error("[subscribe:activate] invoice", invError.message);
  }

  revalidatePath("/m", "layout");
  revalidatePath("/a/subscriptions");
  return { ok: true };
}

/**
 * Choose a plan.
 *
 * Free plans apply immediately. Paid plans raise an invoice and return its id
 * so the caller can send the tenant to pay — no service is granted until that
 * invoice is settled, which is the whole point of separating the two.
 */
export async function choosePlan(
  planId: string,
): Promise<ActionResult & { invoiceId?: string; amount?: number }> {
  const { active, profile } = await requireCapability("billing.manage");
  const supabase = createAdminClient();

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("id, tier, name, monthly_price, is_active")
    .eq("id", planId)
    .maybeSingle();

  if (!plan || !plan.is_active) return { ok: false, error: "Ce forfait n'est pas disponible." };

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, plan_id")
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!subscription) return { ok: false, error: "Aucun abonnement pour cet établissement." };

  /* ── Free: nothing to pay, apply now ──────────────────────────────────── */
  if (plan.monthly_price === 0) {
    const { error } = await supabase
      .from("subscriptions")
      // end_date null — a free plan with a deadline would lock someone out of
      // something they are not paying for (§5 rule 1).
      .update({ plan_id: plan.id, end_date: null, cancelled_at: null })
      .eq("id", subscription.id);

    if (error) return { ok: false, error: "Le changement de forfait a échoué." };

    await supabase.from("plan_changes").insert({
      restaurant_id: active.restaurantId,
      from_plan_id: subscription.plan_id,
      to_plan_id: plan.id,
      changed_by: profile.email,
    });

    await writeAudit(profile, {
      action: "subscription.downgrade",
      entityType: "subscription",
      entityId: subscription.id,
      summary: `${active.restaurantName} moved to ${plan.name} (free)`,
    });

    revalidatePath("/m", "layout");
    return { ok: true, note: `Vous êtes maintenant sur ${plan.name}.` };
  }

  /* ── Paid: raise an invoice, grant nothing yet ────────────────────────── */

  // Reuse an unpaid invoice for the same plan rather than stacking a new one
  // every time somebody clicks. Otherwise a hesitant tenant accumulates six
  // invoices for one month of service.
  const { data: pending } = await supabase
    .from("invoices")
    .select("id, amount")
    .eq("restaurant_id", active.restaurantId)
    .eq("plan_id", plan.id)
    .eq("status", "unpaid")
    .maybeSingle();

  if (pending) return { ok: true, invoiceId: pending.id, amount: pending.amount };

  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + 30 * 86_400_000);

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      number: invoiceNumber(),
      restaurant_id: active.restaurantId,
      plan_id: plan.id,
      amount: plan.monthly_price,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
    })
    .select("id, amount")
    .single();

  if (error || !invoice) {
    console.error("[subscribe:choosePlan] invoice", error?.message);
    return { ok: false, error: "Impossible de créer la facture." };
  }

  return { ok: true, invoiceId: invoice.id, amount: invoice.amount };
}

/**
 * Start the free trial.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A trial is a subscription with an end date and NO INVOICE. Nothing else.
 *
 *  So the tenant gets the paid plan in full for seven days, then the ordinary
 *  grace window, then Starter limits — using the same machinery that handles a
 *  lapsed paid month. There is no separate "trial expired" path to get wrong,
 *  and no way for a trial to quietly become permanent.
 *
 *  NO CARD, NO PHONE NUMBER, NO AUTO-CHARGE. They pay when they decide to,
 *  from the same screen. A trial that silently starts billing is the thing
 *  people resent, and here there is nothing stored that could.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function startTrial(planId: string): Promise<ActionResult> {
  const { active, profile } = await requireCapability("billing.manage");
  const supabase = createAdminClient();

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("id, name, monthly_price, trial_days, is_active")
    .eq("id", planId)
    .maybeSingle();

  if (!plan || !plan.is_active) return { ok: false, error: "Ce forfait n'est pas disponible." };
  if (!plan.trial_days) return { ok: false, error: "Ce forfait n'a pas d'essai gratuit." };

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, plan_id, trial_used")
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!subscription) return { ok: false, error: "Aucun abonnement pour cet établissement." };

  // One per restaurant, ever. Checked on the server because the button being
  // hidden is not the rule — this is.
  if (subscription.trial_used) {
    return { ok: false, error: "Votre essai gratuit a déjà été utilisé." };
  }

  const endsAt = new Date(Date.now() + plan.trial_days * 86_400_000).toISOString();

  const { error } = await supabase
    .from("subscriptions")
    .update({
      plan_id: plan.id,
      end_date: endsAt,
      trial_ends_at: endsAt,
      trial_used: true,
      cancelled_at: null,
    })
    .eq("id", subscription.id)
    // Belt and braces against a double click: the second update matches
    // nothing, so it cannot restart the clock.
    .eq("trial_used", false);

  if (error) {
    console.error("[subscribe:startTrial]", error.message);
    return { ok: false, error: "Impossible de démarrer l'essai." };
  }

  await supabase.from("plan_changes").insert({
    restaurant_id: active.restaurantId,
    from_plan_id: subscription.plan_id,
    to_plan_id: plan.id,
    changed_by: profile.email,
  });

  await writeAudit(profile, {
    action: "subscription.trial_start",
    entityType: "subscription",
    entityId: subscription.id,
    summary: `${active.restaurantName} started a ${plan.trial_days}-day trial of ${plan.name}`,
  });

  revalidatePath("/m", "layout");
  revalidatePath("/a/subscriptions");

  return {
    ok: true,
    note: `Essai de ${plan.trial_days} jours démarré. Aucun paiement n'est requis avant le ${new Date(endsAt).toLocaleDateString("fr-CM")}.`,
  };
}

/**
 * SIMULATED PAYMENT — stands in for CamerPay until it is live.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  It records a real payment_attempt with provider = 'simulated', then calls
 *  the SAME activation function the webhook will call. So the code path being
 *  exercised now is the code path that will run in production; only the thing
 *  that triggers it changes.
 *
 *  REFUSES TO RUN WHEN PAYMENTS ARE ENABLED. The `payments_enabled` setting
 *  is what says "a real provider is live", and a simulator that still works
 *  after that is a button which grants free subscriptions to anyone who can
 *  reach it. Going live disables this by itself — nobody has to remember.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function simulatePayment(invoiceId: string): Promise<ActionResult> {
  const { active, profile } = await requireCapability("billing.manage");
  const supabase = createAdminClient();

  const { data: enabled } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "payments_enabled")
    .maybeSingle();

  if (enabled?.value === "true") {
    return {
      ok: false,
      error: "Les paiements réels sont activés. La simulation est désactivée.",
    };
  }

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, restaurant_id, amount, status")
    .eq("id", invoiceId)
    // The tenant guard: an invoice id from a URL must belong to THIS branch.
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!invoice) return { ok: false, error: "Facture introuvable." };
  if (invoice.status === "paid") return { ok: true, note: "Cette facture était déjà réglée." };

  await supabase.from("payment_attempts").insert({
    reference: `SIM-${randomUUID().slice(0, 8).toUpperCase()}`,
    invoice_id: invoice.id,
    restaurant_id: active.restaurantId,
    provider: "simulated",
    transaction_id: `sim_${randomUUID()}`,
    method: "simulation",
    amount: invoice.amount,
    status: "succeeded",
    settled_at: new Date().toISOString(),
    raw_response: { simulated: true, by: profile.email },
  });

  const result = await activateFromInvoice(invoice.id);

  await writeAudit(profile, {
    action: "payment.simulated",
    entityType: "invoice",
    entityId: invoice.id,
    summary: `Simulated payment of ${invoice.amount} XAF for ${active.restaurantName}`,
  });

  return result.ok
    ? { ok: true, note: "Paiement simulé. Abonnement actif pour 30 jours." }
    : result;
}
