import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { endFreeMode, getFreeModeWindow } from "./billing";

/**
 * The daily subscription clock: renewals, reminders, expiry, free-mode lift.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  DELIBERATELY NOT A SERVER ACTION.
 *
 *  Same rule as invoice-activation.ts and payments/collect.ts: an exported
 *  function in a `"use server"` module is a POST endpoint, and this one raises
 *  invoices and turns free mode off for the whole platform. It is a plain
 *  module called by /api/cron/expire (bearer-protected) and by nothing else.
 *
 *  IT INVENTS NO STATES. active / grace / locked / cancelled is what the
 *  `subscription_state` view derives from end_date + grace_days + now()
 *  (0004, 0010), and this job reads that view rather than recomputing it —
 *  a second state machine would disagree with the banner the tenant is
 *  looking at, and the disagreement is money.
 *
 *  WHAT IT ACTUALLY CHANGES:
 *    · `settings.platform_free_mode` — false, once the countdown has passed.
 *    · `subscriptions.end_date` — only for the free-mode grants repaired at
 *      the lift (a paid plan that was handed out with no billing date).
 *    · `invoices` — one unpaid renewal invoice per tenant per plan, never two.
 *  Nothing else. Expiry itself is not a write: a subscription is locked
 *  because its end date passed, not because a job said so.
 *
 *  IDEMPOTENT, TWICE OVER:
 *    · invoices — an unpaid invoice for the same tenant and plan is REUSED,
 *      so a second run raises nothing.
 *    · notifications — the run cursor below is claimed with a
 *      compare-and-swap; a second run inside the same day loses the claim and
 *      sends nothing while still doing the invoice work.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** How many subscriptions one run may examine. A sweep is not a migration. */
const BATCH = 200;

/** An invoice is raised this many days before the subscription's end date. */
const RENEWAL_LEAD_DAYS = 7;

/** Days remaining on which a reminder goes out. Every day would be nagging. */
const REMINDER_ON_DAYS = new Set([7, 3, 1]);

/** One plan month — the same period activateFromInvoice() grants. */
const PERIOD_DAYS = 30;

const DAY_MS = 86_400_000;

/** A second run inside this window is a repeat: it notifies nobody. */
const REPEAT_RUN_MS = 12 * 60 * 60 * 1000;

/**
 * How far back a run will look for tenants that have just lapsed. A job that
 * has been down for a month must not wake up and announce a month of expiries.
 */
const MAX_LOOKBACK_MS = 3 * DAY_MS;

const LAST_RUN_KEY = "subscription_expiry_last_run";

export interface ExpiryRunResult {
  /** Subscriptions observed lapsing past their grace window since the last run. */
  expired: number;
  remindersSent: number;
  renewalInvoices: number;
  freeModeLifted: boolean;
}

/* ── Invoices ──────────────────────────────────────────────────────────── */

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

/**
 * THE tenant's payable invoice for a plan — raised if it does not exist yet.
 *
 * ONE UNPAID INVOICE PER TENANT PER PLAN, EVER. A hesitant tenant clicking
 * "choose plan" six times, plus a nightly renewal sweep, plus an admin
 * prompting them, otherwise stack six invoices for one month of service and
 * whichever one they pay decides how much they were charged.
 *
 * Called by `choosePlan` (the tenant picking a plan) and by the renewal sweep
 * below, so both surfaces agree about what "you owe one month" looks like.
 * The period recorded is billing history only — `activateFromInvoice` grants a
 * month from the moment it is PAID, never from the period on the invoice.
 */
export async function ensureUnpaidInvoice(input: {
  restaurantId: string;
  planId: string;
  amount: number;
  /** Where the billed period starts. Defaults to now. */
  from?: Date;
}): Promise<UnpaidInvoice | null> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("invoices")
    .select("id, number, amount")
    .eq("restaurant_id", input.restaurantId)
    .eq("plan_id", input.planId)
    .eq("status", "unpaid")
    .order("issued_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id as string,
      number: existing.number as string,
      amount: existing.amount as number,
      created: false,
    };
  }

  const periodStart = input.from ?? new Date();
  const periodEnd = new Date(periodStart.getTime() + PERIOD_DAYS * DAY_MS);

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      number: invoiceNumber(),
      restaurant_id: input.restaurantId,
      plan_id: input.planId,
      amount: Math.round(input.amount),
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
    })
    .select("id, number, amount")
    .single();

  if (error || !invoice) {
    console.error("[lifecycle:ensureUnpaidInvoice]", input.restaurantId, error?.message);
    return null;
  }

  return {
    id: invoice.id as string,
    number: invoice.number as string,
    amount: invoice.amount as number,
    created: true,
  };
}

