"use server";

import { revalidatePath } from "next/cache";
import { getTranslator } from "@/lib/i18n/locale-server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireBranch, requireCapability } from "@/lib/auth/branch";
import { rateLimit } from "@/lib/rate-limit";
import { notify } from "@/lib/notify";
import { normalisePhone } from "@/lib/payments/camerpay/client";
import { requireConfirmedRecipient } from "@/lib/payments/recipient";
import { writeAudit } from "@/lib/audit";
import { paymentMode } from "./billing";
import { mainRestaurantId } from "@/lib/branches/account";
import { scheduleEntitled } from "@/lib/wallet/scheduled-payouts";
import { isMissingColumn } from "./missing-column";
import {
  checkWithdrawalPin,
  getPayoutAccount,
  notifyOwners,
  savePin,
  verifyAccountPassword,
  withdrawControlsReady,
} from "@/lib/wallet/controls";
import { canReceiveWithdrawRight, maskPhone, pinProblem, type BranchRoleName } from "@/lib/wallet/withdraw-rules";
import type { ActionResult } from "./admin-actions";

/**
 * Setting up who may withdraw, with what, to where (0073).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  OWNERS DECIDE, AND PROVE IT'S THEM. Granting the right to withdraw and
 *  adding a number money may go to are the two moves that would let someone
 *  else empty the wallet, so both take the owner's own withdrawal PIN — a
 *  phone left unlocked on the counter cannot be used to add a number and
 *  then withdraw to it. Revoking and removing (the safe direction) do not.
 *
 *  Not while impersonating: a platform admin never changes who controls a
 *  tenant's money from inside their account.
 *
 *  Every change is audited and announced: to the person concerned, and to
 *  the owners when it touches where money can go.
 * ─────────────────────────────────────────────────────────────────────────
 */

type Result = ActionResult & { reason?: string };

/* ── The PIN ───────────────────────────────────────────────────────────── */

/**
 * Set or change one's own withdrawal PIN, proven with the account password.
 * Forgot the PIN: the same screen — the password is what proves it is you.
 * Forgot both: reset the password by email first.
 */
export async function setWithdrawalPin(input: { password: string; pin: string }): Promise<Result> {
  const t = await getTranslator();
  const context = await requireCapability("finance.manage");
  const { profile, active } = context;

  if (context.impersonating) return { ok: false, reason: "impersonating", error: t("est.withdrawImpersonating") };
  if (!(await withdrawControlsReady())) {
    return { ok: false, reason: "controlsMissing", error: t("est.withdrawControlsMissing") };
  }

  const problem = pinProblem(input.pin.trim());
  if (problem) {
    return { ok: false, reason: problem, error: t(problem === "format" ? "mwd.err.pinFormat" : "mwd.err.pinWeak") };
  }

  const limited = await rateLimit({ key: "wallet:pin-set", identifier: profile.id, limit: 5, windowMs: 60 * 60_000 });
  if (!limited.ok) return { ok: false, reason: "rateLimited", error: t("mwd.err.tooMany") };

  const password = await verifyAccountPassword(profile.email, input.password);
  if (password === "wrong") return { ok: false, reason: "password", error: t("mwd.err.password") };
  if (password === "unavailable") return { ok: false, reason: "unavailable", error: t("mwd.err.unavailable") };

  if (!(await savePin(profile.id, input.pin.trim()))) {
    return { ok: false, reason: "saveFailed", error: t("mwd.err.saveFailed") };
  }

  await writeAudit(profile, {
    action: "wallet.pin_set",
    entityType: "profile",
    entityId: profile.id,
    summary: `${profile.name} set their withdrawal PIN`,
  });

  const detail = `Le code de retrait de ${profile.name} vient d'être défini ou modifié. Si ce n'est pas vous, changez votre mot de passe et prévenez le propriétaire.`;
  await notify({ event: "withdrawal", tone: "warning", profileId: profile.id, href: "/m/wallet", params: { withdrawalKind: "security", detail } });
  if (active.role !== "owner") {
    await notifyOwners(active.restaurantId, { tone: "info", withdrawalKind: "security", detail }, profile.id);
  }

  revalidatePath("/m/wallet");
  return { ok: true, note: t("mwd.note.pinSaved") };
}

/* ── Owner checks ──────────────────────────────────────────────────────── */

/**
 * The caller must be an OWNER — at the active branch (grants are per
 * branch) or at the main restaurant (numbers are shared by all branches) —
 * not impersonating, and must type their own PIN.
 */
async function ownerWithPin(
  scope: "branch" | "account",
  pin: string,
): Promise<
  | { ok: true; context: Awaited<ReturnType<typeof requireBranch>>; accountId: string }
  | (Result & { ok: false })
