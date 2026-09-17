import "server-only";
import { getSettingsRows } from "@/lib/settings-map";
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
 *
 * The free-mode section at the bottom is the one exception to "reads": those
 * four settings rows are a state machine and it maintains its own.
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
  includedBranches: number;
  staffLimit: number;
  scheduledPayouts: boolean;
  prioritySupport: boolean;
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
    includedBranches: Number(p.included_branches ?? 1),
    staffLimit: Number(p.staff_limit ?? 0),
    scheduledPayouts: Boolean(p.scheduled_payouts),
    prioritySupport: Boolean(p.priority_support),
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

/* ── Free mode ─────────────────────────────────────────────────────────── */

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  FREE MODE IS A WINDOW, NOT A BOOLEAN — AND THIS SECTION OWNS ITS ROWS.
 *
 *  `platform_free_mode` (0005, flipped on by 0030) grants every tenant the
 *  paid-tier ceilings; `platform_free_mode_days` (0031) is the countdown the
 *  home page, the manager banner and the billing screen all advertise. The
 *  flag alone used to decide everything, so the advertised end date passed and
 *  the platform stayed free — the countdown was decoration.
 *
 *  The countdown's anchor is its own row rather than the days row's
 *  `updated_at`: `set_updated_at` fires on ANY save of that row, so an admin
 *  re-typing the same 30 restarted the clock without meaning to, and a
 *  settings screen that saves every field on submit restarted it on every
 *  save. An explicit anchor cannot be moved by accident.
 *
 *  `platform_free_mode_ended_at` is kept AFTER the lift on purpose: commission
 *  generation has to know which of last month's orders fell inside the
 *  giveaway, and a window whose end is deleted the moment it closes cannot
 *  answer that. Switching free mode back on starts a new window and clears it.
 *
 *  This is the one part of this module that WRITES. The four rows are a state
 *  machine, and a state machine split across two files drifts: the anchor is
 *  adopted, the manual switch-off is stamped, and the durable lift is
 *  performed here, all against the same read.
 * ─────────────────────────────────────────────────────────────────────────
 */

const FREE_MODE_FLAG_KEY = "platform_free_mode";
const FREE_MODE_DAYS_KEY = "platform_free_mode_days";
const FREE_MODE_STARTED_KEY = "platform_free_mode_started_at";
const FREE_MODE_ENDED_KEY = "platform_free_mode_ended_at";

const DAY_MS = 86_400_000;

export interface FreeModeWindow {
  /** The flag as stored — what an admin last chose in /a/settings → Billing. */
  flagOn: boolean;
  /** The flag AND the countdown. THIS is what the platform must behave as. */
  effective: boolean;
  /** Countdown length in days. 0 = free until further notice. */
  days: number;
  /** When the current — or, once lifted, the most recent — window opened. */
  startedAt: string | null;
  /** Its end: the countdown's end while it runs, the recorded end once closed. */
  endsAt: string | null;
  /** Flag still on, countdown spent. `runSubscriptionExpiry` owes the lift. */
  elapsed: boolean;
}

const FREE_MODE_OFF: FreeModeWindow = {
  flagOn: false,
  effective: false,
  days: 0,
  startedAt: null,
  endsAt: null,
  elapsed: false,
};

/** An ISO timestamp, or null when the row is empty or unparseable. */
function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

function countdownEnd(startedAt: string, days: number): string | null {
  return days > 0 ? new Date(Date.parse(startedAt) + days * DAY_MS).toISOString() : null;
}

/** Update-then-insert, because the row may predate the migration that seeds it. */
async function rememberSetting(key: string, value: string, label: string): Promise<void> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("settings")
    .update({ value })
    .eq("key", key)
    .select("key")
    .maybeSingle();

  if (error) {
    console.error("[billing:rememberSetting]", key, error.message);
    return;
  }
  if (data) return;

  const { error: insertError } = await supabase.from("settings").insert({
    key,
    value,
    value_type: "string",
    category: "billing",
    label,
    description: "Maintained by the platform — the free-mode window. Not typed by hand.",
  });

  // 23505 is another request having created the same row a moment earlier,
  // which is the outcome we wanted anyway.
  if (insertError && insertError.code !== "23505") {
    console.error("[billing:rememberSetting] insert", key, insertError.message);
  }
}

