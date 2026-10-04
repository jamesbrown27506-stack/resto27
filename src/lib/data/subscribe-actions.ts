"use server";

import { revalidatePath } from "next/cache";
import { getLocale, getTranslator } from "@/lib/i18n/locale-server";
import { paymentErrorMessage } from "@/lib/payments/payment-error";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import { writeAudit } from "./platform-actions";
import { notify } from "@/lib/notify";
import { getFreeModeWindow } from "./billing";
import { ensureUnpaidInvoice } from "./invoice-issue";
import { quotePlanMonth, refreshBranchInvoices, syncBranchCoverage } from "@/lib/branches/account";
import type { ActionResult } from "./admin-actions";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";
import {
  checkPaymentAttempt,
  initiatePaymentAttempt,
  settlePayment,
} from "@/lib/payments/collect";

/**
 * Subscribing and paying, from the restaurant's side.
 *
 * The entitlement change — marking an invoice paid and moving the
 * subscription's end date — lives in `activateFromInvoice` (lib/data/
 * invoice-activation.ts), THE single idempotent activation path (§6).
 * Payments are settled through the platform: the manager pays by Mobile
 * Money on the pay page (`payInvoice` / `checkInvoicePayment`), and when
 * CamerPay lands, its webhook calls the same settlement and nothing else
 * changes. In sandbox mode no money moves and the attempt is already
 * succeeded the moment it is created.
 *
 * Every failure carries a `reason` — a stable machine code a later lane maps
 * to a dictionary key — alongside the French fallback string, the same
 * convention as checkout-actions.ts and payments/collect.ts.
 */

/** ActionResult plus the stable failure code. */
export type SubscribeResult =
  | { ok: true; note?: string }
  | { ok: false; error: string; reason?: string };

