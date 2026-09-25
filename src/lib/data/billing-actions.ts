"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireRole, superAdminOrError } from "@/lib/auth/session";
import { SUPER_ADMIN_ONLY_ERROR } from "@/lib/auth/super-admin-rules";
import { writeAudit } from "./platform-actions";
import { notify } from "@/lib/notify";
import { activateFromInvoice } from "./invoice-activation";
import { cancelPaidOrder } from "@/lib/payments/order-refunds";
import { startRefundPayout } from "@/lib/payments/refund-payouts";
import { releaseOrderHoldings } from "@/lib/orders/cancellation-effects";
import type { ActionResult } from "./admin-actions";

/**
 * Billing mutations.
 *
 * Every one re-checks the admin role — a Server Action is a POST endpoint with
 * a generated URL and never passes through the layout that guards the page.
 * These move money, so that matters more here than anywhere else.
 */

/** Short human-readable reference, e.g. RF-8F2K91. */
function makeReference(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/* ── Plans ─────────────────────────────────────────────────────────────── */

export interface PlanInput {
  monthlyPrice: number;
  commissionRate: number;
  menuItemLimit: number | null;
  tableLimit: number | null;
  promotionLimit: number | null;
  includedBranches: number;
  staffLimit: number;
  scheduledPayouts: boolean;
  prioritySupport: boolean;
  staffManagement: boolean;
  analytics: boolean;
  isActive: boolean;
  isFeatured: boolean;
}

export async function updatePlan(planId: string, input: PlanInput): Promise<ActionResult> {
  // Prices and commission rates are what every tenant pays — super admins only.
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  const admin = gate.admin;

  if (input.monthlyPrice < 0) return { ok: false, error: "Price cannot be negative." };
  if (!Number.isInteger(input.includedBranches) || input.includedBranches < 1) {
    return { ok: false, error: "A plan must include at least one branch." };
  }
  if (!Number.isInteger(input.staffLimit) || input.staffLimit < 0) {
    return { ok: false, error: "Staff limit cannot be negative." };
  }
  if (input.commissionRate < 0 || input.commissionRate > 100) {
    return { ok: false, error: "Commission must be between 0 and 100 %." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("subscription_plans")
    .update({
      monthly_price: Math.round(input.monthlyPrice),
      commission_rate: input.commissionRate,
      menu_item_limit: input.menuItemLimit,
      table_limit: input.tableLimit,
      promotion_limit: input.promotionLimit,
      included_branches: input.includedBranches,
      staff_limit: input.staffLimit,
      scheduled_payouts: input.scheduledPayouts,
      priority_support: input.prioritySupport,
      staff_management: input.staffManagement,
      analytics: input.analytics,
      is_active: input.isActive,
      is_featured: input.isFeatured,
    })
    .eq("id", planId);

  if (error) {
    console.error("[billing:updatePlan]", planId, error.message);
    return { ok: false, error: "Could not save the plan." };
  }

  await writeAudit(admin, {
    action: "plan.update",
    entityType: "subscription_plan",
    entityId: planId,
    summary: `Price ${input.monthlyPrice} XAF, commission ${input.commissionRate}%`,
    metadata: { ...input },
  });

  /**
   * Both surfaces revalidate.
   *
   * The public /pricing page renders from this same table (§14.5), which is
   * the whole point: advertised limits must equal enforced limits. Changing a
   * plan here and leaving the marketing page cached would recreate exactly the
   * bug that split them apart in the PHP build.
   */
  revalidatePath("/a/plans");
  revalidatePath("/pricing");
  revalidatePath("/");
  return { ok: true };
}

/* ── Subscriptions ─────────────────────────────────────────────────────── */

/**
 * The subscription for a restaurant, CREATING a free Starter row if there is
 * none.
 *
 * Every admin billing action used to key off a subscription id, which meant
 * none of them could touch a restaurant that had no subscription — the exact
 * tenant most likely to need attention. Resolving by restaurant and creating
 * the missing row makes "this tenant is not in the billing system" a state
 * that fixes itself the first time someone acts on it.
 *
 * Starter costs 0 and never expires, so creating it commits the tenant to
 * nothing.
 */
async function ensureSubscription(
  restaurantId: string,
): Promise<{ id: string; end_date: string | null; plan_id: string } | null> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id, end_date, plan_id")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (existing) return existing;

  const { data: starter } = await supabase
    .from("subscription_plans")
    .select("id")
    .eq("tier", "starter")
    .maybeSingle();

  if (!starter) {
    console.error("[billing:ensureSubscription] no 'starter' plan — run 0004.");
    return null;
  }

  const { data: created, error } = await supabase
    .from("subscriptions")
    .insert({ restaurant_id: restaurantId, plan_id: starter.id, end_date: null })
    .select("id, end_date, plan_id")
    .single();

  if (error) {
    console.error("[billing:ensureSubscription]", restaurantId, error.message);
    return null;
  }

  return created;
}

export async function extendSubscription(
  restaurantId: string,
  days: number,
): Promise<ActionResult> {
  // Extending is paid service handed out for free — super admins only.
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  const admin = gate.admin;

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return { ok: false, error: "Choose between 1 and 365 days." };
  }

  const supabase = createAdminClient();

  const current = await ensureSubscription(restaurantId);
  if (!current) return { ok: false, error: "Subscription not found." };

  const subscriptionId = current.id;

  /**
   * Extend from the later of "now" and the current end date.
   *
   * Extending from today would silently shorten a subscription that still has
   * time on it; extending from a long-past end date would leave a locked
   * tenant still locked. Taking the max handles both.
   *
   * A null end_date means "never expires" (§5 rule 1) — extending it would
   * replace infinity with a date, which is a downgrade. Refused.
   */
  if (current.end_date === null) {
    return {
      ok: false,
      error:
        "This plan never expires, so there is nothing to extend — the tenant already has unlimited time. Move them to a paid plan first if you want a billing date.",
    };
  }

  const from = Math.max(Date.now(), new Date(current.end_date).getTime());
  const endDate = new Date(from + days * 86_400_000).toISOString();

  const { error } = await supabase
    .from("subscriptions")
    .update({ end_date: endDate, cancelled_at: null })
    .eq("id", subscriptionId);

  if (error) {
    console.error("[billing:extendSubscription]", subscriptionId, error.message);
    return { ok: false, error: "Could not extend the subscription." };
  }

  /*
    THE EXTENSION REPLACES THE RENEWAL INVOICE.

    When a subscription reaches its end date the lifecycle raises a renewal
    invoice for the same plan. Extending by hand used to move the date but
    leave that invoice "unpaid" — so the restaurant kept seeing an overdue
    bill for a period the platform had just given them for free, with dates
    already in the past. Unpaid invoices for the CURRENT plan starting before
    the new end date are voided; an invoice for a different plan (an upgrade
    the restaurant asked for) is left alone.
  */
  const { data: voided, error: voidError } = await supabase
    .from("invoices")
    .update({ status: "void" })
    .eq("restaurant_id", restaurantId)
    .eq("status", "unpaid")
    .eq("plan_id", current.plan_id)
    .lt("period_start", endDate)
    .select("number");
  if (voidError) console.error("[billing:extendSubscription] void invoices", voidError.message);

  await writeAudit(admin, {
    action: "subscription.extend",
    entityType: "subscription",
    entityId: subscriptionId,
    summary: `Extended by ${days} days to ${endDate}${
      voided && voided.length > 0 ? ` — voided ${voided.map((v) => v.number).join(", ")}` : ""
    }`,
  });

  await notify({
    event: "billing",
    tone: "success",
    restaurantId,
    href: "/m/billing",
    params: { detail: `Abonnement prolongé de ${days} jours.` },
  });

  revalidatePath("/a/subscriptions");
  revalidatePath("/a/restaurants");
  revalidatePath("/m/billing");
  revalidatePath("/m", "layout");
  return { ok: true };
}

export async function changeSubscriptionPlan(
  restaurantId: string,
  planId: string,
): Promise<ActionResult> {
  // Moving a tenant onto a paid tier without an invoice is free service —
  // super admins only.
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  const admin = gate.admin;

  const supabase = createAdminClient();

  const current = await ensureSubscription(restaurantId);
  if (!current) return { ok: false, error: "Subscription not found." };

  const { data: target } = await supabase
    .from("subscription_plans")
    .select("name, monthly_price")
    .eq("id", planId)
    .maybeSingle();

  if (!target) return { ok: false, error: "No such plan." };

  /**
   * MOVING ONTO A PAID PLAN GIVES IT A BILLING DATE.
   *
   * Starter never expires, so its end_date is null. Copying that null onto
   * Professional would hand out a paid tier that never comes up for renewal —
   * revenue that leaks silently, which is the exact failure the
   * subscription_state view exists to prevent (§5).
   *
   * Thirty days from now, so the first invoice lands where the tenant expects
   * it. Moving back DOWN to a free plan clears the date again: a free plan
   * with a deadline would lock someone out of something they are not paying
   * for.
   */
  const paid = (target.monthly_price ?? 0) > 0;
  const patch: Record<string, unknown> = { plan_id: planId, cancelled_at: null };

  if (paid && current.end_date === null) {
    patch.end_date = new Date(Date.now() + 30 * 86_400_000).toISOString();
  } else if (!paid) {
    patch.end_date = null;
  }

  const { error } = await supabase.from("subscriptions").update(patch).eq("id", current.id);

  if (error) {
    console.error("[billing:changeSubscriptionPlan]", restaurantId, error.message);
    return { ok: false, error: "Could not change the plan." };
  }

  // The upgrade/downgrade trail. Without it there is no way to answer "when
  // did this tenant move to Enterprise, and who moved them".
  await supabase.from("plan_changes").insert({
    restaurant_id: restaurantId,
    from_plan_id: current.plan_id,
    to_plan_id: planId,
    changed_by: admin.email,
  });

  await writeAudit(admin, {
    action: "subscription.plan_change",
    entityType: "subscription",
    entityId: current.id,
    summary: `Plan changed to ${target.name}`,
    metadata: { from: current.plan_id, to: planId },
  });

  await notify({
    event: "billing",
    tone: "info",
    restaurantId,
    href: "/m/billing",
    params: { detail: `Plan ${target.name} — échéance fixée à 30 jours.` },
  });

  revalidatePath("/a/subscriptions");
  revalidatePath("/a/restaurants");
  revalidatePath("/m", "layout");

  return patch.end_date
    ? { ok: true, note: `Moved to ${target.name}. Renewal set 30 days from today.` }
    : { ok: true };
}

/* ── Payments ──────────────────────────────────────────────────────────── */

/**
 * Manually confirm a payment.
 *
 * §6: `billing_confirm_payment()` is the SINGLE IDEMPOTENT ACTIVATION PATH.
 * The webhook calls it, the reconciler calls it, and this calls it. The moment
 * there are two paths they disagree, and the disagreement is money.
 *
 * Two guards below are that rule made real: the attempt must still be pending
 * (so confirming twice does nothing the second time), and the amount must
 * match the invoice (a provider saying "paid" does not prove it settles the
 * invoice you think it does).
 */
export async function confirmPaymentAttempt(attemptId: string): Promise<ActionResult> {
  // Declaring money received that no gateway confirmed — super admins only.
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  const admin = gate.admin;
  const supabase = createAdminClient();

  const { data: attempt, error: readError } = await supabase
    .from("payment_attempts")
    .select("id, invoice_id, amount, status, provider, method")
    .eq("id", attemptId)
    .maybeSingle();

  if (readError || !attempt) return { ok: false, error: "Payment attempt not found." };

  // Idempotency. Already-settled attempts are a no-op, not an error.
  if (attempt.status === "succeeded") return { ok: true };
  if (attempt.status !== "pending") {
    return { ok: false, error: `This attempt is ${attempt.status} and cannot be confirmed.` };
  }

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, number, amount, status, restaurant_id")
    .eq("id", attempt.invoice_id)
    .maybeSingle();

  if (!invoice) return { ok: false, error: "The linked invoice no longer exists." };

  // §6 rule 5 — re-check the amount.
  if (invoice.amount !== attempt.amount) {
    return {
      ok: false,
      error: `Amount mismatch: the attempt is ${attempt.amount} FCFA but the invoice is ${invoice.amount} FCFA. Not confirmed.`,
    };
  }

  const now = new Date().toISOString();

  const { error: attemptError } = await supabase
    .from("payment_attempts")
    .update({ status: "succeeded", settled_at: now })
    .eq("id", attemptId)
    // Conditional update: if another path settled it between our read and this
    // write, the row no longer matches and we do not double-credit.
    .eq("status", "pending");

  if (attemptError) {
    console.error("[billing:confirmPaymentAttempt]", attemptId, attemptError.message);
    return { ok: false, error: "Could not confirm the payment." };
  }

  await supabase.from("payments").insert({
    attempt_id: attemptId,
    invoice_id: invoice.id,
    amount: attempt.amount,
    method: attempt.method,
    provider: attempt.provider,
    confirmed_by: admin.email,
  });

  await writeAudit(admin, {
    action: "payment.confirm_manual",
    entityType: "payment_attempt",
    entityId: attemptId,
    summary: `Confirmed ${attempt.amount} XAF against invoice ${invoice.id}`,
  });

  /**
   * §6 — THE ONLY ACTIVATION PATH. Marking the invoice paid and moving the
   * subscription's end date happens HERE, in `activateFromInvoice` — the same
   * function the CamerPay webhook will call. Updating the invoice directly in
   * this function would be a second activation path; the two would disagree
   * (this one credits no month), and the disagreement is money.
   */
  const activation = await activateFromInvoice(invoice.id);
  if (!activation.ok) return activation;

  // A settled invoice is the one billing alert a tenant genuinely cares about.
  await notify({
    event: "billing_paid",
    tone: "success",
    restaurantId: invoice.restaurant_id,
    href: "/m/billing",
    params: { invoiceNumber: invoice.number, amount: invoice.amount },
  });

  revalidatePath("/a/payments");
  revalidatePath("/a/subscriptions");
  return { ok: true };
}

/* ── Commissions ───────────────────────────────────────────────────────── */

export async function setCommissionStatus(
  statementId: string,
  status: "issued" | "settled" | "written_off",
): Promise<ActionResult> {
  const admin = await requireRole("admin");

  // Issuing a statement only tells the tenant what they owe — any admin.
  // Marking it SETTLED (money received) or WRITTEN OFF (money forgiven)
  // changes what the platform is owed, so that takes a super admin.
  if (status !== "issued" && !admin.isSuperAdmin) return { ok: false, error: SUPER_ADMIN_ONLY_ERROR };
  const supabase = createAdminClient();

  const { data: statement } = await supabase
    .from("commission_statements")
    .select("restaurant_id, commission_amount")
    .eq("id", statementId)
    .maybeSingle();

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status };
  if (status === "issued") patch.issued_at = now;
  if (status === "settled") patch.settled_at = now;

  const { error } = await supabase
    .from("commission_statements")
    .update(patch)
    .eq("id", statementId);

  if (error) {
    console.error("[billing:setCommissionStatus]", statementId, error.message);
    return { ok: false, error: "Could not update the statement." };
  }

  await writeAudit(admin, {
    action: `commission.${status}`,
    entityType: "commission_statement",
    entityId: statementId,
  });

  // Issuing is the moment the tenant needs to know — a statement they never
  // look at is a statement that silently accrues.
  if (status === "issued" && statement?.restaurant_id) {
    await notify({
      event: "billing",
      tone: "info",
      restaurantId: statement.restaurant_id,
      href: "/m/billing",
      params: {
        detail: `Votre relevé de commissions (${statement.commission_amount} FCFA) est disponible.`,
      },
    });
  }

  revalidatePath("/a/commissions");
  return { ok: true };
}

