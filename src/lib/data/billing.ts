import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Billing reads for the admin area.
 *
 * Like lib/data/admin.ts these bypass RLS via the secret key, because
 * `subscriptions`, `invoices`, `payment_attempts`, `refunds` and
 * `commission_statements` carry NO read policy at all — a tenant's billing
 * state is nobody else's business. Authorization happened in the layout.
 *
 * Every list returns [] rather than throwing when its table is missing, so a
 * half-migrated database shows honest empty pages instead of a stack trace.
 */

function softFail(what: string, error: { message: string; code?: string }): [] {
  console.warn(`[data:${what}] unavailable —`, error.code ?? "", error.message);
  return [];
}

/* ── Plans ─────────────────────────────────────────────────────────────── */

export interface Plan {
  id: string;
  tier: "starter" | "professional" | "enterprise";
  name: string;
  monthlyPrice: number;
  commissionRate: number;
  menuItemLimit: number | null;
  tableLimit: number | null;
  promotionLimit: number | null;
  staffManagement: boolean;
  analytics: boolean;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  /** How many tenants are on it — a plan in use cannot be deactivated lightly. */
  subscriberCount: number;
}

export async function listPlans(): Promise<Plan[]> {
  const supabase = createAdminClient();

  const [plansResult, subsResult] = await Promise.all([
    supabase.from("subscription_plans").select("*").order("sort_order"),
    supabase.from("subscriptions").select("plan_id"),
  ]);

  if (plansResult.error) return softFail("subscription_plans", plansResult.error);

  const counts = new Map<string, number>();
  for (const row of subsResult.data ?? []) {
    const key = (row as { plan_id: string }).plan_id;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return (plansResult.data ?? []).map((p) => ({
    id: p.id,
    tier: p.tier,
    name: p.name,
    monthlyPrice: p.monthly_price,
    commissionRate: Number(p.commission_rate),
    menuItemLimit: p.menu_item_limit,
    tableLimit: p.table_limit,
    promotionLimit: p.promotion_limit,
    staffManagement: p.staff_management,
    analytics: p.analytics,
    isActive: p.is_active,
    isFeatured: p.is_featured,
    sortOrder: p.sort_order,
    subscriberCount: counts.get(p.id) ?? 0,
  }));
}

/* ── Subscriptions ─────────────────────────────────────────────────────── */

export interface SubscriptionRow {
  /** Null for a restaurant that has no subscription row at all. */
  id: string | null;
  restaurantId: string;
  restaurantName: string;
  branchLabel: string;
  planName: string;
  planTier: string;
  /** From the subscription_state view — derived, never stored (§5). */
  state: "active" | "grace" | "locked" | "cancelled" | "none";
  startDate: string | null;
  endDate: string | null;
  daysRemaining: number | null;
  graceDays: number;
}

export async function listSubscriptions(): Promise<SubscriptionRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("subscription_state")
    .select(
      `id, restaurant_id, state, start_date, end_date, days_remaining, grace_days,
       restaurants ( name, branch_label ),
       subscription_plans ( name, tier )`,
    );

  if (error) return softFail("subscription_state", error);

  interface Row {
    id: string;
    restaurant_id: string;
    state: string;
    start_date: string;
    end_date: string | null;
    days_remaining: number | null;
    grace_days: number;
    restaurants: { name: string; branch_label: string } | null;
    subscription_plans: { name: string; tier: string } | null;
  }

  const rows: SubscriptionRow[] = (data as unknown as Row[]).map((row) => ({
    id: row.id,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurants?.name ?? "—",
    branchLabel: row.restaurants?.branch_label ?? "",
    planName: row.subscription_plans?.name ?? "—",
    planTier: row.subscription_plans?.tier ?? "starter",
    state: row.state as SubscriptionRow["state"],
    startDate: row.start_date,
    endDate: row.end_date,
    daysRemaining: row.days_remaining,
    graceDays: row.grace_days,
  }));

  /**
   * RESTAURANTS WITH NO SUBSCRIPTION ROW ARE LISTED TOO.
   *
   * The view is built from `subscriptions`, so a restaurant without one is not
   * shown as "no plan" — it is ABSENT, and an admin cannot act on a tenant
   * they cannot see. That is exactly how a newly approved restaurant ended up
   * stranded: locked out on one screen and invisible on the one that could
   * have fixed it.
   *
   * Approval now grants Starter, so this should stay empty. Listing them
   * anyway means the next way a restaurant loses its row is a visible problem
   * rather than a silent one.
   */
  const covered = new Set(rows.map((r) => r.restaurantId));

  const { data: orphans } = await supabase
    .from("restaurants")
    .select("id, name, branch_label, status")
    .neq("status", "pending");

  for (const r of (orphans ?? []) as { id: string; name: string; branch_label: string }[]) {
    if (covered.has(r.id)) continue;

    rows.push({
      id: null,
      restaurantId: r.id,
      restaurantName: r.name,
      branchLabel: r.branch_label,
      planName: "Aucun forfait",
      planTier: "starter",
      state: "none",
      startDate: null,
      endDate: null,
      daysRemaining: null,
      graceDays: 0,
    });
  }

  return rows.sort((a, b) => a.restaurantName.localeCompare(b.restaurantName));
}

