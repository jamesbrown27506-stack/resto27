import { describe, expect, it } from "vitest";
import { isAppleMobile } from "./ios";

describe("isAppleMobile", () => {
  it("recognises iPhone and classic iPad user agents", () => {
    expect(isAppleMobile("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isAppleMobile("Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X)")).toBe(true);
  });

  it("recognises an iPadOS tablet that claims to be a Mac", () => {
    expect(isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
  });

  it("leaves real Macs and Android phones alone", () => {
    expect(isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(isAppleMobile("Mozilla/5.0 (Linux; Android 14; SM-A145F)", "Linux armv8l", 5)).toBe(false);
  });
});
