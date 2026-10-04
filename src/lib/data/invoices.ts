import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Invoice, plan and trial reads for the RESTAURANT side of billing (/m/billing).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS NEXT TO lib/data/billing.ts.
 *
 *  That module is the ADMIN's view: it lists every tenant's subscription and
 *  counts subscribers per plan, and none of its functions take a restaurantId
 *  because an admin is allowed to see all of them. Pointing a tenant screen at
 *  it would mean either widening those queries or filtering after the fact,
 *  and "filter after the fact" is how one restaurant ends up rendering
 *  another's invoice.
 *
 *  Here every invoice read takes `restaurantId` FIRST and filters on it. These
 *  run with the service-role key, which bypasses RLS completely, so the
 *  `.eq("restaurant_id", …)` IS the tenant boundary — not a convenience.
 *  Same rule as lib/data/orders.ts.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** The `status` check constraint on `invoices` (migration 0005). */
export type InvoiceStatus = "unpaid" | "paid" | "void";

export interface Invoice {
  id: string;
  number: string;
  /** Whole francs. XAF has no minor unit (§13). */
  amount: number;
  currency: string;
  /** RAW, straight from the column. The UI maps it to a label, never the reverse. */
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  paidAt: string | null;
  planId: string | null;
  /** Null when the plan row was deleted — `plan_id` is `on delete set null`. */
  planName: string | null;
  planTier: string | null;
  commissionRate: number | null;
  /** 'plan' = a month of the plan; 'branches' = a mid-period branch top-up (0072). */
  kind: "plan" | "branches";
  /** 'plan': extra branches billed; 'branches': extra branches covered once paid. */
  extraBranches: number;
  /** The part of `amount` paying for branches; the rest is the plan. */
  branchAmount: number;
}

/** One invoice, with what a printable document needs on top of the list row. */
export interface InvoiceDetail extends Invoice {
  restaurantName: string;
  branchLabel: string;
}

export interface OpenInvoicePayment {
  id: string;
  phone: string | null;
}

/*
  `*`, not a column list: the branch columns (0072) come back once they exist,
  and a database that has not run 0072 yet still answers — its invoices read
  as plain plan months.
*/
const INVOICE_COLUMNS = "*";

interface DbInvoice {
  id: string;
  number: string;
  amount: number;
  currency: string;
  status: string;
  period_start: string;
  period_end: string;
  issued_at: string;
  paid_at: string | null;
  plan_id: string | null;
  kind?: string;
  extra_branches?: number;
  branch_amount?: number;
  subscription_plans: { name: string; tier: string; commission_rate: number } | null;
}

function shape(row: DbInvoice): Invoice {
  return {
    id: row.id,
    number: row.number,
    amount: row.amount,
    currency: row.currency,
    status: row.status as InvoiceStatus,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    issuedAt: row.issued_at,
    paidAt: row.paid_at,
    planId: row.plan_id,
    planName: row.subscription_plans?.name ?? null,
    planTier: row.subscription_plans?.tier ?? null,
    commissionRate:
      row.subscription_plans?.commission_rate === undefined
        ? null
        : Number(row.subscription_plans.commission_rate),
    kind: row.kind === "branches" ? "branches" : "plan",
    extraBranches: Number(row.extra_branches ?? 0),
    branchAmount: Number(row.branch_amount ?? 0),
  };
}

/**
 * The tenant's invoices, newest first.
 *
 * Capped: /m/billing is a screen for settling what is owed, not a ledger. The
 * ones that matter are always at the top because unpaid invoices are the
 * recent ones.
 */
export async function fetchInvoices(restaurantId: string, limit = 24): Promise<Invoice[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("invoices")
    .select(`${INVOICE_COLUMNS}, subscription_plans ( name, tier, commission_rate )`)
    .eq("restaurant_id", restaurantId)
    .order("issued_at", { ascending: false })
    .limit(limit);

  if (error) {
    // Empty, not thrown. A billing table that is missing or unreadable must
    // still leave the page that takes payment standing (§5 rule 3).
    console.error("[invoices:fetchInvoices]", error.message);
    return [];
  }

  return (data as unknown as DbInvoice[]).map(shape);
}

/**
 * One invoice, SCOPED TO THE BRANCH.
 *
 * The id comes out of a URL, so this is the whole defence: an id copied from
 * another tenant's address bar matches no row here and the page renders 404
 * rather than their invoice. Returning null instead of throwing keeps that
 * decision at the page, where `notFound()` lives.
 */
