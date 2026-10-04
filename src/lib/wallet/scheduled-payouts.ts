import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { isMissingColumn } from "@/lib/data/missing-column";
import { paymentMode } from "@/lib/data/billing";
import { ordersInProgressHold } from "@/lib/data/wallet";
import { DICTIONARIES, interpolate } from "@/lib/i18n/dictionaries";
import { requireConfirmedRecipient } from "@/lib/payments/recipient";
import { executeWithdrawal, type Translate } from "@/lib/payments/withdraw-execute";
import { getPayoutAccount, notifyOwners } from "./controls";
import { maskPhone } from "./withdraw-rules";
import { scheduleDue, scheduledAmount, type PayoutFrequency } from "./schedule-rules";

/**
 * Scheduled payouts — the Enterprise feature that was advertised and never
 * built (0074).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  DELIBERATELY NOT A SERVER ACTION: it sends money. Run by the five-minute
 *  /api/cron/reconcile — called only when cron_due_payments() finds a
 *  schedule whose hour has come (0075) — and by the daily /api/cron/expire as
 *  a net. Both are bearer-protected; nothing else calls it.
 *
 *  A schedule is an OWNER's standing instruction, set with their PIN. Each
 *  night it re-checks everything a person would be checked for, and stops
 *  rather than guess:
 *
 *    · the restaurant is running (a paused or suspended branch sends nothing);
 *    · its plan — the REAL one, not free mode — includes scheduled payouts,
 *      and the subscription is live;
 *    · the owner who set it is still an active owner there;
 *    · the number is still one of the owner's saved numbers, and (in live
 *      mode) the operator still names the holder it was saved with.
 *
 *  The payout itself goes through executeWithdrawal — the same claim, debit,
 *  send and stamp as a withdrawal made by hand — recorded as the owner's,
 *  and announced to every owner like any other.
 *
 *  Claimed per schedule per day (compare-and-swap on last_run_at), so a
 *  second run of the job the same night sends nothing twice.
 * ─────────────────────────────────────────────────────────────────────────
 */

const db = () => createAdminClient();

/** The night run has no viewer: French, the restaurant side's language. */
const frenchT: Translate = (key, vars) => interpolate(DICTIONARIES.fr[key] ?? key, vars);

export interface ScheduleRow {
  restaurantId: string;
  enabled: boolean;
  frequency: PayoutFrequency;
  weekday: number | null;
  /** 0–23 Douala; null before 0075 (the nightly hour applies). */
  hour: number | null;
  payoutAccountId: string;
  keepAmount: number;
  minAmount: number;
  setBy: string;
  lastRunAt: string | null;
  lastResult: string | null;
}

function toSchedule(row: Record<string, unknown>): ScheduleRow {
  return {
    restaurantId: String(row.restaurant_id),
    enabled: Boolean(row.enabled),
    frequency: row.frequency as PayoutFrequency,
    weekday: row.weekday === null || row.weekday === undefined ? null : Number(row.weekday),
    hour: row.hour === null || row.hour === undefined ? null : Number(row.hour),
    payoutAccountId: String(row.payout_account_id),
    keepAmount: Number(row.keep_amount ?? 0),
    minAmount: Number(row.min_amount ?? 5000),
    setBy: String(row.set_by),
    lastRunAt: (row.last_run_at as string | null) ?? null,
    lastResult: (row.last_result as string | null) ?? null,
  };
}

/** This restaurant's schedule; `ready` false before 0074. */
export async function loadSchedule(restaurantId: string): Promise<{ ready: boolean; schedule: ScheduleRow | null }> {
  const { data, error } = await db().from("scheduled_payouts").select("*").eq("restaurant_id", restaurantId).maybeSingle();
  if (error) {
    if (!isMissingColumn(error)) console.error("[payouts:load]", error.message);
    return { ready: false, schedule: null };
  }
  return { ready: true, schedule: data ? toSchedule(data as Record<string, unknown>) : null };
}

/**
 * Does this restaurant's REAL plan include scheduled payouts, live?
 *
 * Read from subscription_state (a branch reads its main's plan, 0072) and
 * the plan row — never from the free-mode entitlement map: a schedule sends
 * real money, and only a plan that sells it may run one.
 */
