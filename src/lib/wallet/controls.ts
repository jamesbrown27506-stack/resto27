import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { isMissingColumn } from "@/lib/data/missing-column";
import { mainRestaurantId } from "@/lib/branches/account";
import { notify } from "@/lib/notify";
import { rateLimit } from "@/lib/rate-limit";
import type { BranchContext } from "@/lib/auth/branch";
import { hashPin, verifyPin } from "./pin-hash";
import {
  DAILY_WINDOW_MS,
  PIN_LOCK_MINUTES,
  PIN_MAX_ATTEMPTS,
  afterWrongPin,
  maskPhone,
  pinLocked,
  withdrawRight,
  type BranchRoleName,
  type WithdrawDelegate,
  type WithdrawRight,
} from "./withdraw-rules";

export type { WithdrawDelegate } from "./withdraw-rules";

/**
 * Withdrawal controls — the server side of lib/wallet/withdraw-rules.ts (0073).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  DELIBERATELY NOT A SERVER ACTION. These functions check PINs, read
 *  grants and decide who is told about money leaving; reachable from a URL
 *  they would be an oracle for guessing codes. The wallet actions call them.
 *
 *  FAIL CLOSED. Before 0073 is run there is no PIN table and no saved
 *  number, and a withdrawal is refused rather than allowed without them:
 *  a missing control is not a missing restriction.
 * ─────────────────────────────────────────────────────────────────────────
 */

const db = () => createAdminClient();

/** Has 0073 been run? Every control depends on it. */
export async function withdrawControlsReady(): Promise<boolean> {
  const { error } = await db().from("withdrawal_permissions").select("id").limit(1);
  if (!error) return true;
  if (!isMissingColumn(error)) console.error("[wallet:controlsReady]", error.message);
  return false;
}

/* ── The right ─────────────────────────────────────────────────────────── */

async function loadGrant(restaurantId: string, profileId: string): Promise<{ dailyLimit: number | null } | null> {
  const { data, error } = await db()
    .from("withdrawal_permissions")
    .select("daily_limit")
    .eq("restaurant_id", restaurantId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) {
    if (!isMissingColumn(error)) console.error("[wallet:loadGrant]", error.message);
    return null;
  }
  return data ? { dailyLimit: (data.daily_limit as number | null) ?? null } : null;
}

/** May the person in this context withdraw at its active branch? */
export async function resolveWithdrawRight(context: BranchContext): Promise<WithdrawRight> {
  const role = context.active.role as BranchRoleName;
  const grant = role === "manager" ? await loadGrant(context.active.restaurantId, context.profile.id) : null;
  return withdrawRight({ role, grant, impersonating: context.impersonating });
}

/** What a delegate already took out at this branch in the last 24 hours. */
export async function withdrawnInLast24h(restaurantId: string, profileId: string): Promise<number> {
  const since = new Date(Date.now() - DAILY_WINDOW_MS).toISOString();
  const { data } = await db()
    .from("withdrawal_requests")
    .select("amount")
    .eq("restaurant_id", restaurantId)
    .eq("requested_by", profileId)
    .in("status", ["pending", "paid"])
    .gte("requested_at", since);
  return ((data ?? []) as { amount: number }[]).reduce((sum, row) => sum + Number(row.amount), 0);
}

