import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { isMissingColumn } from "./missing-column";

/**
 * Raising and re-pricing the invoices a tenant pays.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  DELIBERATELY NOT A SERVER ACTION — same rule as invoice-activation.ts.
 *  Called by choosePlan, the renewal sweep and the branch screens.
 *
 *  Two kinds since 0072:
 *    · 'plan'     — a month of the plan, plus the extra branches it bills.
 *    · 'branches' — a top-up for branches opened mid-period, prorated.
 *
 *  ONE UNPAID INVOICE PER TENANT PER PLAN (and one branch top-up), EVER. A
 *  hesitant tenant clicking "choose plan" six times, plus a nightly renewal
 *  sweep, plus an admin prompting them, otherwise stack six invoices for one
 *  month of service and whichever one they pay decides how much they were
 *  charged.
 *
 *  An open invoice is RE-PRICED when the branches it bills change (one
 *  opened, one closed) — but only its branch part, and never while a
 *  payment is in flight against it: activation does not re-check amounts,
 *  so changing the figure under a request already on someone's handset
 *  would settle one amount and record another. A refused re-price is safe:
 *  the invoice settles what it says, and anything it left out is billed as
 *  a top-up afterwards.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** One plan month — the same period activateFromInvoice() grants. */
const PERIOD_DAYS = 30;
const DAY_MS = 86_400_000;

export type InvoiceKind = "plan" | "branches";