/**
 * The whole free-mode state, resolved in one read.
 *
 * Everything else in the app goes through `isFreeMode()`, `freeModeEndsAt()`
 * or `getFreeModeInfo()`, which are all thin views of this — so the entitlement
 * map, the banner, the pricing page and the commission run cannot disagree
 * about whether today is free.
 */
export async function getFreeModeWindow(): Promise<FreeModeWindow> {
  /*
    THE FOURTH MODULE THAT WAS READING `settings` ON ITS OWN.

    Branding, appearance and the cart config were the three the audit named;
    this one is reached from the homepage through `getFreeModeInfo()` and made
    it four separate round trips to one 2.2 KB table before a byte rendered.
    It selected `updated_at` too and never read it.

    Through the shared map it costs nothing: an unreadable settings table
    yields an empty map, every lookup below falls back, and a giveaway is not
    the failure mode — same as the explicit error branch this replaces.
  */
  const rows = await getSettingsRows();

  const flagOn = rows.get(FREE_MODE_FLAG_KEY)?.value === "true";
  const rawDays = Number(rows.get(FREE_MODE_DAYS_KEY)?.value ?? 0);
  const days = Number.isFinite(rawDays) ? Math.max(0, Math.round(rawDays)) : 0;

  const startedAt = isoOrNull(rows.get(FREE_MODE_STARTED_KEY)?.value);
  const endedAt = isoOrNull(rows.get(FREE_MODE_ENDED_KEY)?.value);
  const now = Date.now();

  if (!flagOn) {
    if (startedAt && !endedAt) {
      // Switched off by hand, with nothing recording when the giveaway stopped.
      const countdown = countdownEnd(startedAt, days);
      const stopped = new Date(
        countdown ? Math.min(now, Date.parse(countdown)) : now,
      ).toISOString();
      await rememberSetting(FREE_MODE_ENDED_KEY, stopped, "Free mode ended");
      return { flagOn, effective: false, days, startedAt, endsAt: stopped, elapsed: false };
    }
    return { flagOn, effective: false, days, startedAt, endsAt: endedAt, elapsed: false };
  }

  let anchor = startedAt;

  if (!anchor || endedAt) {
    /**
     * Either nothing was ever anchored — the flag predates this row, so the
     * days row's own timestamp is adopted and the countdown people have been
     * reading stays exactly where it was — or the previous window is closed and
     * the admin has switched free mode on again, which starts a new one.
     */
    anchor = endedAt
      ? new Date(now).toISOString()
      : (isoOrNull(rows.get(FREE_MODE_DAYS_KEY)?.updatedAt) ?? new Date(now).toISOString());

    await rememberSetting(FREE_MODE_STARTED_KEY, anchor, "Free mode started");
    if (endedAt) await rememberSetting(FREE_MODE_ENDED_KEY, "", "Free mode ended");
  }

  const endsAt = countdownEnd(anchor, days);
  const elapsed = endsAt !== null && now >= Date.parse(endsAt);

  return { flagOn: true, effective: !elapsed, days, startedAt: anchor, endsAt, elapsed };
}

/**
 * Persist the lift: the countdown ran out, so the FLAG goes false.
 *
 * Called by the daily lifecycle job. `getFreeModeWindow()` already reports the
 * platform as paid the instant the countdown passes, so this is not what stops
 * the giveaway — it is what makes the stop visible in /a/settings, and what
 * closes the window for commission generation.
 *
 * Compare-and-swap on the flag: whichever run flips `true → false` gets the
 * row back and is the one that reports the lift. Two runs on the same day
 * cannot both claim it.
 */
export async function endFreeMode(endedAt: string): Promise<boolean> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("settings")
    .update({ value: "false" })
    .eq("key", FREE_MODE_FLAG_KEY)
    .eq("value", "true")
    .select("key")
    .maybeSingle();

  if (error) {
    console.error("[billing:endFreeMode]", error.message);
    return false;
  }
  if (!data) return false;

  await rememberSetting(FREE_MODE_ENDED_KEY, endedAt, "Free mode ended");
  return true;
}