/** The branch's managers, and which of them may withdraw. */
export async function listWithdrawDelegates(restaurantId: string): Promise<WithdrawDelegate[]> {
  const supabase = db();
  const [{ data: staff, error: staffError }, { data: grants }] = await Promise.all([
    supabase
      .from("restaurant_staff")
      // Named FK: restaurant_staff → profiles is also `invited_by`, and a
      // bare `profiles ( … )` is refused as ambiguous (see lib/data/manager.ts).
      .select("profile_id, display_name, profiles!restaurant_staff_profile_id_fkey ( name )")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active")
      .eq("role", "manager"),
    supabase.from("withdrawal_permissions").select("profile_id, daily_limit, granted_at").eq("restaurant_id", restaurantId),
  ]);
  if (staffError) console.error("[wallet:delegates]", staffError.message);

  const byProfile = new Map(
    ((grants ?? []) as { profile_id: string; daily_limit: number | null; granted_at: string }[]).map((g) => [g.profile_id, g]),
  );

  return ((staff ?? []) as unknown as {
    profile_id: string | null;
    display_name: string | null;
    profiles: { name: string } | null;
  }[])
    .filter((row) => row.profile_id)
    .map((row) => {
      const grant = byProfile.get(row.profile_id!);
      return {
        profileId: row.profile_id!,
        name: row.profiles?.name || row.display_name || "—",
        granted: Boolean(grant),
        dailyLimit: grant?.daily_limit ?? null,
        grantedAt: grant?.granted_at ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ── The PIN ───────────────────────────────────────────────────────────── */

export interface PinStatus {
  hasPin: boolean;
  lockedUntil: string | null;
}

export async function pinStatus(profileId: string): Promise<PinStatus> {
  const { data } = await db()
    .from("withdrawal_pins")
    .select("locked_until")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!data) return { hasPin: false, lockedUntil: null };
  const lockedUntil = (data.locked_until as string | null) ?? null;
  return { hasPin: true, lockedUntil: pinLocked(lockedUntil, new Date()) ? lockedUntil : null };
}

/** Set (or replace) a person's PIN. The caller has re-checked their password. */
export async function savePin(profileId: string, pin: string): Promise<boolean> {
  const { error } = await db()
    .from("withdrawal_pins")
    .upsert(
      { profile_id: profileId, pin_hash: hashPin(pin), failed_attempts: 0, locked_until: null },
      { onConflict: "profile_id" },
    );
  if (error) console.error("[wallet:savePin]", profileId, error.message);
  return !error;
}

export type PinCheck =
  | { ok: true }
  | { ok: false; reason: "noPin" }
  | { ok: false; reason: "locked"; lockedUntil: string }
  | { ok: false; reason: "wrong"; attemptsLeft: number };

/**
 * Check a PIN, counting wrong ones in the DATABASE — the in-memory rate
 * limiter forgets on every cold start, and five guesses per server instance
 * is no lock at all. The fifth wrong code locks it for half an hour and
 * tells the person and the owners: someone guessing a PIN is news.
 */
export async function checkWithdrawalPin(
  profileId: string,
  pin: string,
  where: { restaurantId: string; personName: string },
): Promise<PinCheck> {
  /*
    ─────────────────────────────────────────────────────────────────────────
     GUESSES SENT TOGETHER ARE COUNTED TOGETHER (security review 2026-10-05).

     The wrong-PIN count was a compare-and-swap on the value read: a hundred
     guesses fired at once all read "0", one write landed, and the hundred
     cost a single attempt — a 4-digit code fell in hours to anyone holding
     a signed-in session. Two layers now: every check, right or wrong, is
     counted first by the shared rate limiter (a database upsert, so
     parallel calls each count), and a wrong code is counted by a locked
     database function (0076), not by a read-then-write.
    ─────────────────────────────────────────────────────────────────────────
  */
  const limited = await rateLimit({
    key: "wallet:pin-check",
    identifier: profileId,
    limit: PIN_MAX_ATTEMPTS * 2,
    windowMs: PIN_LOCK_MINUTES * 60_000,
  });
  if (!limited.ok) {
    return { ok: false, reason: "locked", lockedUntil: new Date(Date.now() + limited.retryAfterMs).toISOString() };
  }

  const supabase = db();
  const { data } = await supabase
    .from("withdrawal_pins")
    .select("pin_hash, failed_attempts, locked_until")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (!data) return { ok: false, reason: "noPin" };

  const now = new Date();
  const lockedUntil = (data.locked_until as string | null) ?? null;
  if (lockedUntil && pinLocked(lockedUntil, now)) return { ok: false, reason: "locked", lockedUntil };

  const attempts = Number(data.failed_attempts ?? 0);

  if (verifyPin(pin, String(data.pin_hash))) {
    if (attempts > 0 || lockedUntil) {
      await supabase.from("withdrawal_pins").update({ failed_attempts: 0, locked_until: null }).eq("profile_id", profileId);
    }
    return { ok: true };
  }

  const next = await countWrongPin(profileId, attempts, now);

  if (next.lockedUntil && next.justLocked) {
    const detail = `Le code de retrait de ${where.personName} est bloqué 30 minutes après ${PIN_MAX_ATTEMPTS} essais incorrects.`;
    await notify({ event: "withdrawal", tone: "error", profileId, href: "/m/wallet", params: { withdrawalKind: "security", detail } });
    await notifyOwners(where.restaurantId, { tone: "error", withdrawalKind: "security", detail }, profileId);
    return { ok: false, reason: "locked", lockedUntil: next.lockedUntil };
  }
  if (next.lockedUntil) return { ok: false, reason: "locked", lockedUntil: next.lockedUntil };

  return { ok: false, reason: "wrong", attemptsLeft: Math.max(1, PIN_MAX_ATTEMPTS - next.attempts) };
}

/**
 * Count one wrong PIN atomically — withdrawal_pin_wrong() (0076) locks the
 * row, so concurrent wrong codes each count. Before 0076 is run, the old
 * compare-and-swap is the fallback; the rate limiter above still caps it.
 */
async function countWrongPin(
  profileId: string,
  attemptsRead: number,
  now: Date,
): Promise<{ attempts: number; lockedUntil: string | null; justLocked: boolean }> {
  const supabase = db();
  const { data, error } = await supabase.rpc("withdrawal_pin_wrong", {
    p_profile_id: profileId,
    p_max: PIN_MAX_ATTEMPTS,
    p_lock_minutes: PIN_LOCK_MINUTES,
  });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { out_attempts: number; out_locked_until: string | null; out_just_locked: boolean }
    | null
    | undefined;
  if (!error && row) {
    return {
      attempts: Number(row.out_attempts ?? 0),
      lockedUntil: row.out_locked_until ?? null,
      justLocked: Boolean(row.out_just_locked),
    };
  }
  if (error) console.error("[wallet:pinWrong] falling back", error.message);

  const next = afterWrongPin(attemptsRead, now);
  await supabase
    .from("withdrawal_pins")
    .update({ failed_attempts: next.attempts, locked_until: next.lockedUntil })
    .eq("profile_id", profileId)
    .eq("failed_attempts", attemptsRead);
  return { ...next, justLocked: next.lockedUntil !== null };
}

/* ── The numbers ───────────────────────────────────────────────────────── */

export interface PayoutAccount {
  id: string;
  phone: string;
  /** Masked for the people who withdraw but did not add it. */
  maskedPhone: string;
  holderName: string | null;
  label: string | null;
  createdAt: string;
}

function toAccount(row: Record<string, unknown>): PayoutAccount {
  const phone = String(row.phone ?? "");
  return {
    id: String(row.id),
    phone,
    maskedPhone: maskPhone(phone),
    holderName: (row.holder_name as string | null) ?? null,
    label: (row.label as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
  };
}

/** The numbers money may go to — shared by the main restaurant and every branch. */
export async function listPayoutAccounts(restaurantId: string): Promise<PayoutAccount[]> {
  const accountId = await mainRestaurantId(restaurantId);
  const { data, error } = await db()
    .from("payout_accounts")
    .select("*")
    .eq("account_id", accountId)
    .is("removed_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    if (!isMissingColumn(error)) console.error("[wallet:payoutAccounts]", error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toAccount);
}

export async function getPayoutAccount(restaurantId: string, id: string): Promise<PayoutAccount | null> {
  const accountId = await mainRestaurantId(restaurantId);
  const { data } = await db()
    .from("payout_accounts")
    .select("*")
    .eq("id", id)
    .eq("account_id", accountId)
    .is("removed_at", null)
    .maybeSingle();
  return data ? toAccount(data as Record<string, unknown>) : null;
}

/* ── Who is told ───────────────────────────────────────────────────────── */

/**
 * Every owner who should hear about money leaving this branch: its own
 * owners, and the owners of its main restaurant.
 */
export async function ownerProfileIds(restaurantId: string): Promise<string[]> {
  const mainId = await mainRestaurantId(restaurantId);
  const supabase = db();
  const [{ data: staff }, { data: main }] = await Promise.all([
    supabase
      .from("restaurant_staff")
      .select("profile_id")
      .in("restaurant_id", [...new Set([restaurantId, mainId])])
      .eq("role", "owner")
      .eq("status", "active"),
    supabase.from("restaurants").select("owner_id").eq("id", mainId).maybeSingle(),
  ]);

  const ids = new Set(((staff ?? []) as { profile_id: string | null }[]).map((row) => row.profile_id).filter(Boolean) as string[]);
  const ownerId = (main as { owner_id?: string | null } | null)?.owner_id;
  if (ownerId) ids.add(ownerId);
  return [...ids];
}

/** One message to every owner (each through their own preferences). Never throws. */
export async function notifyOwners(
  restaurantId: string,
  message: { tone: "info" | "success" | "warning" | "error"; withdrawalKind: "sent" | "security" | "rights"; detail: string; amount?: number },
  /** Already told separately — not twice. */
  skipProfileId?: string,
): Promise<void> {
  try {
    for (const profileId of await ownerProfileIds(restaurantId)) {
      if (profileId === skipProfileId) continue;
      await notify({
        event: "withdrawal",
        tone: message.tone,
        profileId,
        href: "/m/wallet",
        params: { withdrawalKind: message.withdrawalKind, detail: message.detail, amount: message.amount },
      });
    }
  } catch (error) {
    console.error("[wallet:notifyOwners]", error instanceof Error ? error.message : error);
  }
}
