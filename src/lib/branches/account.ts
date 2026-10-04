import "server-only";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { isMissingColumn } from "@/lib/data/missing-column";
import { getFreeModeWindow } from "@/lib/data/billing";
import { ensureUnpaidInvoice, invoiceHasPaymentInFlight, repriceUnpaidInvoice } from "@/lib/data/invoice-issue";
import { notify } from "@/lib/notify";
import {
  billableExtraBranches,
  branchStatusChanges,
  coveredBranchCount,
  openBranches,
  planInvoiceQuote,
  proratedBranchCharge,
  type BranchPlanTerms,
} from "./coverage";

/**
 * A restaurant and its branches, as one account (0072).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  DELIBERATELY NOT A SERVER ACTION. This module grants and withdraws
 *  service (it is the only writer of `status = 'paused'`) and raises
 *  invoices, so — like invoice-activation.ts — it must never be reachable
 *  from a URL. The branch screen's actions, the payment activation, the
 *  admin's plan tools and the daily sweep call it.
 *
 *  THE SYNC IS THE ONE PLACE A BRANCH STARTS OR STOPS RUNNING. Every event
 *  that can change coverage calls it afterwards — a branch opened or closed,
 *  a plan chosen, an invoice paid, an admin changing a plan or a status —
 *  and the daily sweep runs it for everyone, which is what catches the one
 *  change no event announces: a main subscription running past its grace
 *  window at 3 a.m. It is idempotent, compare-and-swap per row, and never
 *  throws: a failed pause must not undo the payment or plan change that
 *  triggered it.
 * ─────────────────────────────────────────────────────────────────────────
 */

const db = () => createAdminClient();

export interface BranchRecord {
  id: string;
  name: string;
  label: string;
  slug: string;
  status: string;
  closedAt: string | null;
  createdAt: string;
  addressLine: string | null;
}

export interface BranchAccount {
  /** False until 0072 is applied: no branch can exist or be created. */
  migrated: boolean;
  main: {
    id: string;
    name: string;
    label: string;
    slug: string;
    status: string;
    ownerId: string | null;
    serviceAreaId: string;
    /** The full row, for copying the brand onto a new branch. */
    row: Record<string, unknown>;
  };
  subscription: {
    id: string;
    planId: string;
    endDate: string | null;
    /** subscription_state.state of the main. */
    state: string;
    isTrialing: boolean;
    /** Extra branches paid for the current period. */
    extraBranches: number;
  } | null;
  plan: (BranchPlanTerms & { id: string; tier: string; name: string }) | null;
  branches: BranchRecord[];
}

type Row = Record<string, unknown>;

function toPlan(row: Row): BranchAccount["plan"] {
  return {
    id: String(row.id),
    tier: String(row.tier ?? "starter"),
    name: String(row.name ?? ""),
    monthlyPrice: Number(row.monthly_price ?? 0),
    includedBranches: Number(row.included_branches ?? 1),
    extraBranchPrice:
      row.extra_branch_price === null || row.extra_branch_price === undefined ? null : Number(row.extra_branch_price),
  };
}

function toBranch(row: Row): BranchRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    label: String(row.branch_label ?? ""),
    slug: String(row.slug ?? ""),
    status: String(row.status ?? "pending"),
    closedAt: (row.branch_closed_at as string | null | undefined) ?? null,
    createdAt: String(row.created_at ?? ""),
    addressLine: (row.address_line as string | null | undefined) ?? null,
  };
}

/**
 * The main restaurant a restaurant bills through: its parent if it is a
 * branch, itself otherwise. `select("*")` so it answers before 0072 too.
 */
export async function mainRestaurantId(restaurantId: string): Promise<string> {
  const { data } = await db().from("restaurants").select("*").eq("id", restaurantId).maybeSingle();
  const parent = (data as Row | null)?.parent_id;
  return typeof parent === "string" && parent ? parent : restaurantId;
}

/**
 * Everything the rules need about one main restaurant. Null when the id is
 * unknown or names a branch — accounts are addressed by their main.
 */