> {
  const t = await getTranslator();
  const context = await requireBranch();

  if (context.impersonating) return { ok: false, reason: "impersonating", error: t("est.withdrawImpersonating") };
  if (!(await withdrawControlsReady())) {
    return { ok: false, reason: "controlsMissing", error: t("est.withdrawControlsMissing") };
  }

  const accountId = await mainRestaurantId(context.active.restaurantId);
  const where =
    scope === "branch"
      ? context.active
      : context.branches.find((branch) => branch.restaurantId === accountId);
  if (!where || where.role !== "owner") return { ok: false, reason: "notOwner", error: t("mwd.err.notOwner") };

  const check = await checkWithdrawalPin(context.profile.id, pin.trim(), {
    restaurantId: context.active.restaurantId,
    personName: context.profile.name,
  });
  if (!check.ok) {
    if (check.reason === "noPin") return { ok: false, reason: "noPin", error: t("est.withdrawNoPin") };
    if (check.reason === "locked") return { ok: false, reason: "pinLocked", error: t("mwd.err.pinLocked") };
    return { ok: false, reason: "pinWrong", error: t("est.withdrawPinWrong", { left: check.attemptsLeft }) };
  }

  return { ok: true, context, accountId };
}

/* ── The right ─────────────────────────────────────────────────────────── */

/**
 * Let a manager of THIS branch withdraw, optionally up to `dailyLimit` FCFA
 * over 24 hours. Granting again replaces the limit.
 */
export async function grantWithdrawalRight(input: {
  profileId: string;
  dailyLimit: number | null;
  pin: string;
}): Promise<Result> {
  const t = await getTranslator();
  const owner = await ownerWithPin("branch", input.pin);
  if (!owner.ok) return owner;
  const { context } = owner;

  const limit = input.dailyLimit === null ? null : Math.round(input.dailyLimit);
  if (limit !== null && (!Number.isInteger(limit) || limit < 500)) {
    return { ok: false, reason: "limit", error: t("mwd.err.limit") };
  }

  const supabase = createAdminClient();
  const { data: member, error: memberError } = await supabase
    .from("restaurant_staff")
    // Named FK: restaurant_staff → profiles is also `invited_by`, and a bare
    // `profiles ( … )` is refused as ambiguous (see lib/data/manager.ts) —
    // which turned every grant into "not a manager".
    .select("role, status, profiles!restaurant_staff_profile_id_fkey ( name )")
    .eq("restaurant_id", context.active.restaurantId)
    .eq("profile_id", input.profileId)
    .maybeSingle();
  if (memberError) {
    console.error("[wallet:grantRight] member", memberError.message);
    return { ok: false, reason: "saveFailed", error: t("mwd.err.saveFailed") };
  }

  const row = member as unknown as { role: string; status: string; profiles: { name: string } | null } | null;
  if (!row || row.status !== "active" || !canReceiveWithdrawRight(row.role as BranchRoleName)) {
    return { ok: false, reason: "notManager", error: t("mwd.err.notManager") };
  }

  const { error } = await supabase.from("withdrawal_permissions").upsert(
    {
      restaurant_id: context.active.restaurantId,
      profile_id: input.profileId,
      daily_limit: limit,
      granted_by: context.profile.id,
      granted_at: new Date().toISOString(),
    },
    { onConflict: "restaurant_id,profile_id" },
  );
  if (error) {
    console.error("[wallet:grantRight]", error.message);
    return { ok: false, reason: "saveFailed", error: t("mwd.err.saveFailed") };
  }

  const name = row.profiles?.name ?? "—";
  await writeAudit(context.profile, {
    action: "wallet.right_granted",
    entityType: "restaurant",
    entityId: context.active.restaurantId,
    summary: `${context.profile.name} let ${name} withdraw${limit ? ` (up to ${limit} XAF / 24h)` : ""}`,
    metadata: { profileId: input.profileId, dailyLimit: limit },
  });
  await notify({
    event: "withdrawal",
    tone: "info",
    profileId: input.profileId,
    href: "/m/wallet",
    params: {
      withdrawalKind: "rights",
      detail: limit
        ? `${context.profile.name} vous autorise à retirer jusqu'à ${limit.toLocaleString("fr-CM")} FCFA par 24 h. Créez votre code de retrait sur la page Portefeuille.`
        : `${context.profile.name} vous autorise à retirer. Créez votre code de retrait sur la page Portefeuille.`,
    },
  });

  revalidatePath("/m/wallet");
  return { ok: true, note: t("mwd.note.granted", { name }) };
}

