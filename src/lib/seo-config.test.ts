import { describe, expect, it } from "vitest";
import { absolutePublicUrl, publicHref, discoverySlug } from "./seo-config";

describe("public search URLs", () => {
  it("uses the purchased domain and gives each language its own canonical", () => {
    expect(absolutePublicUrl("/restaurants/mami-chop")).toBe("https://resto237.online/restaurants/mami-chop");
    expect(absolutePublicUrl("/restaurants/mami-chop", "en")).toBe("https://resto237.online/restaurants/mami-chop?lang=en");
  });
  it("preserves search and anchor destinations when changing languages", () => {
    expect(publicHref("/restaurants?q=rice#menu", "en")).toBe("/restaurants?q=rice&lang=en#menu");
    expect(publicHref("/restaurants?q=rice&lang=en#menu", "fr")).toBe("/restaurants?q=rice#menu");
  });
  it("does not rewrite private or external destinations", () => {
    expect(publicHref("/login?next=/orders", "en")).toBe("/login?next=/orders");
    expect(publicHref("https://other.example", "en")).toBe("https://other.example");
  });
  it("generates readable paths for accented local dish names", () => {
    expect(discoverySlug("Foléré / Jus de bissap")).toBe("folere-jus-de-bissap");
  });
});