export async function loadBranchAccount(mainId: string): Promise<BranchAccount | null> {
  const supabase = db();

  const [mainResult, branchesResult, subResult, stateResult] = await Promise.all([
    supabase.from("restaurants").select("*").eq("id", mainId).maybeSingle(),
    supabase.from("restaurants").select("*").eq("parent_id", mainId).order("created_at", { ascending: true }),
    supabase.from("subscriptions").select("*").eq("restaurant_id", mainId).maybeSingle(),
    supabase.from("subscription_state").select("state, is_trialing").eq("restaurant_id", mainId).maybeSingle(),
  ]);

  const main = mainResult.data as Row | null;
  if (!main) return null;
  if (typeof main.parent_id === "string" && main.parent_id) return null;

  let migrated = true;
  if (branchesResult.error) {
    if (!isMissingColumn(branchesResult.error)) {
      console.error("[branches:load] branches", mainId, branchesResult.error.message);
    }
    migrated = false;
  }

  const sub = subResult.data as Row | null;
  let plan: BranchAccount["plan"] = null;
  if (sub?.plan_id) {
    const { data: planRow } = await supabase.from("subscription_plans").select("*").eq("id", sub.plan_id).maybeSingle();
    if (planRow) plan = toPlan(planRow as Row);
  }

  const state = stateResult.data as { state?: string; is_trialing?: boolean } | null;

  return {
    migrated,
    main: {
      id: String(main.id),
      name: String(main.name ?? ""),
      label: String(main.branch_label ?? ""),
      slug: String(main.slug ?? ""),
      status: String(main.status ?? "pending"),
      ownerId: (main.owner_id as string | null) ?? null,
      serviceAreaId: String(main.service_area_id ?? ""),
      row: main,
    },
    subscription: sub
      ? {
          id: String(sub.id),
          planId: String(sub.plan_id),
          endDate: (sub.end_date as string | null) ?? null,
          state: state?.state === "cancelled" ? "locked" : (state?.state ?? "active"),
          isTrialing: Boolean(state?.is_trialing),
          extraBranches: Number(sub.extra_branches ?? 0),
        }
      : null,
    plan,
    branches: migrated ? ((branchesResult.data ?? []) as Row[]).map(toBranch) : [],
  };
}

/** How many branches the account runs right now. */
export function accountCoveredCount(account: BranchAccount): number {
  if (!account.plan || !account.subscription) return 0;
  return coveredBranchCount({
    plan: account.plan,
    mainStatus: account.main.status,
    mainState: account.subscription.state,
    paidExtraBranches: account.subscription.extraBranches,
  });
}

/* ── The sync ──────────────────────────────────────────────────────────── */

export interface SyncResult {
  paused: BranchRecord[];
  resumed: BranchRecord[];
}

/**
 * Bring every branch of one account to the status its plan allows.
 *
 * Compare-and-swap per row (`.eq("status", current)`), so an admin
 * suspending a branch in the same instant wins: the sync only ever moves a
 * row between 'active' and 'paused', and a row that is no longer what it
 * read is left alone.
 */
export async function syncBranchCoverage(mainId: string): Promise<SyncResult> {
  const result: SyncResult = { paused: [], resumed: [] };

  try {
    const account = await loadBranchAccount(mainId);
    if (!account || !account.migrated || account.branches.length === 0) return result;

    const changes = branchStatusChanges(account.branches, accountCoveredCount(account));
    if (changes.size === 0) return result;

    const supabase = db();
    for (const branch of account.branches) {
      const next = changes.get(branch.id);
      if (!next) continue;

      const { data, error } = await supabase
        .from("restaurants")
        .update({ status: next })
        .eq("id", branch.id)
        .eq("status", branch.status)
        .select("id")
        .maybeSingle();

      if (error) {
        console.error("[branches:sync]", branch.id, next, error.message);
        continue;
      }
      if (!data) continue;
      (next === "paused" ? result.paused : result.resumed).push(branch);
    }

    await announce(account, result);
  } catch (error) {
    console.error("[branches:sync] failed", mainId, error instanceof Error ? error.message : error);
  }

  return result;
}

/**
 * Tell the owner (the main's staff) and the branch's own team. Closing a
 * branch on purpose is not news to the person who just did it, but the
 * branch's kitchen still needs to know why the orders stopped.
 */
async function announce(account: BranchAccount, result: SyncResult): Promise<void> {
  const touched = [...result.paused, ...result.resumed];
  if (touched.length === 0) return;

  for (const branch of result.paused) {
    const detail = branch.closedAt
      ? `La succursale ${branch.label} est fermée : elle n'accepte plus de commandes ni de réservations.`
      : `La succursale ${branch.label} est en pause : votre forfait ne la couvre plus. Elle reprendra dès que le forfait ou le paiement des succursales est à jour.`;
    await notify({ event: "billing", tone: "warning", restaurantId: account.main.id, href: "/m/branches", params: { detail } });
    await notify({ event: "billing", tone: "warning", restaurantId: branch.id, href: "/m", params: { detail } });
  }

  for (const branch of result.resumed) {
    const detail = `La succursale ${branch.label} est de nouveau en service.`;
    await notify({ event: "billing", tone: "success", restaurantId: account.main.id, href: "/m/branches", params: { detail } });
    await notify({ event: "billing", tone: "success", restaurantId: branch.id, href: "/m", params: { detail } });
  }

  // A paused branch must leave the directory now, not when the cache expires.
  try {
    for (const branch of touched) revalidatePath(`/restaurants/${branch.slug}`);
    revalidatePath("/restaurants");
    revalidatePath("/");
  } catch {
    // Outside a request (a script): nothing cached to clear.
  }
}