/** Take the right back. Immediate; no PIN needed to make things safer. */
export async function revokeWithdrawalRight(profileId: string): Promise<Result> {
  const t = await getTranslator();
  const context = await requireBranch();
  if (context.impersonating) return { ok: false, reason: "impersonating", error: t("est.withdrawImpersonating") };
  if (context.active.role !== "owner") return { ok: false, reason: "notOwner", error: t("mwd.err.notOwner") };

  const { data, error } = await createAdminClient()
    .from("withdrawal_permissions")
    .delete()
    .eq("restaurant_id", context.active.restaurantId)
    .eq("profile_id", profileId)
    .select("id");
  if (error) {
    console.error("[wallet:revokeRight]", error.message);
    return { ok: false, reason: "saveFailed", error: t("mwd.err.saveFailed") };
  }
  if ((data ?? []).length === 0) return { ok: true };

  await writeAudit(context.profile, {
    action: "wallet.right_revoked",
    entityType: "restaurant",
    entityId: context.active.restaurantId,
    summary: `${context.profile.name} revoked a withdrawal right`,
    metadata: { profileId },
  });
  await notify({
    event: "withdrawal",
    tone: "info",
    profileId,
    href: "/m/wallet",
    params: { withdrawalKind: "rights", detail: `${context.profile.name} a retiré votre droit de retrait.` },
  });

  revalidatePath("/m/wallet");
  return { ok: true, note: t("mwd.note.revoked") };
}

/* ── The numbers ───────────────────────────────────────────────────────── */

/**
 * Save a number money may be sent to. The owner was shown the account
 * holder's name (verifyWithdrawalRecipient) and passes it back; the operator
 * is asked again here and must agree. In sandbox nothing is looked up.
 */
export async function addPayoutAccount(input: {
  phone: string;
  confirmedName: string | null;
  label?: string;
  pin: string;
}): Promise<Result> {
  const t = await getTranslator();
  const owner = await ownerWithPin("account", input.pin);
  if (!owner.ok) return owner;
  const { context, accountId } = owner;

  const phone = normalisePhone(input.phone);
  if (!phone) return { ok: false, reason: "badPhone", error: t("est.withdrawPhoneInvalid") };

  let holderName: string | null = null;
  if ((await paymentMode()) === "live") {
    const gate = await requireConfirmedRecipient(phone, input.confirmedName);
    if (!gate.ok) {
      return {
        ok: false,
        reason: gate.reason,
        error:
          gate.reason === "changed"
            ? t("est.recipientChanged", { name: gate.name ?? "?" })
            : gate.reason === "notIdentified"
              ? t("est.recipientUnidentified")
              : gate.reason === "badPhone"
                ? t("est.withdrawPhoneInvalid")
                : t("est.recipientUnavailable"),
      };
    }
    holderName = gate.name;
  }

  const { error } = await createAdminClient()
    .from("payout_accounts")
    .insert({
      account_id: accountId,
      phone,
      holder_name: holderName,
      label: input.label?.trim() || null,
      added_by: context.profile.id,
    });
  if (error) {
    if (error.code === "23505") return { ok: false, reason: "duplicate", error: t("mwd.err.duplicateNumber") };
    console.error("[wallet:addPayoutAccount]", error.message);
    return { ok: false, reason: "saveFailed", error: t("mwd.err.saveFailed") };
  }

  await writeAudit(context.profile, {
    action: "wallet.payout_number_added",
    entityType: "restaurant",
    entityId: accountId,
    summary: `${context.profile.name} added the payout number ${maskPhone(phone)}${holderName ? ` (${holderName})` : ""}`,
  });
  await notifyOwners(context.active.restaurantId, {
    tone: "warning",
    withdrawalKind: "security",
    detail: `${context.profile.name} a ajouté le numéro de retrait ${maskPhone(phone)}${holderName ? ` (${holderName})` : ""}. Les retraits peuvent désormais y être envoyés.`,
  });

  revalidatePath("/m/wallet");
  return { ok: true, note: t("mwd.note.numberAdded") };
}

/** Stop allowing a number. Kept as history (removed_at), never deleted. */
export async function removePayoutAccount(id: string): Promise<Result> {
  const t = await getTranslator();
  const context = await requireBranch();
  if (context.impersonating) return { ok: false, reason: "impersonating", error: t("est.withdrawImpersonating") };

  const accountId = await mainRestaurantId(context.active.restaurantId);
  const atMain = context.branches.find((branch) => branch.restaurantId === accountId);
  if (!atMain || atMain.role !== "owner") return { ok: false, reason: "notOwner", error: t("mwd.err.notOwner") };

  const { data, error } = await createAdminClient()
    .from("payout_accounts")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("account_id", accountId)
    .is("removed_at", null)
    .select("phone")
    .maybeSingle();
  if (error) {
    console.error("[wallet:removePayoutAccount]", error.message);
    return { ok: false, reason: "saveFailed", error: t("mwd.err.saveFailed") };
  }
  if (!data) return { ok: true };

  await writeAudit(context.profile, {
    action: "wallet.payout_number_removed",
    entityType: "restaurant",
    entityId: accountId,
    summary: `${context.profile.name} removed the payout number ${maskPhone(String(data.phone))}`,
  });

  revalidatePath("/m/wallet");
  return { ok: true, note: t("mwd.note.numberRemoved") };
}