export async function fetchInvoice(
  restaurantId: string,
  invoiceId: string,
): Promise<InvoiceDetail | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("invoices")
    .select(
      `${INVOICE_COLUMNS},
       subscription_plans ( name, tier, commission_rate ),
       restaurants ( name, branch_label )`,
    )
    .eq("restaurant_id", restaurantId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as DbInvoice & {
    restaurants: { name: string; branch_label: string } | null;
  };

  return {
    ...shape(row),
    restaurantName: row.restaurants?.name ?? "—",
    branchLabel: row.restaurants?.branch_label ?? "",
  };
}

/**
 * Latest unsettled, trackable payment for one tenant invoice.
 *
 * A pending row with no transaction id is an inconclusive transport error,
 * not a CamerPay collection the UI can follow. It is skipped so the manager
 * may retry, while a real pending request is restored after every reload.
 */
export async function fetchOpenInvoicePayment(
  restaurantId: string,
  invoiceId: string,
): Promise<OpenInvoicePayment | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("payment_attempts")
    .select("id, status, transaction_id, phone")
    .eq("restaurant_id", restaurantId)
    .eq("invoice_id", invoiceId)
    .in("status", ["pending", "succeeded"])
    .is("settled_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[invoices:fetchOpenInvoicePayment]", error.message);
    return null;
  }

  const attempt = (data ?? []).find(
    (row) => row.status === "succeeded" || Boolean(row.transaction_id),
  );
  return attempt ? { id: attempt.id, phone: attempt.phone } : null;
}

/* ── Plans ─────────────────────────────────────────────────────────────── */

export interface BillingPlan {
  id: string;
  tier: string;
  name: string;
  /** 0 / 10 000 / 25 000 as seeded by migration 0009 — read, never hardcoded. */
  monthlyPrice: number;
  commissionRate: number;
  /** null = unlimited, everywhere. Never a magic 999999. */
  menuItemLimit: number | null;
  tableLimit: number | null;
  promotionLimit: number | null;
  staffManagement: boolean;
  analytics: boolean;
  /** null = this plan has no free trial (migration 0010). Starter is free anyway. */
  trialDays: number | null;
  isFeatured: boolean;
  /** Locations the plan includes, the main restaurant counted (0053). */
  includedBranches: number;
  /** Monthly price per extra branch; null = the plan sells none (0072). */
  extraBranchPrice: number | null;
}

/**
 * The plans a tenant may choose from.
 *
 * No restaurantId: the plan catalogue is the platform's, identical for every
 * tenant, and `is_active` is what an admin toggles to withdraw one from sale.
 *
 * Not lib/data/billing.ts `listPlans()` — that one also counts subscribers per
 * plan, which this screen has no use for, and it does not return `trial_days`.
 */
export async function fetchPlans(): Promise<BillingPlan[]> {
  const supabase = createAdminClient();

  // `*` so the branch price (0072) is read when it exists and skipped when not.
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");

  if (error) {
    console.error("[invoices:fetchPlans]", error.message);
    return [];
  }

  return (data ?? []).map((p) => ({
    id: p.id as string,
    tier: p.tier as string,
    name: p.name as string,
    monthlyPrice: p.monthly_price as number,
    commissionRate: Number(p.commission_rate),
    menuItemLimit: p.menu_item_limit as number | null,
    tableLimit: p.table_limit as number | null,
    promotionLimit: p.promotion_limit as number | null,
    staffManagement: p.staff_management as boolean,
    analytics: p.analytics as boolean,
    trialDays: (p.trial_days as number | null) ?? null,
    isFeatured: Boolean(p.is_featured),
    includedBranches: Number(p.included_branches ?? 1),
    extraBranchPrice:
      p.extra_branch_price === null || p.extra_branch_price === undefined ? null : Number(p.extra_branch_price),
  }));
}

/* ── Trial ─────────────────────────────────────────────────────────────── */

export interface TrialState {
  endsAt: string | null;
  /** One per restaurant, ever (migration 0010). True hides every trial offer. */
  used: boolean;
  /** Running right now — a past `endsAt` is history, not a state. */
  active: boolean;
  daysLeft: number | null;
}

const NO_TRIAL: TrialState = { endsAt: null, used: false, active: false, daysLeft: null };

/**
 * Trial labels, straight from the `subscription_state` view.
 *
 * `is_trialing` and `trial_days_remaining` are computed against now() in
 * Postgres. Recomputing them here would need a clock during render, which the
 * React Compiler rejects outright, and would let the banner disagree with the
 * state the same view reports.
 */
export async function fetchTrialState(restaurantId: string): Promise<TrialState> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("subscription_state")
    .select("trial_ends_at, trial_used, is_trialing, trial_days_remaining")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (error || !data) return NO_TRIAL;

  return {
    endsAt: (data.trial_ends_at as string | null) ?? null,
    used: Boolean(data.trial_used),
    active: Boolean(data.is_trialing),
    daysLeft: (data.trial_days_remaining as number | null) ?? null,
  };
}