/** The later of two end dates — null means "no date", not "the epoch". */
function laterDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
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
): Promise<SubscribeResult & { invoiceId?: string; amount?: number }> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("billing.manage");
  const supabase = createAdminClient();

  // A branch runs on its main restaurant's plan (0072) and has none to change.
  if (active.parentId) {
    return { ok: false, reason: "branchBilling", error: t("est.branchBilledByMain") };
  }

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();

  if (!plan || !plan.is_active) {
    return { ok: false, reason: "planUnavailable", error: t("est.planUnavailable") };
  }

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, plan_id, end_date")
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  /*
    The month this plan would bill, branches included: every open branch
    beyond what the plan includes, at the plan's own price per branch. On a
    plan that sells no branches (Starter) the quote is the plan alone — the
    branches are paused, not charged.
  */
  const terms = {
    monthlyPrice: Number(plan.monthly_price ?? 0),
    includedBranches: Number(plan.included_branches ?? 1),
    extraBranchPrice:
      plan.extra_branch_price === null || plan.extra_branch_price === undefined ? null : Number(plan.extra_branch_price),
  };
  const quote = await quotePlanMonth(active.restaurantId, terms);

  if (!subscription) {
    return {
      ok: false,
      reason: "noSubscription",
      error: t("est.noSubscription"),
    };
  }

  /*
   * FREE MODE (migration 0030): the platform is free for everyone, so a paid
   * plan must not raise an invoice — the restaurant switches to it RIGHT NOW,
   * exactly as if it cost 0 FCFA. The invoice is what separates "chosen" from
   * "granted"; while free mode is on the two are the same by definition, and
   * "restaurants can switch plans as they want" is the whole point of the
   * flag.
   */
  const freeMode = await getFreeModeWindow();

  /* ── Free (or everything is free): nothing to pay, apply now ──────────── */
  if (freeMode.effective || plan.monthly_price === 0) {
    /**
     * FREE MODE IS NOT "FREE FOREVER", AND THIS LINE IS WHERE THAT IS DECIDED.
     *
     * A null end_date means NEVER EXPIRES everywhere else in the system (§5
     * rule 1) — right for a plan that costs 0, catastrophic for a paid tier
     * handed out during a giveaway: the tenant would keep Professional for
     * nothing long after the platform stopped being free, and no other code
     * path would ever ask them to pay.
     *
     * So a paid plan chosen during free mode expires WHEN FREE MODE DOES, and
     * never earlier than a month the tenant has already bought. When free mode
     * has no countdown at all there is no honest date to write; the date is
     * stamped instead by `runSubscriptionExpiry` the moment free mode lifts,
     * which is the only point at which it becomes knowable.
     */
    const endDate =
      plan.monthly_price === 0 ? null : laterDate(subscription.end_date, freeMode.endsAt);

    /*
      While the platform is free its extra branches are free too: the plan
      covers every open one from now on. The renewal that follows free mode
      bills them like any other month. Outside free mode (a 0-FCFA plan) the
      paid extras are left as they are — they mean nothing on a plan that
      sells none, and are reset by the next paid month anyway.
    */
    const patch: Record<string, unknown> = { plan_id: plan.id, end_date: endDate, cancelled_at: null };
    if (freeMode.effective && quote.extraBranches > 0) patch.extra_branches = quote.extraBranches;

    const { error } = await supabase.from("subscriptions").update(patch).eq("id", subscription.id);

    if (error) {
      console.error("[subscribe:choosePlan] plan change", error.message);
      return {
        ok: false,
        reason: "planChangeFailed",
        error: t("est.planChangeFailed"),
      };
    }

    await supabase.from("plan_changes").insert({
      restaurant_id: active.restaurantId,
      from_plan_id: subscription.plan_id,
      to_plan_id: plan.id,
      changed_by: profile.email,
    });

    await writeAudit(profile, {
      action: "subscription.plan_change",
      entityType: "subscription",
      entityId: subscription.id,
      summary: freeMode.effective
        ? `${active.restaurantName} moved to ${plan.name} (free mode, until ${freeMode.endsAt ?? "free mode ends"})`
        : `${active.restaurantName} moved to ${plan.name} (free)`,
    });

    await notify({
      event: "billing",
      tone: "info",
      restaurantId: active.restaurantId,
      href: "/m/billing",
      params: { detail: `Vous êtes maintenant sur le forfait ${plan.name}.` },
    });
    await notify({
      event: "new_subscription",
      admins: true,
      href: "/a/subscriptions",
      params: { restaurantName: active.restaurantName, planName: plan.name },
    });

    // Downgrading to Starter pauses every branch; upgrading resumes them.
    await syncBranchCoverage(active.restaurantId);
    await refreshBranchInvoices(active.restaurantId);

    revalidatePath("/m", "layout");
    return { ok: true, note: t("est.nowOnPlan", { plan: plan.name }) };
  }

  /* ── Paid: raise an invoice, grant nothing yet ────────────────────────── */

  /**
   * One unpaid invoice per tenant per plan — the renewal sweep and this button
   * share the same helper, so a tenant whose renewal invoice was already raised
   * overnight is sent to THAT one rather than to a second copy of it.
   */
  const invoice = await ensureUnpaidInvoice({
    restaurantId: active.restaurantId,
    planId: plan.id,
    amount: quote.amount,
    // A renewal is billed from where the current month ends; a new plan from now.
    from:
      subscription.end_date && Date.parse(subscription.end_date) > Date.now()
        ? new Date(subscription.end_date)
        : undefined,
    branches: { extraBranches: quote.extraBranches, branchAmount: quote.branchAmount },
  });

  if (!invoice) {
    return { ok: false, reason: "invoiceFailed", error: t("est.invoiceCreateFailed") };
  }

  if (!invoice.created) return { ok: true, invoiceId: invoice.id, amount: invoice.amount };

  // The tenant is told the invoice is waiting — the single most missed step
  // in paid onboarding is "you have to go pay now".
  await notify({
    event: "billing",
    tone: "info",
    restaurantId: active.restaurantId,
    href: "/m/billing",
    params: { detail: `Facture ${plan.name} (${invoice.amount} FCFA) à régler.` },
  });

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
export async function startTrial(planId: string): Promise<SubscribeResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("billing.manage");
  const supabase = createAdminClient();

  if (active.parentId) {
    return { ok: false, reason: "branchBilling", error: t("est.branchBilledByMain") };
  }

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("id, name, monthly_price, trial_days, is_active")
    .eq("id", planId)
    .maybeSingle();

  if (!plan || !plan.is_active) {
    return { ok: false, reason: "planUnavailable", error: t("est.planUnavailable") };
  }
  if (!plan.trial_days) {
    return { ok: false, reason: "noTrialOnPlan", error: t("est.noTrial") };
  }

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, plan_id, trial_used")
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!subscription) {
    return {
      ok: false,
      reason: "noSubscription",
      error: t("est.noSubscription"),
    };
  }

  // One per restaurant, ever. Checked on the server because the button being
  // hidden is not the rule — this is.
  if (subscription.trial_used) {
    return { ok: false, reason: "trialUsed", error: t("est.trialUsed") };
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
    return { ok: false, reason: "trialStartFailed", error: t("est.trialStartFailed") };
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

  await notify({
    event: "billing",
    tone: "success",
    restaurantId: active.restaurantId,
    href: "/m/billing",
    params: { detail: `Essai gratuit de ${plan.trial_days} jours sur ${plan.name}.` },
  });
  await notify({
    event: "new_subscription",
    admins: true,
    href: "/a/subscriptions",
    params: { restaurantName: active.restaurantName, planName: plan.name },
  });

  // An Enterprise trial includes its branches like a paid month does.
  await syncBranchCoverage(active.restaurantId);

  revalidatePath("/m", "layout");
  revalidatePath("/a/subscriptions");

  return {
    ok: true,
    note: t("est.trialStarted", {
      days: plan.trial_days,
      date: new Date(endsAt).toLocaleDateString((await getLocale()) === "en" ? "en-GB" : "fr-CM"),
    }),
  };
}

