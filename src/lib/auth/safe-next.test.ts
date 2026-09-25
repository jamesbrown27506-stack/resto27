import { describe, expect, it } from "vitest";
import { safeNextPath, withNext } from "./safe-next";

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/checkout")).toBe("/checkout");
    expect(safeNextPath("/orders/abc?tab=1")).toBe("/orders/abc?tab=1");
  });

  it("refuses anything that could leave the site", () => {
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("/\\evil.example")).toBeNull();
    expect(safeNextPath("/ok\nSet-Cookie: x")).toBeNull();
    expect(safeNextPath("checkout")).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(42)).toBeNull();
  });
});

describe("withNext", () => {
  it("appends an encoded next only when it is safe", () => {
    expect(withNext("/register", "/checkout")).toBe("/register?next=%2Fcheckout");
    expect(withNext("/login", "https://evil.example")).toBe("/login");
    expect(withNext("/login", null)).toBe("/login");
  });
});