/**
 * Is the platform free RIGHT NOW?
 *
 * Every tenant, whatever their tier, gets the paid-tier ceilings while this is
 * true. The plan-gate screens and the sidebar locks consult it too, so a free
 * platform shows no "upgrade" nudges at all.
 */
export async function isFreeMode(): Promise<boolean> {
  return (await getFreeModeWindow()).effective;
}

/** When free mode ends, as an ISO date — null when it is not running, or never ends. */
export async function freeModeEndsAt(): Promise<string | null> {
  const window = await getFreeModeWindow();
  return window.effective ? window.endsAt : null;
}

/**
 * The plan every restaurant is SHOWN as while free mode runs, or null.
 *
 * `fetchPlanLimits` already grants every tenant the richest paid tier's
 * entitlements during free mode — but screens still named the plan on file,
 * so a restaurant approved during the giveaway read "Starter" while holding
 * Enterprise's features, and could not tell what it had. This names the tier
 * it is actually getting: the most expensive non-Starter plan.
 */
export async function freeModePlanName(): Promise<string | null> {
  if (!(await isFreeMode())) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("name")
    .neq("tier", "starter")
    .order("monthly_price", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[billing:freeModePlanName]", error.message);
    return null;
  }
  return (data as { name: string } | null)?.name ?? null;
}

/**
 * The home-page announcement: is free mode on, and for how long.
 *
 * `active` is the EFFECTIVE state, so the banner stops advertising a free
 * platform the moment the countdown it advertises runs out — with or without
 * the daily job having flipped the flag yet. 0 days means free until further
 * notice, so the UI can say either "for {days} days" or "until {date}".
 */
export interface FreeModeInfo {
  active: boolean;
  days: number;
  endsAt: string | null;
}

export async function getFreeModeInfo(): Promise<FreeModeInfo> {
  const window = await getFreeModeWindow();
  return {
    active: window.effective,
    days: window.days,
    endsAt: window.effective ? window.endsAt : null,
  };
}

/**
 * Which payment mode the platform is in: `sandbox` (simulated, no money
 * moves) or `live` (real charges through CamerPay). Simulation is opt-in:
 * an absent/unreadable setting must never manufacture a successful payment.
 */
export async function paymentMode(): Promise<"sandbox" | "live"> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "payment_mode")
    .maybeSingle();

  if (error) console.error("[billing:paymentMode]", error.message);
  if (data?.value === "sandbox") return "sandbox";
  return "live";
}

/** The more permissive of two ceilings — `null` means unlimited. */
function mostPermissive(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.max(a, b);
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
 *
 *  FREE MODE IS APPLIED HERE, not in the callers. When it is on, every tier
 *  maps to the most generous non-Starter entitlements — one place decides it,
 *  so the menu ceiling, the table ceiling, the reports gate and the staff
 *  gate cannot drift apart about what "free" means.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function fetchPlanLimits(): Promise<Map<string, PlanEntitlements>> {
  const supabase = createAdminClient();
  const [result, freeMode] = await Promise.all([
    supabase
      .from("subscription_plans")
      .select("tier, menu_item_limit, table_limit, promotion_limit, analytics, staff_management"),
    isFreeMode(),
  ]);
  const { data, error } = result;

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

  if (freeMode) {
    // The richest non-Starter tier becomes what EVERY tier gets. If the paid
    // tiers table is empty there is nothing to grant and the map stays as-is.
    let granted: PlanEntitlements | null = null;
    for (const [tier, entitlements] of map) {
      if (tier === "starter") continue;
      granted = granted
        ? {
            menuItemLimit: mostPermissive(granted.menuItemLimit, entitlements.menuItemLimit),
            tableLimit: mostPermissive(granted.tableLimit, entitlements.tableLimit),
            promotionLimit: mostPermissive(granted.promotionLimit, entitlements.promotionLimit),
            analytics: granted.analytics || entitlements.analytics,
            staffManagement: granted.staffManagement || entitlements.staffManagement,
          }
        : { ...entitlements };
    }

    if (granted) {
      for (const tier of map.keys()) map.set(tier, granted);
    }
  }

  return map;
}