/**
 * Pay an invoice by Mobile Money.
 *
 * In sandbox mode the attempt succeeds instantly and the subscription is
 * activated right here. In live mode CamerPay pushes a request to the
 * manager's handset, the attempt comes back `pending`, and the caller polls
 * `checkInvoicePayment` until the provider (or its webhook) confirms.
 */
export async function payInvoice(input: {
  invoiceId: string;
  phone: string;
}): Promise<ActionResult & {
  status?: "succeeded" | "pending" | "failed";
  attemptId?: string;
  /** Orange: the code the payer must dial themselves (see PaymentPendingView). */
  instruction?: PaymentInstruction;
}> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("billing.manage");
  const supabase = createAdminClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, number, amount, status")
    .eq("id", input.invoiceId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!invoice) return { ok: false, error: t("est.invoiceNotFound") };
  if (invoice.status !== "unpaid") return { ok: false, error: t("est.invoiceNotPending") };

  // Resume the Mobile Money request already on the handset. A double tap,
  // reload or return from another screen must never create a second charge.
  // Untracked pending rows are transport failures and may be retried; scan a
  // few recent rows so one of those cannot hide an older trackable request.
  const { data: openAttempts, error: openAttemptsError } = await supabase
    .from("payment_attempts")
    .select("id, status, transaction_id")
    .eq("invoice_id", invoice.id)
    .eq("restaurant_id", active.restaurantId)
    .in("status", ["pending", "succeeded"])
    .is("settled_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  if (openAttemptsError) {
    console.error("[subscribe:payInvoice] open attempt", openAttemptsError.message);
    return {
      ok: false,
      error: t("ecu.paymentCheckRetry"),
    };
  }

  const openAttempt = (openAttempts ?? []).find(
    (attempt) => attempt.status === "succeeded" || Boolean(attempt.transaction_id),
  );
  if (openAttempt?.status === "succeeded") {
    const settled = await settlePayment(openAttempt.id);
    if (!settled.ok) {
      return { ok: false, error: paymentErrorMessage(settled, t, "ecu.paymentNotApplied") };
    }
    revalidatePath("/m", "layout");
    revalidatePath("/a/subscriptions");
    return { ok: true, status: "succeeded" };
  }
  if (openAttempt?.status === "pending" && openAttempt.transaction_id) {
    return { ok: true, status: "pending", attemptId: openAttempt.id };
  }

  const initiated = await initiatePaymentAttempt({
    kind: "subscription",
    restaurantId: active.restaurantId,
    invoiceId: invoice.id,
    reference: invoice.number,
    phone: input.phone,
    amount: invoice.amount,
    returnPath: "/m/billing",
  });

  if (!initiated.ok || !initiated.attemptId) {
    return { ok: false, error: paymentErrorMessage(initiated, t, "ecu.paymentFailed") };
  }

  if (initiated.status === "pending") {
    return { ok: true, status: "pending", attemptId: initiated.attemptId, instruction: initiated.instruction };
  }

  // Sandbox: the attempt is already 'succeeded' — settle it and tell everyone.
  const settled = await settlePayment(initiated.attemptId);
  if (!settled.ok) {
    console.error("[subscribe:payInvoice] settle", settled.error);
    return { ok: false, error: paymentErrorMessage(settled, t, "ecu.paymentNotApplied") };
  }

  await writeAudit(profile, {
    action: "invoice.paid",
    entityType: "invoice",
    entityId: invoice.id,
    summary: `${active.restaurantName} paid invoice ${invoice.number} (${invoice.amount.toLocaleString("fr-CM")} FCFA)`,
  });

  await notify({
    event: "billing_paid",
    tone: "success",
    restaurantId: active.restaurantId,
    href: "/m/billing",
    params: { invoiceNumber: invoice.number, amount: invoice.amount },
  });
  await notify({
    event: "billing",
    tone: "success",
    admins: true,
    href: "/a/subscriptions",
    params: { restaurantName: active.restaurantName, detail: `Facture ${invoice.number} réglée.` },
  });

  revalidatePath("/m", "layout");
  revalidatePath("/a/subscriptions");
  return { ok: true, status: "succeeded" };
}

/**
 * Poll a pending invoice payment.
 *
 * Re-checks with the provider (or reads the outcome its webhook already
 * settled) and returns where the payment stands. Scoped to the manager's own
 * restaurant — an attempt id alone must not let a tenant watch somebody
 * else's money move.
 */
export async function checkInvoicePayment(
  attemptId: string,
): Promise<ActionResult & { status?: "succeeded" | "pending" | "failed"; instruction?: PaymentInstruction }> {
  const t = await getTranslator();
  const { active } = await requireCapability("billing.manage");
  const result = await checkPaymentAttempt(attemptId, active.restaurantId);

  if (!result.ok) return { ok: false, error: paymentErrorMessage(result, t, "ecu.paymentNotFound") };

  if (result.status === "succeeded") {
    revalidatePath("/m", "layout");
    revalidatePath("/a/subscriptions");
  }

  return { ok: true, status: result.status, instruction: result.instruction };
}

