import { describe, expect, it } from "vitest";
import {
  PIN_LOCK_MINUTES,
  PIN_MAX_ATTEMPTS,
  afterWrongPin,
  canReceiveWithdrawRight,
  dailyAllowance,
  maskPhone,
  pinLocked,
  pinProblem,
  withdrawRight,
} from "./withdraw-rules";
import { hashPin, verifyPin } from "./pin-hash";

describe("who may withdraw", () => {
  it("lets the owner withdraw, always", () => {
    expect(withdrawRight({ role: "owner", grant: null, impersonating: false })).toEqual({ allowed: true, kind: "owner" });
  });

  it("lets a manager withdraw only once an owner granted it", () => {
    expect(withdrawRight({ role: "manager", grant: null, impersonating: false })).toEqual({
      allowed: false,
      reason: "notGranted",
    });
    expect(withdrawRight({ role: "manager", grant: { dailyLimit: 50_000 }, impersonating: false })).toEqual({
      allowed: true,
      kind: "delegate",
      dailyLimit: 50_000,
    });
  });

  it("never lets kitchen, cashier or waiter withdraw, even with a stray grant", () => {
    for (const role of ["kitchen", "cashier", "waiter"] as const) {
      expect(withdrawRight({ role, grant: { dailyLimit: null }, impersonating: false }).allowed).toBe(false);
      expect(canReceiveWithdrawRight(role)).toBe(false);
    }
    expect(canReceiveWithdrawRight("manager")).toBe(true);
  });

  it("never lets a platform admin withdraw while impersonating", () => {
    expect(withdrawRight({ role: "owner", grant: null, impersonating: true })).toEqual({
      allowed: false,
      reason: "impersonating",
    });
  });
});

describe("the withdrawal PIN", () => {
  it("takes 4 to 6 digits", () => {
    expect(pinProblem("2580")).toBeNull();
    expect(pinProblem("739164")).toBeNull();
    expect(pinProblem("123")).toBe("format");
    expect(pinProblem("1234567")).toBe("format");
    expect(pinProblem("12a4")).toBe("format");
  });

  it("refuses the codes anyone tries first", () => {
    expect(pinProblem("0000")).toBe("weak");
    expect(pinProblem("111111")).toBe("weak");
    expect(pinProblem("1234")).toBe("weak");
    expect(pinProblem("98765")).toBe("weak");
  });

  it("hashes with a salt and verifies only the right code", () => {
    const stored = hashPin("2580");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain("2580");
    expect(hashPin("2580")).not.toBe(stored);
    expect(verifyPin("2580", stored)).toBe(true);
    expect(verifyPin("2581", stored)).toBe(false);
    expect(verifyPin("2580", "garbage")).toBe(false);
  });

  it("locks after five wrong codes in a row, for half an hour", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    let state = { attempts: 0, lockedUntil: null as string | null };
    for (let i = 1; i < PIN_MAX_ATTEMPTS; i++) {
      state = afterWrongPin(state.attempts, now);
      expect(state.lockedUntil).toBeNull();
    }
    state = afterWrongPin(state.attempts, now);
    expect(state.attempts).toBe(0);
    expect(state.lockedUntil).toBe(new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000).toISOString());
    expect(pinLocked(state.lockedUntil, now)).toBe(true);
    expect(pinLocked(state.lockedUntil, new Date(now.getTime() + 31 * 60_000))).toBe(false);
  });
});

describe("a delegate's daily ceiling", () => {
  it("counts what is left over the last 24 hours", () => {
    expect(dailyAllowance(50_000, 20_000)).toBe(30_000);
    expect(dailyAllowance(50_000, 80_000)).toBe(0);
  });

  it("means no ceiling when the owner set none", () => {
    expect(dailyAllowance(null, 1_000_000)).toBeNull();
  });
});

describe("masking a payout number", () => {
  it("shows enough to recognise, not to copy", () => {
    expect(maskPhone("+237677123456")).toBe("6••••••56");
    expect(maskPhone("677123456")).toBe("6••••••56");
  });
});
