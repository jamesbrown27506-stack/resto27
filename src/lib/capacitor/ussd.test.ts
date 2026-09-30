import { describe, expect, it } from "vitest";
import { isOrangeMoneyCode } from "./ussd";

describe("isOrangeMoneyCode", () => {
  it("accepts the Orange Money payment code CamerPay hands out", () => {
    expect(isOrangeMoneyCode("#150*14*307053*656703911*500#")).toBe(true);
  });

  // The Android plugin places a call without another tap: only a payment
  // code may reach it, never a forwarding code or an ordinary number.
  it("refuses anything that is not an Orange Money code", () => {
    expect(isOrangeMoneyCode("**21*699000000#")).toBe(false);
    expect(isOrangeMoneyCode("*126#")).toBe(false);
    expect(isOrangeMoneyCode("699000000")).toBe(false);
    expect(isOrangeMoneyCode("#150*14*307053*656703911*500# ")).toBe(false);
    expect(isOrangeMoneyCode("#150*14*abc#")).toBe(false);
  });
});
