/**
 * Who may take money out of a restaurant wallet, and on what terms (0073).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE POLICY, IN ONE PLACE.
 *
 *  Seeing the wallet and emptying it are different powers. `finance.manage`
 *  (owner, manager) is the first; the second is narrower:
 *
 *    · The OWNER may always withdraw — it is their money.
 *    · A MANAGER may withdraw only if an owner switched it on for that
 *      person, at that branch, optionally under a daily ceiling. Running the
 *      service day to day does not mean deciding when money leaves it.
 *    · Kitchen, cashier and waiter never: they take payments at the table
 *      (`payments.collect`); none of them moves the wallet.
 *    · Nobody withdraws while a platform admin is impersonating the
 *      restaurant — a tenant's money is never moved from inside their
 *      account by the platform.
 *
 *  And every withdrawal, whoever makes it:
 *    · goes to a number the OWNER saved, whose holder name the operator
 *      confirmed — a delegate cannot send the money to their own number;
 *    · is unlocked by the person's own withdrawal PIN, so an unlocked phone
 *      on the counter is not an open wallet;
 *    · is announced to every owner.
 *
 *  Plain module — no server imports — so it is unit tested
 *  (withdraw-rules.test.ts) and the screen can show the same verdicts.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
/** New codes use one familiar length; older 5/6-digit codes remain valid. */
export const PIN_STANDARD_LENGTH = 4;
/** Wrong PINs in a row before the code locks. */
export const PIN_MAX_ATTEMPTS = 5;
/** How long a locked code stays locked. */
export const PIN_LOCK_MINUTES = 30;
/** The window a delegate's daily ceiling counts over: the last 24 hours. */
export const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type PinProblem = "format" | "weak";

/**
 * Why this PIN is refused, or null.
 *
 * New codes use four digits, without a length choice. Existing longer codes
 * are still checked by verifyPin; they are never silently shortened. The
 * codes anyone tries first are refused: one digit repeated (0000, 1111)
 * and straight runs (1234, 9876). Advice on the screen: not your Mobile
 * Money PIN either — that one is known to whoever has watched you pay.
 */
export function pinProblem(pin: string): PinProblem | null {
  if (!new RegExp(`^[0-9]{${PIN_STANDARD_LENGTH}}$`).test(pin)) return "format";

  const digits = [...pin].map(Number);
  if (digits.every((d) => d === digits[0])) return "weak";

  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return "weak";

  return null;
}

export type BranchRoleName = "owner" | "manager" | "kitchen" | "cashier" | "waiter";

export type WithdrawRight =
  | { allowed: true; kind: "owner" }
  | { allowed: true; kind: "delegate"; dailyLimit: number | null }
  | { allowed: false; reason: "impersonating" | "notGranted" | "role" };

/** May this person withdraw at this branch? */
export function withdrawRight(input: {
  role: BranchRoleName;
  /** The owner's grant to this person at this branch, if any. */
  grant: { dailyLimit: number | null } | null;
  impersonating: boolean;
}): WithdrawRight {
  if (input.impersonating) return { allowed: false, reason: "impersonating" };
  if (input.role === "owner") return { allowed: true, kind: "owner" };
  if (input.role === "manager") {
    return input.grant
      ? { allowed: true, kind: "delegate", dailyLimit: input.grant.dailyLimit }
      : { allowed: false, reason: "notGranted" };
  }
  return { allowed: false, reason: "role" };
}

/** A manager of the branch, and whether the owner lets them withdraw. */
export interface WithdrawDelegate {
  profileId: string;
  name: string;
  granted: boolean;
  dailyLimit: number | null;
  grantedAt: string | null;
}

/** Roles an owner may hand the right to. */
export function canReceiveWithdrawRight(role: BranchRoleName): boolean {
  return role === "manager";
}

/**
 * A delegate's ceiling: what is left of it in the last 24 hours.
 * Null limit = no ceiling (the owner chose that, knowingly).
 */
export function dailyAllowance(limit: number | null, withdrawnLast24h: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - Math.max(0, withdrawnLast24h));
}

/**
 * After a wrong PIN: the new count, and a lock once the count is reached.
 * The count restarts with the lock, so the next half hour gives five more
 * tries, not one.
 */
export function afterWrongPin(attempts: number, now: Date): { attempts: number; lockedUntil: string | null } {
  const next = Math.max(0, attempts) + 1;
  if (next >= PIN_MAX_ATTEMPTS) {
    return { attempts: 0, lockedUntil: new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000).toISOString() };
  }
  return { attempts: next, lockedUntil: null };
}

/** Is the code locked right now? */
export function pinLocked(lockedUntil: string | null, now: Date): boolean {
  if (!lockedUntil) return false;
  const until = Date.parse(lockedUntil);
  return Number.isFinite(until) && until > now.getTime();
}

/** "6 77 12 34 56" → "6•• •• •• 56": enough to recognise, not to copy. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^237/, "");
  if (digits.length < 4) return phone;
  return `${digits.slice(0, 1)}${"•".repeat(Math.max(0, digits.length - 3))}${digits.slice(-2)}`;
}