/**
 * Generate commission statements for a period.
 *
 * §7, the two rules that decide every figure:
 *   · Only DELIVERED, NON-REFUNDED orders count.
 *   · DELIVERY FEES ARE EXCLUDED — that money is the restaurant's cost.
 *
 * And §12 rule 4: the rate is SNAPSHOTTED onto the statement. Changing a plan
 * rate next month must not rewrite this month's figures.
 *
 * Regeneration touches DRAFTS ONLY. Silently rewriting an issued statement is
 * how you lose a tenant's trust permanently.
 */
export async function generateCommissions(
  periodStart: string,
  periodEnd: string,
): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const supabase = createAdminClient();

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, restaurant_id, subtotal, discount_amount")
    .eq("status", "delivered")
    .gte("created_at", periodStart)
    .lt("created_at", periodEnd);

  if (ordersError) {
    console.error("[billing:generateCommissions]", ordersError.message);
    return { ok: false, error: "Could not read orders for that period." };
  }

  if (!orders || orders.length === 0) {
    return { ok: false, error: "No delivered orders in that period. Nothing to generate." };
  }

  // Exclude refunded orders — charging commission on a refunded sale is
  // charging for a sale that did not happen.
  const { data: refunded } = await supabase
    .from("refunds")
    .select("order_id")
    .not("order_id", "is", null);
  const refundedIds = new Set((refunded ?? []).map((r) => (r as { order_id: string }).order_id));

  // Note: subtotal − discount. Delivery fee and service charge are both
  // deliberately absent from this sum.
  const totals = new Map<string, { count: number; gross: number }>();
  for (const order of orders) {
    if (refundedIds.has(order.id)) continue;
    const acc = totals.get(order.restaurant_id) ?? { count: 0, gross: 0 };
    acc.count += 1;
    acc.gross += order.subtotal - order.discount_amount;
    totals.set(order.restaurant_id, acc);
  }

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("restaurant_id, subscription_plans ( commission_rate )");

  const rates = new Map<string, number>();
  for (const row of (subs ?? []) as unknown as {
    restaurant_id: string;
    subscription_plans: { commission_rate: number } | null;
  }[]) {
    rates.set(row.restaurant_id, Number(row.subscription_plans?.commission_rate ?? 5));
  }

  let written = 0;
  for (const [restaurantId, { count, gross }] of totals) {
    const rate = rates.get(restaurantId) ?? 5;
    const amount = Math.round((gross * rate) / 100);

    // Upsert restricted to drafts: an issued or settled statement for the same
    // period is left exactly as the restaurant last saw it.
    const { data: existing } = await supabase
      .from("commission_statements")
      .select("id, status")
      .eq("restaurant_id", restaurantId)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .maybeSingle();

    if (existing && existing.status !== "draft") continue;

    const payload = {
      restaurant_id: restaurantId,
      period_start: periodStart,
      period_end: periodEnd,
      order_count: count,
      gross_sales: gross,
      commission_rate: rate,
      commission_amount: amount,
      status: "draft" as const,
    };

    const result = existing
      ? await supabase.from("commission_statements").update(payload).eq("id", existing.id)
      : await supabase.from("commission_statements").insert(payload);

    if (result.error) {
      console.error("[billing:generateCommissions] write failed", restaurantId, result.error.message);
      continue;
    }
    written += 1;
  }

  await writeAudit(admin, {
    action: "commission.generate",
    entityType: "commission_statement",
    summary: `${written} draft(s) generated for ${periodStart.slice(0, 10)} – ${periodEnd.slice(0, 10)}`,
  });

  revalidatePath("/a/commissions");
  return written > 0
    ? { ok: true }
    : { ok: false, error: "Nothing written — all statements for that period are already issued." };
}