export async function scheduleEntitled(restaurantId: string): Promise<boolean> {
  const supabase = db();
  const { data: sub } = await supabase
    .from("subscription_state")
    .select("plan_id, state")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (!sub?.plan_id || (sub.state !== "active" && sub.state !== "grace")) return false;
  const { data: plan } = await supabase.from("subscription_plans").select("scheduled_payouts").eq("id", sub.plan_id).maybeSingle();
  return Boolean((plan as { scheduled_payouts?: boolean } | null)?.scheduled_payouts);
}

async function record(restaurantId: string, result: string, disable = false) {
  await db()
    .from("scheduled_payouts")
    .update(disable ? { last_result: result, enabled: false } : { last_result: result })
    .eq("restaurant_id", restaurantId);
}

export interface PayoutRunResult {
  due: number;
  sent: number;
  skipped: number;
  failed: number;
}

export async function runScheduledPayouts(now = new Date()): Promise<PayoutRunResult> {
  const result: PayoutRunResult = { due: 0, sent: 0, skipped: 0, failed: 0 };
  const supabase = db();

  const { data, error } = await supabase.from("scheduled_payouts").select("*").eq("enabled", true).limit(500);
  if (error) {
    if (!isMissingColumn(error)) console.error("[payouts:run]", error.message);
    return result;
  }

  const mode = await paymentMode();

  for (const schedule of ((data ?? []) as Record<string, unknown>[]).map(toSchedule)) {
    if (!scheduleDue(schedule, now)) continue;

    // Claim today's run: the second job of the night finds it taken.
    const claim = supabase.from("scheduled_payouts").update({ last_run_at: now.toISOString() }).eq("restaurant_id", schedule.restaurantId);
    const { data: claimed } = await (schedule.lastRunAt ? claim.eq("last_run_at", schedule.lastRunAt) : claim.is("last_run_at", null))
      .select("restaurant_id")
      .maybeSingle();
    if (!claimed) continue;
    result.due += 1;

    try {
      const outcome = await runOne(schedule, mode);
      if (outcome === "sent") result.sent += 1;
      else if (outcome === "failed") result.failed += 1;
      else result.skipped += 1;
    } catch (caught) {
      console.error("[payouts:run] schedule", schedule.restaurantId, caught instanceof Error ? caught.message : caught);
      await record(schedule.restaurantId, "Erreur inattendue — réessai à la prochaine échéance.");
      result.failed += 1;
    }
  }

  return result;
}

