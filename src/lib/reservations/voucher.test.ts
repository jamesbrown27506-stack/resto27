import { describe, expect, it } from "vitest";
import {
  endOfBookingDay,
  isVoucherCode,
  normaliseVoucherCode,
  voucherCredit,
  voucherState,
  voucherWindow,
} from "./voucher";

const booking = {
  status: "confirmed",
  reservedFor: "2026-10-03T19:00:00Z", // 20:00 in Douala
  redeemedAt: null,
  depositPaid: true,
};

describe("booking voucher", () => {
  it("normalises codes typed without dashes or in lower case", () => {
    expect(normaliseVoucherCode("r2374k7qm9dx")).toBe("R237-4K7Q-M9DX");
    expect(normaliseVoucherCode(" R237-4K7Q-M9DX ")).toBe("R237-4K7Q-M9DX");
    expect(isVoucherCode("r237 4k7q m9dx")).toBe(true);
    expect(isVoucherCode("R237-0000-1111")).toBe(false);
  });

  it("opens two hours before and closes at the end of the Douala day", () => {
    const { opensAt, closesAt } = voucherWindow(booking.reservedFor);
    expect(opensAt.toISOString()).toBe("2026-10-03T17:00:00.000Z");
    // Midnight in Douala is 23:00 UTC.
    expect(closesAt.toISOString()).toBe("2026-10-03T23:00:00.000Z");
  });

  it("keeps a late-evening booking on its own calendar day", () => {
    // 23:30 Douala = 22:30 UTC, still the 3rd.
    expect(endOfBookingDay("2026-10-03T22:30:00Z").toISOString()).toBe("2026-10-03T23:00:00.000Z");
  });

  it("moves through too early → valid → expired", () => {
    expect(voucherState(booking, new Date("2026-10-03T12:00:00Z"))).toBe("tooEarly");
    expect(voucherState(booking, new Date("2026-10-03T18:00:00Z"))).toBe("valid");
    expect(voucherState(booking, new Date("2026-10-03T22:59:00Z"))).toBe("valid");
    expect(voucherState(booking, new Date("2026-10-03T23:00:00Z"))).toBe("expired");
  });

  it("is used once redeemed, refunded when cancelled after paying, expired on a no-show", () => {
    const at = new Date("2026-10-03T18:00:00Z");
    expect(voucherState({ ...booking, redeemedAt: "2026-10-03T18:05:00Z" }, at)).toBe("used");
    expect(voucherState({ ...booking, status: "cancelled" }, at)).toBe("refunded");
    expect(voucherState({ ...booking, status: "cancelled", depositPaid: false }, at)).toBe("cancelled");
    expect(voucherState({ ...booking, status: "no_show" }, at)).toBe("expired");
    expect(voucherState({ ...booking, status: "awaiting_payment", depositPaid: false }, at)).toBe("notConfirmed");
  });

  it("credits only a deposit that was actually paid, never a percentage", () => {
    expect(voucherCredit({ depositPaid: true, depositAmount: 5_000, depositPercent: 0 })).toBe(5_000);
    expect(voucherCredit({ depositPaid: false, depositAmount: 5_000, depositPercent: 0 })).toBe(0);
    expect(voucherCredit({ depositPaid: true, depositAmount: 0, depositPercent: 10 })).toBe(0);
  });
});