/* ── Refunds ───────────────────────────────────────────────────────────── */

export async function createRefund(input: {
  restaurantId: string;
  amount: number;
  reason: string;
  type: "refund" | "chargeback";
}): Promise<ActionResult> {
  // A manual refund ledger entry is money out — super admins only.
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  const admin = gate.admin;

  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, error: "Enter a whole amount in francs." };
  }
  if (input.reason.trim().length < 5) {
    return { ok: false, error: "Give a reason — it appears on the statement." };
  }

  const supabase = createAdminClient();

  // §14.5 — a refund is ITS OWN ROW. The original payment is never edited:
  // it records what was collected, this records what was returned.
  const reference = makeReference("RF");
  const { error } = await supabase.from("refunds").insert({
    reference,
    restaurant_id: input.restaurantId,
    type: input.type,
    amount: Math.round(input.amount),
    reason: input.reason.trim(),
    status: "completed",
    created_by: admin.email,
    completed_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[billing:createRefund]", error.message);
    return { ok: false, error: "Could not create the refund." };
  }

  await writeAudit(admin, {
    action: "refund.create",
    entityType: "refund",
    entityId: input.restaurantId,
    summary: `${input.type} of ${input.amount} XAF — ${input.reason.trim()}`,
  });

  // Money leaving the tenant's account is news the tenant must not discover
  // by looking at a statement.
  await notify({
    event: "billing_refund",
    tone: "warning",
    restaurantId: input.restaurantId,
    href: "/m/billing",
    params: { reference, amount: input.amount, reason: input.reason.trim() },
  });

  revalidatePath("/a/refunds");
  revalidatePath("/a/commissions");
  return { ok: true };
}