/** Invoice numbers people can read down a phone line. */
function invoiceNumber(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `INV-${stamp}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

export interface UnpaidInvoice {
  id: string;
  number: string;
  amount: number;
  /** False when an existing unpaid invoice was reused. */
  created: boolean;
}

/** The branch part of an invoice — see 0072. */
export interface InvoiceBranchTerms {
  /** 'plan': extras billed this month. 'branches': total extras once paid. */
  extraBranches: number;
  /** The part of the amount paying for branches. */
  branchAmount: number;
}

interface OpenRow {
  id: string;
  number: string;
  amount: number;
  extra_branches?: number;
  branch_amount?: number;
}

/**
 * The unpaid invoice of this kind, if any. Before 0072 there is no `kind`
 * column and every invoice is a plan invoice, so the plan lookup falls back
 * to the old query and a branch top-up simply has nothing to find.
 */
async function findUnpaid(restaurantId: string, planId: string, kind: InvoiceKind): Promise<OpenRow | null> {
  const supabase = createAdminClient();

  const base = () => {
    let query = supabase
      .from("invoices")
      .select("id, number, amount, extra_branches, branch_amount")
      .eq("restaurant_id", restaurantId)
      .eq("status", "unpaid");
    if (kind === "plan") query = query.eq("plan_id", planId);
    return query;
  };

  const { data, error } = await base().eq("kind", kind).order("issued_at", { ascending: true }).limit(1).maybeSingle();
  if (!error) return (data as OpenRow | null) ?? null;

  if (!isMissingColumn(error)) {
    console.error("[invoice:findUnpaid]", restaurantId, error.message);
    return null;
  }
  if (kind === "branches") return null;

  const { data: legacy } = await supabase
    .from("invoices")
    .select("id, number, amount")
    .eq("restaurant_id", restaurantId)
    .eq("plan_id", planId)
    .eq("status", "unpaid")
    .order("issued_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (legacy as OpenRow | null) ?? null;
}

/**
 * Is a payment in flight against this invoice?
 *
 * Any attempt still pending, or succeeded and not yet settled, counts —
 * including the ones payInvoice would treat as a dead transport failure. A
 * pending Orange request can be answered by the customer dialling minutes
 * later, and re-pricing under it is exactly the disagreement this guards.
 */
export async function invoiceHasPaymentInFlight(invoiceId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("payment_attempts")
    .select("id")
    .eq("invoice_id", invoiceId)
    .in("status", ["pending", "succeeded"])
    .is("settled_at", null)
    .limit(1);

  // Unknown is not "no": refuse to re-price when we cannot tell.
  if (error) {
    console.error("[invoice:paymentInFlight]", invoiceId, error.message);
    return true;
  }
  if ((data ?? []).length > 0) return true;

  /*
    AN EXPIRED ORANGE CODE IS STILL IN FLIGHT until its one late check has
    run (security review 2026-10-05). A `failed` customer-dial attempt with no
    `lateCheck` can still be dialled and is then reopened and settled
    (recheckExpiredDialAttempt) — re-pricing under it let a base-price code
    pay for an invoice that had grown. activateFromInvoice also refuses a
    mismatched amount; this keeps the honest case from reaching that.
  */
  // Only within the window the late check still runs in (reconcile.ts,
  // LATE_DIAL_UNTIL_MS): past it nothing can reopen the attempt.
  const { data: dialled, error: dialError } = await supabase
    .from("payment_attempts")
    .select("raw_response")
    .eq("invoice_id", invoiceId)
    .eq("status", "failed")
    .is("settled_at", null)
    .gt("created_at", new Date(Date.now() - 3 * 60 * 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(5);
  if (dialError) {
    console.error("[invoice:paymentInFlight] dial", invoiceId, dialError.message);
    return true;
  }
  return ((dialled ?? []) as { raw_response: { customerDial?: unknown; lateCheck?: unknown } | null }[]).some(
    (row) => row.raw_response?.customerDial === true && !row.raw_response?.lateCheck,
  );
}

/**
 * Re-price the BRANCH part of an unpaid invoice.
 *
 * The plan part stays what it was raised at: an admin repricing a plan does
 * not reach invoices already issued (Admin → Plans says so), and this must
 * not become a back door for it. For a 'branches' top-up the whole amount is
 * the branch part.
 *
 * Returns the amount the invoice now carries.
 */
export async function repriceUnpaidInvoice(
  invoice: { id: string; amount: number; kind: InvoiceKind; extraBranches: number; branchAmount: number },
  terms: InvoiceBranchTerms,
): Promise<{ amount: number; changed: boolean }> {
  const branchAmount = Math.max(0, Math.round(terms.branchAmount));
  const extraBranches = Math.max(0, Math.floor(terms.extraBranches));

  if (branchAmount === invoice.branchAmount && extraBranches === invoice.extraBranches) {
    return { amount: invoice.amount, changed: false };
  }

  const amount =
    invoice.kind === "branches" ? branchAmount : Math.max(0, invoice.amount - invoice.branchAmount) + branchAmount;

  if (await invoiceHasPaymentInFlight(invoice.id)) return { amount: invoice.amount, changed: false };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ amount, extra_branches: extraBranches, branch_amount: branchAmount })
    .eq("id", invoice.id)
    .eq("status", "unpaid")
    .select("id")
    .maybeSingle();

  if (error) {
    // Pre-0072 there are no branch columns — and no branches to re-price.
    if (!isMissingColumn(error)) console.error("[invoice:reprice]", invoice.id, error.message);
    return { amount: invoice.amount, changed: false };
  }
  // Paid or voided in the meantime: what it said is what it was.
  if (!data) return { amount: invoice.amount, changed: false };

  return { amount, changed: true };
}

/**
 * THE tenant's payable invoice for a plan (or its branch top-up) — raised if
 * it does not exist yet, re-priced if its branch part went stale.
 *
 * The period recorded is billing history only — `activateFromInvoice` grants
 * a month from the moment it is PAID, never from the period on the invoice.
 */
export async function ensureUnpaidInvoice(input: {
  restaurantId: string;
  planId: string;
  amount: number;
  /** Where the billed period starts. Defaults to now. */
  from?: Date;
  /** Where it ends. Defaults to a month after `from`. */
  until?: Date;
  /** Defaults to 'plan'. */
  kind?: InvoiceKind;
  /** Defaults to no branches. */
  branches?: InvoiceBranchTerms;
}): Promise<UnpaidInvoice | null> {
  const supabase = createAdminClient();
  const kind = input.kind ?? "plan";
  const branches = input.branches ?? { extraBranches: 0, branchAmount: 0 };

  const existing = await findUnpaid(input.restaurantId, input.planId, kind);

  if (existing) {
    const repriced = await repriceUnpaidInvoice(
      {
        id: existing.id,
        amount: existing.amount,
        kind,
        extraBranches: Number(existing.extra_branches ?? 0),
        branchAmount: Number(existing.branch_amount ?? 0),
      },
      branches,
    );
    return { id: existing.id, number: existing.number, amount: repriced.amount, created: false };
  }

  const periodStart = input.from ?? new Date();
  const periodEnd = input.until ?? new Date(periodStart.getTime() + PERIOD_DAYS * DAY_MS);

  const row = {
    number: invoiceNumber(),
    restaurant_id: input.restaurantId,
    plan_id: input.planId,
    amount: Math.round(input.amount),
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
  };

  let result = await supabase
    .from("invoices")
    .insert({
      ...row,
      kind,
      extra_branches: Math.max(0, Math.floor(branches.extraBranches)),
      branch_amount: Math.max(0, Math.round(branches.branchAmount)),
    })
    .select("id, number, amount")
    .single();

  // Before 0072: a plan invoice without branches is exactly the old row. A
  // branch top-up cannot be written at all, and must not pass as a plan month.
  if (result.error && isMissingColumn(result.error) && kind === "plan" && branches.extraBranches === 0) {
    result = await supabase.from("invoices").insert(row).select("id, number, amount").single();
  }

  const { data: invoice, error } = result;
  if (error || !invoice) {
    console.error("[invoice:ensureUnpaid]", input.restaurantId, kind, error?.message);
    return null;
  }

  return {
    id: invoice.id as string,
    number: invoice.number as string,
    amount: invoice.amount as number,
    created: true,
  };
}
