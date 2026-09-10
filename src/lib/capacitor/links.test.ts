import { describe, expect, it } from "vitest";
import { nativeAuthCallback, safeNativePath } from "./links";

describe("native link boundary", () => {
  it.each([
    ["/orders/42?fee=accept", "/orders/42?fee=accept"],
    ["https://resto237.online/m/orders/42", "/m/orders/42"],
    ["resto237://app/orders/42", "/orders/42"],
    ["resto237://orders/42", "/orders/42"],
  ])("routes %s to an authenticated product page", (input, expected) => {
    expect(safeNativePath(input)).toBe(expected);
  });
  it.each(["//evil.example", "/\\evil.example", "javascript:alert(1)", "https://resto237.online.evil.example", "/logout", "/api/cron/expire", "https://user:pass@resto237.online/", "resto237://app//evil.example"]) (
    "rejects navigation outside product pages: %s", (input) => expect(safeNativePath(input)).toBeNull(),
  );
});

describe("native email callback boundary", () => {
  it("preserves the one-time code with a safe destination", () => {
    expect(nativeAuthCallback("https://resto237.online/auth/callback?code=12345678&next=%2Faccount"))
      .toBe("/auth/callback?code=12345678&next=%2Faccount");
  });
  it("discards an external redirect destination", () => {
    expect(nativeAuthCallback("https://resto237.online/auth/callback?code=12345678&next=https://evil.example"))
      .toBe("/auth/callback?code=12345678&next=%2Faccount");
  });
  it.each(["https://evil.example/auth/callback?code=12345678", "resto237://auth/callback?code=12345678", "https://resto237.online/auth/callback"]) (
    "rejects invalid callbacks %s", (url) => expect(nativeAuthCallback(url)).toBeNull(),
  );
  it.each(["/%61pi/cron/expire", "/%6cogout", "/%2fevil.example"]) (
    "rejects encoded protected navigation %s", (url) => expect(safeNativePath(url)).toBeNull(),
  );
});