/* ── Scheduled payouts (0074) ──────────────────────────────────────────── */

/**
 * Set (or change) this branch's scheduled payout — Enterprise.
 *
 * An owner's standing instruction to send money while they sleep, so it takes
 * the same proof as granting the right to withdraw: their own PIN. The plan
 * is checked here AND every night (scheduled-payouts.ts), so a downgrade
 * stops it without anyone remembering to.
 */
export async function saveScheduledPayout(input: {
  frequency: "daily" | "weekly" | "monthly";
  weekday: number | null;
  /** 0–23, Douala time (0075). */
  hour: number;
  payoutAccountId: string;
  keepAmount: number;
  minAmount: number;
  pin: string;
}): Promise<Result> {
  const t = await getTranslator();
  const owner = await ownerWithPin("branch", input.pin);
  if (!owner.ok) return owner;
  const { context } = owner;
  const restaurantId = context.active.restaurantId;

  if (!(await scheduleEntitled(restaurantId))) {
    return { ok: false, reason: "notInPlan", error: t("mwd.sch.err.notInPlan") };
  }
  if (!["daily", "weekly", "monthly"].includes(input.frequency)) {
    return { ok: false, reason: "frequency", error: t("mwd.err.saveFailed") };
  }
  if (input.frequency === "weekly" && (input.weekday === null || input.weekday < 0 || input.weekday > 6)) {
    return { ok: false, reason: "weekday", error: t("mwd.sch.err.weekday") };
  }
  const hour = Math.round(input.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { ok: false, reason: "hour", error: t("mwd.sch.err.hour") };
  }
  const keep = Math.round(input.keepAmount);
  const min = Math.round(input.minAmount);
  if (!Number.isInteger(keep) || keep < 0 || !Number.isInteger(min) || min < 500) {
    return { ok: false, reason: "amounts", error: t("mwd.sch.err.amounts") };
  }
  if (!(await getPayoutAccount(restaurantId, input.payoutAccountId))) {
    return { ok: false, reason: "accountMissing", error: t("est.withdrawAccountMissing") };
  }

  const row = {
    restaurant_id: restaurantId,
    enabled: true,
    frequency: input.frequency,
    weekday: input.frequency === "weekly" ? input.weekday : null,
    payout_account_id: input.payoutAccountId,
    keep_amount: keep,
    min_amount: min,
    set_by: context.profile.id,
    last_result: null,
  };
  const supabase = createAdminClient();
  let { error } = await supabase.from("scheduled_payouts").upsert({ ...row, hour }, { onConflict: "restaurant_id" });
  // Before 0075 there is no hour: the schedule runs with the nightly job.
  if (error && isMissingColumn(error, "hour")) {
    ({ error } = await supabase.from("scheduled_payouts").upsert(row, { onConflict: "restaurant_id" }));
  }
  if (error) {
    console.error("[wallet:saveSchedule]", error.message);
    return { ok: false, reason: "saveFailed", error: t("mwd.err.saveFailed") };
  }

  await writeAudit(context.profile, {
    action: "wallet.schedule_set",
    entityType: "restaurant",
    entityId: restaurantId,
    summary: `${context.profile.name} scheduled ${input.frequency} payouts (keep ${keep} XAF, minimum ${min} XAF)`,
  });
  await notifyOwners(restaurantId, {
    tone: "warning",
    withdrawalKind: "security",
    detail: `${context.profile.name} a programmé des retraits automatiques (${input.frequency === "daily" ? "chaque jour" : input.frequency === "weekly" ? "chaque semaine" : "chaque mois"}).`,
  });

  revalidatePath("/m/wallet");
  return { ok: true, note: t("mwd.sch.note.saved") };
}

/** Stop the schedule. No PIN: stopping money from moving is always allowed. */
export async function stopScheduledPayout(): Promise<Result> {
  const t = await getTranslator();
  const context = await requireBranch();
  if (context.impersonating) return { ok: false, reason: "impersonating", error: t("est.withdrawImpersonating") };
  if (context.active.role !== "owner") return { ok: false, reason: "notOwner", error: t("mwd.err.notOwner") };

  const { error } = await createAdminClient()
    .from("scheduled_payouts")
    .update({ enabled: false })
    .eq("restaurant_id", context.active.restaurantId);
  if (error) return { ok: false, reason: "saveFailed", error: t("mwd.err.saveFailed") };

  await writeAudit(context.profile, {
    action: "wallet.schedule_stopped",
    entityType: "restaurant",
    entityId: context.active.restaurantId,
    summary: `${context.profile.name} stopped scheduled payouts`,
  });

  revalidatePath("/m/wallet");
  return { ok: true, note: t("mwd.sch.note.stopped") };
}