/**
 * The daily safety net: every account that has branches.
 *
 * Catches what no event announces — a main subscription lapsing past its
 * grace window, or one an admin extended directly in SQL.
 */
export async function syncAllBranchCoverage(): Promise<{ accounts: number; paused: number; resumed: number }> {
  const totals = { accounts: 0, paused: 0, resumed: 0 };

  const { data, error } = await db().from("restaurants").select("parent_id").not("parent_id", "is", null);
  if (error) {
    if (!isMissingColumn(error)) console.error("[branches:syncAll]", error.message);
    return totals;
  }

  const mains = [...new Set(((data ?? []) as { parent_id: string }[]).map((row) => row.parent_id))];
  for (const mainId of mains) {
    const result = await syncBranchCoverage(mainId);
    totals.accounts += 1;
    totals.paused += result.paused.length;
    totals.resumed += result.resumed.length;
  }
  return totals;
}

/* ── Billing ───────────────────────────────────────────────────────────── */

/** Open branches of an account — the ones it pays for. */
export function accountOpenBranchCount(account: BranchAccount): number {
  return openBranches(account.branches).length;
}

/**
 * Extra branches billed by one month of `planId` for this restaurant.
 *
 * For the renewal sweep and choosePlan, which know a main and a plan but not
 * the account. Zero for a branch id (branches are never billed directly) and
 * before 0072.
 */
export async function quotePlanMonth(
  restaurantId: string,
  plan: BranchPlanTerms,
): Promise<{ extraBranches: number; branchAmount: number; amount: number }> {
  const { data, error } = await db()
    .from("restaurants")
    .select("status, branch_closed_at")
    .eq("parent_id", restaurantId);

  if (error) {
    if (!isMissingColumn(error)) console.error("[branches:quotePlanMonth]", restaurantId, error.message);
    return planInvoiceQuote(plan, 0);
  }

  const open = ((data ?? []) as { status: string; branch_closed_at: string | null }[]).filter(
    (row) => !row.branch_closed_at && (row.status === "active" || row.status === "paused"),
  ).length;
  return planInvoiceQuote(plan, open);
}

/**
 * Re-price every open invoice of the account to the branches it now has.
 *
 * Plan invoices (renewals, a plan the owner chose) bill each extra branch
 * for the month; a branch top-up bills what is left of the period, and is
 * voided once nothing is left for it to buy. In-flight payments are never
 * re-priced (invoice-issue.ts).
 */