/* ── The run cursor ────────────────────────────────────────────────────── */

interface RunClaim {
  /** Won the day's claim — this run is the one that speaks. */
  announce: boolean;
  /** Everything that lapsed after this instant is NEW to this run. */
  since: Date;
}

/**
 * Claim the day.
 *
 * The cursor is a settings row rather than a column on `subscriptions`,
 * because what is being deduplicated is the RUN, not any one tenant: two
 * scheduler invocations landing minutes apart (a Vercel cron and a pg_cron job
 * both configured, a manual curl, a retry) must not send the same reminder
 * twice to everybody.
 *
 * The claim is a compare-and-swap on the value we just read, so the loser of a
 * race skips its notifications instead of racing the winner's.
 */
async function claimRun(now: Date): Promise<RunClaim> {
  const supabase = createAdminClient();
  const floor = new Date(now.getTime() - MAX_LOOKBACK_MS);

  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", LAST_RUN_KEY)
    .maybeSingle();

  if (error) {
    console.error("[lifecycle:claimRun]", error.message);
    return { announce: false, since: floor };
  }

  const raw = (data?.value ?? null) as string | null;
  const parsed = raw ? Date.parse(raw) : NaN;
  const previous = Number.isFinite(parsed) ? new Date(parsed) : null;
  const since = previous && previous > floor ? previous : floor;

  if (previous && now.getTime() - previous.getTime() < REPEAT_RUN_MS) {
    return { announce: false, since };
  }

  const nowIso = now.toISOString();

  if (!data) {
    const { error: insertError } = await supabase.from("settings").insert({
      key: LAST_RUN_KEY,
      value: nowIso,
      value_type: "string",
      category: "operations",
      label: "Subscription sweep last run",
      description: "Maintained by /api/cron/expire. Stops a repeated run re-notifying everyone.",
    });
    // 23505 means another run created it first, and that run owns the day.
    return { announce: !insertError, since };
  }

  // PostgREST spells a null comparison `is`; `.eq(col, null)` matches no row.
  const claim = supabase.from("settings").update({ value: nowIso }).eq("key", LAST_RUN_KEY);
  const { data: won } = await (raw === null ? claim.is("value", null) : claim.eq("value", raw))
    .select("key")
    .maybeSingle();

  return { announce: Boolean(won), since };
}

/* ── Free mode ─────────────────────────────────────────────────────────── */

/**
 * The free-mode grants, given a billing date at last.
 *
 * A tenant who switched to a paid plan while the platform was free was given
 * `end_date = null`, which means NEVER EXPIRES everywhere else in the system —
 * so the giveaway would have outlived free mode by exactly forever. At the
 * lift they get the moment free mode ended as their end date: the ordinary
 * grace window starts from there, the sweep below raises their first real
 * invoice, and nobody is locked out without having been billed once.
 *
 * The update is conditional on `end_date` still being null, so a tenant who
 * paid in the same minute keeps the month they bought.
 */
async function repairFreeModeGrants(endedAt: string): Promise<void> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, subscription_plans ( monthly_price )")
    .is("end_date", null)
    .is("cancelled_at", null)
    .limit(BATCH);

  if (error) {
    console.error("[lifecycle:repairFreeModeGrants]", error.message);
    return;
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    subscription_plans: { monthly_price: number } | null;
  }[];

  for (const row of rows) {
    // A free plan with no end date is correct and stays that way.
    if ((row.subscription_plans?.monthly_price ?? 0) <= 0) continue;

    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({ end_date: endedAt })
      .eq("id", row.id)
      .is("end_date", null);

    if (updateError) {
      console.error("[lifecycle:repairFreeModeGrants] update", row.id, updateError.message);
    }
  }
}

/* ── The run ───────────────────────────────────────────────────────────── */

interface StateRow {
  id: string;
  restaurant_id: string;
  plan_id: string;
  end_date: string | null;
  grace_days: number;
  state: string;
  days_remaining: number | null;
  restaurants: { name: string; status: string } | null;
  subscription_plans: { name: string; monthly_price: number } | null;
}