/* ── Payment attempts ──────────────────────────────────────────────────── */

export interface PaymentAttemptRow {
  id: string;
  reference: string;
  transactionId: string | null;
  restaurantName: string;
  invoiceNumber: string;
  provider: string;
  method: string | null;
  phone: string | null;
  amount: number;
  status: "pending" | "succeeded" | "failed" | "abandoned";
  createdAt: string;
  settledAt: string | null;
}

export async function listPaymentAttempts(): Promise<PaymentAttemptRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("payment_attempts")
    .select(
      `id, reference, transaction_id, provider, method, phone, amount, status,
       created_at, settled_at,
       restaurants ( name ),
       invoices ( number )`,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return softFail("payment_attempts", error);

  interface Row {
    id: string;
    reference: string;
    transaction_id: string | null;
    provider: string;
    method: string | null;
    phone: string | null;
    amount: number;
    status: string;
    created_at: string;
    settled_at: string | null;
    restaurants: { name: string } | null;
    invoices: { number: string } | null;
  }

  return (data as unknown as Row[]).map((row) => ({
    id: row.id,
    reference: row.reference,
    transactionId: row.transaction_id,
    restaurantName: row.restaurants?.name ?? "—",
    invoiceNumber: row.invoices?.number ?? "—",
    provider: row.provider,
    method: row.method,
    phone: row.phone,
    amount: row.amount,
    status: row.status as PaymentAttemptRow["status"],
    createdAt: row.created_at,
    settledAt: row.settled_at,
  }));
}

/* ── Commission statements ─────────────────────────────────────────────── */

export interface CommissionRow {
  id: string;
  restaurantId: string;
  restaurantName: string;
  periodStart: string;
  periodEnd: string;
  orderCount: number;
  grossSales: number;
  /** Frozen at generation — changing the plan rate must not move this (§7). */
  commissionRate: number;
  commissionAmount: number;
  status: "draft" | "issued" | "settled" | "written_off";
}

export async function listCommissionStatements(): Promise<CommissionRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("commission_statements")
    .select(
      `id, restaurant_id, period_start, period_end, order_count, gross_sales,
       commission_rate, commission_amount, status,
       restaurants ( name )`,
    )
    .order("period_start", { ascending: false })
    .limit(200);

  if (error) return softFail("commission_statements", error);

  interface Row {
    id: string;
    restaurant_id: string;
    period_start: string;
    period_end: string;
    order_count: number;
    gross_sales: number;
    commission_rate: number;
    commission_amount: number;
    status: string;
    restaurants: { name: string } | null;
  }

  return (data as unknown as Row[]).map((row) => ({
    id: row.id,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurants?.name ?? "—",
    periodStart: row.period_start,
    periodEnd: row.period_end,
    orderCount: row.order_count,
    grossSales: row.gross_sales,
    commissionRate: Number(row.commission_rate),
    commissionAmount: row.commission_amount,
    status: row.status as CommissionRow["status"],
  }));
}

