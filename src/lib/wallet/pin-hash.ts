import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Withdrawal PIN hashing (0073).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A 4–6 digit PIN has at most a million values, so the hash alone cannot
 *  protect it against someone holding the table — that is what the attempt
 *  lock (withdraw-rules.ts) and the service-role-only table are for. The
 *  hash still matters: scrypt with a per-person salt means a leaked row is
 *  not the PIN in plain sight, and two people with the same code do not
 *  share a hash.
 *
 *  Stored as `scrypt$N$r$p$salt$hash$length` (base64), so the cost can be raised
 *  later without breaking the codes already set.
 * ─────────────────────────────────────────────────────────────────────────
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LENGTH, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64"), pin.length].join("$");
}

/** Only the digit count reaches the UI. Older hashes have no length metadata. */
export function pinLength(stored: string): 4 | 5 | 6 | null {
  const parts = stored.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt") return null;
  const length = Number(parts[6]);
  return length === 4 || length === 5 || length === 6 ? length : null;
}

/** Constant-time comparison; false for anything malformed. */
export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split("$");
  if ((parts.length !== 6 && parts.length !== 7) || parts[0] !== "scrypt") return false;
  if (!/^[0-9]{4,6}$/.test(pin)) return false;
  if (parts.length === 7 && (pinLength(stored) === null || pin.length !== pinLength(stored))) return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64!, "base64");
  if (expected.length === 0) return false;

  try {
    const actual = scryptSync(pin, Buffer.from(saltB64!, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