/* ── Order cancellations with refund (support) ─────────────────────────── */

/**
 * Cancel a customer's order by reference and refund what they paid online.
 *
 * The support path for "the food never came": the same cancelPaidOrder()
 * the restaurant's own cancel button uses (one transaction, then the Mobile
 * Money payout), plus an audit row naming the admin. Unpaid orders are simply
 * cancelled.
 */
export async function adminCancelOrder(input: { reference: string; reason: string }): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const reference = input.reference.trim().toUpperCase();
  const reason = input.reason.trim();
  if (!reference) return { ok: false, error: "Enter the order reference (CMD-…)." };
  if (reason.length < 5) return { ok: false, error: "Give a reason — the customer reads it." };

  const supabase = createAdminClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, reference, status, is_paid, payment_method, restaurant_id, customer_id, restaurants ( name )")
    .eq("reference", reference)
    .maybeSingle();
  if (!order) return { ok: false, error: `No order ${reference}.` };
  if (order.status === "cancelled" || order.status === "delivered") {
    return { ok: false, error: `Order ${reference} is already ${order.status}.` };
  }

  const restaurantName = (order.restaurants as unknown as { name?: string } | null)?.name;
  const paidOnline = order.is_paid && (order.payment_method === "mobile_money" || order.payment_method === "wallet");

  if (paidOnline) {
    const result = await cancelPaidOrder({
      orderId: order.id as string,
      actor: admin.email,
      reason,
      restaurantName,
      by: "admin",
    });
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.reason === "insufficientBalance"
            ? "The restaurant wallet no longer covers this refund (already withdrawn). Refund by hand and adjust the wallet."
            : result.reason === "migrationMissing"
              ? "Run migration 0059 in the Supabase SQL editor first."
              : "The cancellation could not be recorded.",
      };
    }
  } else {
    const { data: cancelled } = await supabase
      .from("orders")
      .update({ status: "cancelled", cancelled_reason: reason, cancelled_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("status", order.status)
      .eq("is_paid", false)
      .select("id")
      .maybeSingle();
    if (!cancelled) return { ok: false, error: "The order changed meanwhile — reload and try again." };
    await supabase.from("order_status_history").insert({ order_id: order.id, status: "cancelled", by_name: "Resto237", note: reason });
    await releaseOrderHoldings(order.id as string);
    if (order.customer_id) {
      await notify({
        event: "order_cancelled",
        tone: "error",
        customerId: order.customer_id as string,
        href: `/orders/${order.id}`,
        params: { reference, restaurantName, cancelledBy: "restaurant", reason },
      });
    }
  }

  await writeAudit(admin, {
    action: "order.cancel",
    entityType: "order",
    entityId: order.id as string,
    summary: `Cancelled ${reference}${paidOnline ? " with refund" : ""} — ${reason}`,
  });
  revalidatePath("/a/refunds");
  return { ok: true, note: paidOnline ? "Cancelled; the refund is on its way to the customer." : "Cancelled." };
}

/**
 * Put a refund the payout saga gave up on back in the queue (after the admin
 * checked CamerPay and fixed the cause, e.g. topped up the payout balance).
 */
export async function adminRetryRefund(refundId: string): Promise<ActionResult> {
  // Re-sends a Mobile Money payout — super admins only.
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  const admin = gate.admin;
  const supabase = createAdminClient();
  const { data: refund } = await supabase
    .from("refunds")
    .select("id, reference, status, reply_to, raw_response, order_id, reservation_id")
    .eq("id", refundId)
    .maybeSingle();
  if (!refund || (!refund.order_id && !refund.reservation_id)) return { ok: false, error: "Refund not found." };
  if (refund.status !== "rejected") return { ok: false, error: "Only a refund that gave up can be retried." };

  const raw = { ...((refund.raw_response as Record<string, unknown> | null) ?? {}) };
  delete raw.payoutClaim;
  delete raw.gaveUp;
  raw.payoutTries = 0;
  raw.retriedBy = admin.email;
  const { error } = await supabase
    .from("refunds")
    .update({ status: "pending", reply_to: null, raw_response: raw })
    .eq("id", refundId)
    .eq("status", "rejected");
  if (error) return { ok: false, error: "Could not requeue the refund." };

  await startRefundPayout(refundId);
  await writeAudit(admin, { action: "refund.retry", entityType: "refund", entityId: refundId, summary: `Retried ${refund.reference}` });
  revalidatePath("/a/refunds");
  return { ok: true };
}