async function runOne(schedule: ScheduleRow, mode: "sandbox" | "live"): Promise<"sent" | "skipped" | "failed"> {
  const supabase = db();
  const { restaurantId } = schedule;

  const { data: restaurant } = await supabase.from("restaurants").select("status").eq("id", restaurantId).maybeSingle();
  if ((restaurant as { status?: string } | null)?.status !== "active") {
    await record(restaurantId, "Établissement en pause : aucun retrait.");
    return "skipped";
  }

  if (!(await scheduleEntitled(restaurantId))) {
    await record(restaurantId, "Votre formule n'inclut plus les retraits programmés.");
    return "skipped";
  }

  // Still an owner there? The payout is theirs; a former owner's standing
  // instruction must not keep sending money.
  /*
    ─────────────────────────────────────────────────────────────────────────
     THE EMBED NAMES ITS FOREIGN KEY, AND A FAILED READ IS NOT A "NO".

     restaurant_staff points at profiles twice (`profile_id`, `invited_by`).
     This read used a bare `profiles ( … )`, which PostgREST refuses as
     ambiguous (PGRST201). The error was ignored, the missing row read as
     "no longer an owner", and every due run switched the owner's own
     schedule off and told them so (found 2026-10-05). Only an answer with
     no row means the person left; an error is recorded and the schedule
     stays on.
    ─────────────────────────────────────────────────────────────────────────
  */
  const { data: owner, error: ownerError } = await supabase
    .from("restaurant_staff")
    .select("profile_id, profiles!restaurant_staff_profile_id_fkey ( name, email, role )")
    .eq("restaurant_id", restaurantId)
    .eq("profile_id", schedule.setBy)
    .eq("role", "owner")
    .eq("status", "active")
    .maybeSingle();
  if (ownerError) {
    console.error("[payouts:run] owner", restaurantId, ownerError.message);
    await record(restaurantId, "Vérification du propriétaire impossible : aucun retrait cette fois.");
    return "failed";
  }
  const ownerProfile = (owner as unknown as { profiles: { name: string; email: string; role: string } | null } | null)?.profiles;
  if (!ownerProfile) {
    await record(restaurantId, "La personne qui a programmé ces retraits n'est plus propriétaire : programmation arrêtée.", true);
    await notifyOwners(restaurantId, {
      tone: "warning",
      withdrawalKind: "security",
      detail: "Les retraits programmés sont arrêtés : la personne qui les avait programmés n'est plus propriétaire. Programmez-les de nouveau si besoin.",
    });
    return "skipped";
  }

  const account = await getPayoutAccount(restaurantId, schedule.payoutAccountId);
  if (!account) {
    await record(restaurantId, "Le numéro choisi a été retiré : programmation arrêtée.", true);
    await notifyOwners(restaurantId, {
      tone: "warning",
      withdrawalKind: "security",
      detail: "Les retraits programmés sont arrêtés : leur numéro de retrait a été retiré. Choisissez-en un autre pour les reprendre.",
    });
    return "skipped";
  }

  const [walletResult, queuedResult, held] = await Promise.all([
    supabase.from("restaurant_wallets").select("balance").eq("restaurant_id", restaurantId).maybeSingle(),
    supabase.from("withdrawal_requests").select("amount").eq("restaurant_id", restaurantId).eq("status", "pending"),
    ordersInProgressHold(restaurantId),
  ]);
  const amount = scheduledAmount({
    balance: Number((walletResult.data as { balance?: number } | null)?.balance ?? 0),
    queued: ((queuedResult.data ?? []) as { amount: number }[]).reduce((sum, row) => sum + Number(row.amount), 0),
    held,
    keep: schedule.keepAmount,
    minimum: schedule.minAmount,
  });
  if (amount === 0) {
    await record(restaurantId, "Solde sous le minimum choisi : rien à envoyer cette fois.");
    return "skipped";
  }

  // The holder the owner confirmed when saving the number — asked again.
  let recipientName = account.holderName;
  if (mode === "live") {
    if (!account.holderName) {
      await record(restaurantId, "Numéro ajouté en mode test : à enregistrer de nouveau.");
      return "skipped";
    }
    const gate = await requireConfirmedRecipient(account.phone, account.holderName);
    if (!gate.ok) {
      await record(restaurantId, "Le titulaire du numéro n'a pas pu être confirmé : aucun retrait.");
      await notifyOwners(restaurantId, {
        tone: "warning",
        withdrawalKind: "security",
        detail: `Retrait programmé non envoyé : l'opérateur ne confirme plus le titulaire du ${maskPhone(account.phone)}. Vérifiez ce numéro.`,
      });
      return "failed";
    }
    recipientName = gate.name;
  }

  const { data: created, error } = await supabase
    .from("withdrawal_requests")
    .insert({
      restaurant_id: restaurantId,
      requested_by: schedule.setBy,
      amount,
      phone: account.phone,
      note: "Retrait programmé",
      recipient_name: recipientName,
      requester_role: "owner",
      payout_account_id: account.id,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[payouts:run] insert", restaurantId, error?.message);
    await record(restaurantId, "Le retrait n'a pas pu être créé.");
    return "failed";
  }

  const sent = await executeWithdrawal(
    String(created.id),
    { id: schedule.setBy, email: ownerProfile.email, role: ownerProfile.role },
    frenchT,
    restaurantId,
    { verifiedName: recipientName },
  );

  if (!sent.ok) {
    await record(restaurantId, `Échec : ${sent.error}`);
    await notifyOwners(restaurantId, {
      tone: "error",
      withdrawalKind: "sent",
      amount,
      detail: `Le retrait programmé de ${amount.toLocaleString("fr-CM")} FCFA n'a pas abouti : ${sent.error}`,
    });
    return "failed";
  }

  await record(restaurantId, `Envoyé : ${amount.toLocaleString("fr-CM")} FCFA vers ${maskPhone(account.phone)}.`);
  await notifyOwners(restaurantId, {
    tone: "info",
    withdrawalKind: "sent",
    amount,
    detail: `Retrait programmé : ${amount.toLocaleString("fr-CM")} FCFA envoyés vers ${maskPhone(account.phone)}${recipientName ? ` (${recipientName})` : ""}.`,
  });
  return "sent";
}

/** The daily sweep of old rate-limit windows (0074). Never throws. */
export async function sweepRateLimits(): Promise<void> {
  const cutoff = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { error } = await db().from("rate_limit_buckets").delete().lt("window_start", cutoff);
  if (error && !isMissingColumn(error)) console.error("[rate-limit:sweep]", error.message);
}