export async function refreshBranchInvoices(mainId: string): Promise<void> {
  try {
    const account = await loadBranchAccount(mainId);
    if (!account || !account.migrated) return;

    const supabase = db();
    const { data: open, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("restaurant_id", mainId)
      .eq("status", "unpaid");
    if (error) {
      console.error("[branches:refreshInvoices]", mainId, error.message);
      return;
    }

    const rows = (open ?? []) as Row[];
    const planIds = [...new Set(rows.map((row) => String(row.plan_id ?? "")).filter(Boolean))];
    const plans = new Map<string, NonNullable<BranchAccount["plan"]>>();
    if (planIds.length > 0) {
      const { data: planRows } = await supabase.from("subscription_plans").select("*").in("id", planIds);
      for (const planRow of (planRows ?? []) as Row[]) plans.set(String(planRow.id), toPlan(planRow)!);
    }

    const openCount = accountOpenBranchCount(account);

    for (const row of rows) {
      const invoice = {
        id: String(row.id),
        amount: Number(row.amount ?? 0),
        kind: (row.kind === "branches" ? "branches" : "plan") as "plan" | "branches",
        extraBranches: Number(row.extra_branches ?? 0),
        branchAmount: Number(row.branch_amount ?? 0),
      };

      if (invoice.kind === "plan") {
        const plan = plans.get(String(row.plan_id ?? ""));
        if (!plan) continue;
        const quote = planInvoiceQuote(plan, openCount);
        await repriceUnpaidInvoice(invoice, { extraBranches: quote.extraBranches, branchAmount: quote.branchAmount });
        continue;
      }

      // A top-up: what is still unpaid for, for the days still left.
      const plan = account.plan;
      const sub = account.subscription;
      const needed = plan ? billableExtraBranches(plan, openCount) : 0;
      const paid = sub?.extraBranches ?? 0;
      const charge =
        plan && sub && plan.extraBranchPrice !== null
          ? proratedBranchCharge({ unitPrice: plan.extraBranchPrice, branches: needed - paid, now: new Date(), periodEnd: sub.endDate })
          : { amount: 0, days: 0 };

      if (charge.amount <= 0) {
        // Nothing left to buy (branch closed, or the renewal bills it now).
        if (await invoiceHasPaymentInFlight(invoice.id)) continue;
        await supabase.from("invoices").update({ status: "void" }).eq("id", invoice.id).eq("status", "unpaid");
        continue;
      }
      await repriceUnpaidInvoice(invoice, { extraBranches: needed, branchAmount: charge.amount });
    }
  } catch (error) {
    console.error("[branches:refreshInvoices] failed", mainId, error instanceof Error ? error.message : error);
  }
}

/** The unpaid branch top-up of an account, if one is waiting. */
export async function fetchUnpaidBranchTopUp(mainId: string): Promise<{ id: string; amount: number } | null> {
  const { data, error } = await db()
    .from("invoices")
    .select("id, amount")
    .eq("restaurant_id", mainId)
    .eq("status", "unpaid")
    .eq("kind", "branches")
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (!isMissingColumn(error)) console.error("[branches:unpaidTopUp]", mainId, error.message);
    return null;
  }
  return data ? { id: data.id as string, amount: data.amount as number } : null;
}

export type TopUpOutcome =
  /** Every open branch is covered — nothing to pay. */
  | { kind: "covered" }
  /** Free mode: the extras were granted with no invoice. */
  | { kind: "granted" }
  /** Pay this to open the paused branches now. */
  | { kind: "invoice"; invoiceId: string; amount: number; created: boolean }
  /** The paid period is over: the branches ride on the renewal invoice. */
  | { kind: "renewal" }
  /** The plan cannot run them, or the main is not live. */
  | { kind: "unavailable" };

/**
 * Make the account able to run every open branch: grant them (free mode),
 * or raise the prorated top-up that will.
 *
 * Activation raises `subscriptions.extra_branches` when the top-up is paid
 * and runs the sync; until then the uncovered branches stay paused.
 */
export async function ensureBranchTopUp(mainId: string): Promise<TopUpOutcome> {
  const account = await loadBranchAccount(mainId);
  if (!account || !account.migrated || !account.plan || !account.subscription) return { kind: "unavailable" };

  const { plan, subscription } = account;
  const needed = billableExtraBranches(plan, accountOpenBranchCount(account));
  if (needed <= subscription.extraBranches) return { kind: "covered" };
  if (plan.extraBranchPrice === null) return { kind: "unavailable" };
  if (account.main.status !== "active") return { kind: "unavailable" };
  if (subscription.state !== "active" && subscription.state !== "grace") return { kind: "renewal" };

  const supabase = db();
  const freeMode = await getFreeModeWindow();

  if (freeMode.effective) {
    const { error } = await supabase
      .from("subscriptions")
      .update({ extra_branches: needed })
      .eq("id", subscription.id);
    if (error) {
      console.error("[branches:topUp] free grant", mainId, error.message);
      return { kind: "unavailable" };
    }
    await syncBranchCoverage(mainId);
    return { kind: "granted" };
  }

  const now = new Date();
  const charge = proratedBranchCharge({
    unitPrice: plan.extraBranchPrice,
    branches: needed - subscription.extraBranches,
    now,
    periodEnd: subscription.endDate,
  });

  if (charge.amount <= 0) {
    await refreshBranchInvoices(mainId);
    return { kind: "renewal" };
  }

  const invoice = await ensureUnpaidInvoice({
    restaurantId: mainId,
    planId: plan.id,
    amount: charge.amount,
    kind: "branches",
    from: now,
    until: subscription.endDate ? new Date(subscription.endDate) : undefined,
    branches: { extraBranches: needed, branchAmount: charge.amount },
  });

  if (!invoice) return { kind: "unavailable" };
  return { kind: "invoice", invoiceId: invoice.id, amount: invoice.amount, created: invoice.created };
}