/* ── Refunds ───────────────────────────────────────────────────────────── */

export interface RefundRow {
  id: string;
  reference: string;
  restaurantName: string;
  type: "refund" | "chargeback";
  amount: number;
  reason: string;
  status: "pending" | "completed" | "rejected";
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
}

export async function listRefunds(): Promise<RefundRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("refunds")
    .select(
      `id, reference, type, amount, reason, status, created_by, created_at, completed_at,
       restaurants ( name )`,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return softFail("refunds", error);

  interface Row {
    id: string;
    reference: string;
    type: string;
    amount: number;
    reason: string;
    status: string;
    created_by: string;
    created_at: string;
    completed_at: string | null;
    restaurants: { name: string } | null;
  }

  return (data as unknown as Row[]).map((row) => ({
    id: row.id,
    reference: row.reference,
    restaurantName: row.restaurants?.name ?? "—",
    type: row.type as RefundRow["type"],
    amount: row.amount,
    reason: row.reason,
    status: row.status as RefundRow["status"],
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

/** Restaurants a refund can be raised against. */
export async function listRestaurantOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, name, branch_label")
    .order("name");

  if (error) return softFail("restaurants", error);

  return (data ?? []).map((r) => ({
    id: r.id,
    name:
      r.branch_label && r.branch_label !== "Principal" ? `${r.name} — ${r.branch_label}` : r.name,
  }));
}

/**
 * Plan ceilings, keyed by tier.
 *
 * Read from the database rather than a constant because an admin can change
 * what Professional includes at any time, and a hardcoded ceiling would keep
 * enforcing yesterday's number against today's price. `listPlans` is the wrong
 * call for this — it also counts subscribers per plan, which the menu page has
 * no use for.
 */
export interface PlanEntitlements {
  menuItemLimit: number | null;
  tableLimit: number | null;
  promotionLimit: number | null;
  /** Reports and analytics (§14.4). */
  analytics: boolean;
  staffManagement: boolean;
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS READ HAS NO `is_active` FILTER, AND THAT IS THE POINT.
 *
 *  `is_active` is the PUBLIC-VISIBILITY flag — 0004's RLS policy is literally
 *  "active plans are public" — not a statement that nobody is subscribed to a
 *  tier. Retiring a tier from the pricing page must not revoke what the
 *  restaurants still paying for it already bought.
 *
 *  `listPublicPlans()` DOES filter on it, correctly, because it feeds the
 *  marketing page. Reading an entitlement through the marketing query is how
 *  a paying Professional tenant gets told to buy Professional.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function fetchPlanLimits(): Promise<Map<string, PlanEntitlements>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("tier, menu_item_limit, table_limit, promotion_limit, analytics, staff_management");

  const map = new Map<string, PlanEntitlements>();

  if (error) {
    // Empty map, not a thrown error. A billing outage must not take the menu
    // page down with it; the caller falls back to no ceiling, which errs
    // towards letting a paying tenant work.
    console.error("[billing:fetchPlanLimits]", error.message);
    return map;
  }

  for (const p of (data ?? []) as {
    tier: string;
    menu_item_limit: number | null;
    table_limit: number | null;
    promotion_limit: number | null;
    analytics: boolean | null;
    staff_management: boolean | null;
  }[]) {
    map.set(p.tier, {
      menuItemLimit: p.menu_item_limit,
      tableLimit: p.table_limit,
      promotionLimit: p.promotion_limit,
      analytics: p.analytics ?? false,
      staffManagement: p.staff_management ?? false,
    });
  }

  return map;
}
