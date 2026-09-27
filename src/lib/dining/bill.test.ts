import { describe, expect, it } from "vitest";
import {
  billDue,
  billRemaining,
  isJoinCode,
  paymentFee,
  quotePayment,
  shareFor,
  sumByGuest,
  tipFromPercent,
} from "./bill";

describe("table bill arithmetic", () => {
  it("deducts the booking deposit and never goes negative", () => {
    expect(billDue(12_000, 5_000)).toBe(7_000);
    expect(billDue(3_000, 5_000)).toBe(0);
  });

  it("counts payments in flight as already promised", () => {
    expect(billRemaining({ due: 10_000, paid: 3_000, inFlight: 2_000 })).toBe(5_000);
  });

  it("charges the gateway fee on share + tip, rounded to the franc", () => {
    expect(paymentFee(10_000, 1.5)).toBe(150);
    expect(paymentFee(333, 1.5)).toBe(5);
    expect(paymentFee(10_000, 0)).toBe(0);
    expect(quotePayment(10_000, 1_000, 1.5)).toEqual({ share: 10_000, tip: 1_000, fee: 165, total: 11_165 });
  });

  it("never lets a tip exceed the share", () => {
    expect(quotePayment(1_000, 5_000, 0).tip).toBe(1_000);
  });

  it("computes one-tap tips", () => {
    expect(tipFromPercent(8_000, 10)).toBe(800);
    expect(tipFromPercent(8_000, 0)).toBe(0);
  });
});

describe("how much this payment settles", () => {
  const base = { due: 12_000, remaining: 12_000 };

  it("pays everything that is left", () => {
    expect(shareFor({ ...base, mode: "all", remaining: 7_000 })).toEqual({ ok: true, share: 7_000 });
  });

  it("pays only my dishes, capped at what is left", () => {
    expect(shareFor({ ...base, mode: "mine", mine: 4_500 })).toEqual({ ok: true, share: 4_500 });
    expect(shareFor({ ...base, mode: "mine", mine: 4_500, remaining: 2_000 })).toEqual({ ok: true, share: 2_000 });
    expect(shareFor({ ...base, mode: "mine", mine: 0 })).toEqual({ ok: false, reason: "nothingMine" });
  });

  it("splits equally from the whole bill, rounding up", () => {
    expect(shareFor({ ...base, mode: "equal", parts: 5 })).toEqual({ ok: true, share: 2_400 });
    expect(shareFor({ due: 10_000, remaining: 10_000, mode: "equal", parts: 3 })).toEqual({ ok: true, share: 3_334 });
    // The last person pays what is actually left, not a full part.
    expect(shareFor({ due: 10_000, remaining: 3_332, mode: "equal", parts: 3 })).toEqual({ ok: true, share: 3_332 });
    expect(shareFor({ ...base, mode: "equal", parts: 1 })).toEqual({ ok: false, reason: "invalidParts" });
  });

  it("accepts a typed amount between 100 FCFA and what is left", () => {
    expect(shareFor({ ...base, mode: "amount", amount: 5_000 })).toEqual({ ok: true, share: 5_000 });
    expect(shareFor({ ...base, mode: "amount", amount: 50 })).toEqual({ ok: false, reason: "invalidAmount" });
    expect(shareFor({ ...base, mode: "amount", amount: 20_000 })).toEqual({ ok: false, reason: "invalidAmount" });
  });

  it("refuses when nothing is owed", () => {
    expect(shareFor({ ...base, mode: "all", remaining: 0 })).toEqual({ ok: false, reason: "nothingToPay" });
  });
});

describe("shared bill helpers", () => {
  it("adds up who ordered what", () => {
    const totals = sumByGuest([
      { guestId: "a", amount: 2_000 },
      { guestId: "b", amount: 1_500 },
      { guestId: "a", amount: 500 },
      { guestId: null, amount: 1_000 },
    ]);
    expect(totals.get("a")).toBe(2_500);
    expect(totals.get(null)).toBe(1_000);
  });

  it("recognises join codes from the unambiguous alphabet only", () => {
    expect(isJoinCode("4k7q")).toBe(true);
    expect(isJoinCode("O0I1")).toBe(false);
    expect(isJoinCode("ABCDE")).toBe(false);
  });
});
