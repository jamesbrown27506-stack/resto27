import { describe, expect, it } from "vitest";
import { formatPhoneDisplay, telHref } from "./phone";

describe("telHref", () => {
  /**
   * The bug this replaces: `phone.replace(/[^+\\d]/g, "")` in a regex literal
   * strips every digit, because `\\d` there is a literal backslash and the
   * letter `d`, not the digit class. Every page rendered `href="tel:"`.
   */
  it("keeps the digits — the old regex removed all of them", () => {
    expect(telHref("691098999")).toBe("tel:+237691098999");
  });

  it("assumes Cameroon for a bare 9-digit national number", () => {
    expect(telHref("699885522")).toBe("tel:+237699885522");
  });

  it("leaves an already-international number alone", () => {
    expect(telHref("+237 6 91 09 89 99")).toBe("tel:+237691098999");
    expect(telHref("237691098999")).toBe("tel:+237691098999");
  });

  it("returns null when there is nothing to dial, so the link can be dropped", () => {
    expect(telHref(null)).toBeNull();
    expect(telHref("")).toBeNull();
    expect(telHref("   ")).toBeNull();
    expect(telHref("not a number")).toBeNull();
  });
});

describe("formatPhoneDisplay", () => {
  it("groups a Cameroon number the way it is written locally", () => {
    expect(formatPhoneDisplay("691098999")).toBe("+237 6 91 09 89 99");
    expect(formatPhoneDisplay("+237691098999")).toBe("+237 6 91 09 89 99");
  });

  it("shows an unrecognised entry exactly as typed rather than mangling it", () => {
    expect(formatPhoneDisplay("+33 1 23 45 67 89")).toBe("+33 1 23 45 67 89");
    expect(formatPhoneDisplay(null)).toBe("");
  });
});