export async function runSubscriptionExpiry(): Promise<ExpiryRunResult> {
  const supabase = createAdminClient();
  const now = new Date();

  const result: ExpiryRunResult = {
    expired: 0,
    remindersSent: 0,
    renewalInvoices: 0,
    freeModeLifted: false,
  };

  /* ── 1. Has the free-mode countdown run out? ─────────────────────────── */

  const freeMode = await getFreeModeWindow();

  if (freeMode.elapsed && freeMode.endsAt) {
    result.freeModeLifted = await endFreeMode(freeMode.endsAt);
    if (result.freeModeLifted) await repairFreeModeGrants(freeMode.endsAt);
  }

  /**
   * While the platform is free NOTHING is billable — no invoice, no reminder,
   * no expiry notice. Raising an invoice during a giveaway and then telling the
   * tenant they are late for it is the fastest way to lose them.
   */
  if (freeMode.effective) return result;

  /* ── 2. Claim the day ────────────────────────────────────────────────── */

  const run = await claimRun(now);

  /* ── 3. Renewals, reminders, expiry ──────────────────────────────────── */

  const horizon = new Date(now.getTime() + RENEWAL_LEAD_DAYS * DAY_MS).toISOString();

  const { data, error } = await supabase
    .from("subscription_state")
    .select(
      `id, restaurant_id, plan_id, end_date, grace_days, state, days_remaining,
       restaurants ( name, status ),
       subscription_plans ( name, monthly_price )`,
    )
    .not("end_date", "is", null)
    .is("cancelled_at", null)
    .lt("end_date", horizon)
    // Newest end dates first: the tenants whose renewal is imminent or whose
    // month has just lapsed are the ones a run must never miss. Long-locked
    // tenants already hold their invoice from the run that caught them, so
    // they are the safe end of the batch to cut.
    .order("end_date", { ascending: false })
    .limit(BATCH);

  if (error) {
    console.error("[lifecycle:runSubscriptionExpiry]", error.message);
    return result;
  }

  for (const row of (data ?? []) as unknown as StateRow[]) {
    const price = row.subscription_plans?.monthly_price ?? 0;

    // Nothing to renew on a free plan, and a suspended restaurant is the
    // platform's decision, not a billing event — suspension overrides all (§5).
    if (price <= 0) continue;
    if (row.restaurants && row.restaurants.status !== "active") continue;

    const endDate = row.end_date ? new Date(row.end_date) : null;
    if (!endDate) continue;

    const invoice = await ensureUnpaidInvoice({
      restaurantId: row.restaurant_id,
      planId: row.plan_id,
      amount: price,
      // Billed from where the current month ends, unless that is already past.
      from: endDate.getTime() > now.getTime() ? endDate : now,
    });

    if (invoice?.created) result.renewalInvoices += 1;

    /**
     * The moment the grace window closes — the transition the view calls
     * `locked`. Counted only when it happened SINCE THE LAST RUN, so a tenant
     * who has been locked for a fortnight is not re-counted and re-told every
     * night.
     */
    const lockedAt = endDate.getTime() + row.grace_days * DAY_MS;
    const newlyLocked =
      row.state === "locked" && lockedAt <= now.getTime() && lockedAt >= run.since.getTime();

    if (newlyLocked) result.expired += 1;
    if (!run.announce || !invoice) continue;

    const planName = row.subscription_plans?.name ?? "votre forfait";
    const amount = invoice.amount.toLocaleString("fr-CM");
    const due = endDate.toLocaleDateString("fr-CM");

    /**
     * ONE MESSAGE PER TENANT PER RUN, and only on the days that earn one:
     * seven, three and one day out, every day of the grace window (it is the
     * last chance), and once when the window closes. A tenant reminded every
     * night for a week stops reading the reminders.
     *
     * The expiry notice is counted under `expired`, not `remindersSent` — it
     * is the news that service stopped, not a nudge to pay early.
     */
    if (row.state === "locked") {
      if (!newlyLocked) continue;

      await notify({
        event: "billing",
        tone: "error",
        restaurantId: row.restaurant_id,
        href: "/m/billing",
        params: {
          detail: `Votre abonnement ${planName} a expiré. Réglez la facture ${invoice.number} (${amount} FCFA) pour le réactiver.`,
        },
      });
      continue;
    }

    const inGrace = row.state === "grace";
    const daysLeft = row.days_remaining;
    if (!inGrace && !(daysLeft !== null && REMINDER_ON_DAYS.has(daysLeft))) continue;

    await notify({
      event: "billing",
      tone: inGrace ? "warning" : "info",
      restaurantId: row.restaurant_id,
      href: "/m/billing",
      params: {
        detail: inGrace
          ? `Votre abonnement ${planName} a expiré le ${due} et vous êtes en période de grâce. Facture ${invoice.number} (${amount} FCFA) à régler.`
          : `Votre abonnement ${planName} expire le ${due}. Facture ${invoice.number} (${amount} FCFA) à régler.`,
      },
    });
    result.remindersSent += 1;
  }

  return result;
}
