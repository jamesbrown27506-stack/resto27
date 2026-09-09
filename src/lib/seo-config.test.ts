import { describe, expect, it } from "vitest";
import { absolutePublicUrl, publicHref, discoverySlug, dishSlug, dishPath, isUsableDescription } from "./seo-config";

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

describe("dish URLs", () => {
  /**
   * Dish pages were addressed by raw UUID — 48 of the site's 81 pages looked
   * like /menu/21d4ee21-804e-4e26-9c18-41c1f1cf6577, carrying no dish name at
   * all.
   */
  it("puts the dish name in the URL", () => {
    expect(dishSlug("Eru & Water Fufu", "21d4ee21-804e-4e26-9c18-41c1f1cf6577")).toBe("eru-water-fufu-21d4ee");
    expect(dishPath("mami-chop", { id: "21d4ee21-804e-4e26-9c18-41c1f1cf6577", name: "Ndolé" }))
      .toBe("/restaurants/mami-chop/menu/ndole-21d4ee");
  });

  it("stays unique when one restaurant lists the same dish name twice", () => {
    const a = dishSlug("Ndolé", "aaaaaaaa-0000-0000-0000-000000000000");
    const b = dishSlug("Ndolé", "bbbbbbbb-0000-0000-0000-000000000000");
    expect(a).not.toBe(b);
  });

  it("still produces a usable slug when the name has no latin characters", () => {
    expect(dishSlug("🍲", "21d4ee21-804e-4e26-9c18-41c1f1cf6577")).toBe("21d4ee");
  });
});

describe("public page detection", () => {
  it("treats /about as public so its English variant gets ?lang=en", () => {
    expect(publicHref("/about", "en")).toBe("/about?lang=en");
  });
});

describe("isUsableDescription", () => {
  /**
   * Mami Chop's description — "The best of feeling of a cameroonian dish" —
   * is 40 characters, so it cleared the old `length >= 30` gate and shipped as
   * the meta description AND the schema description of a French page.
   */
  it("rejects the English fragment that used to reach French pages", () => {
    expect(isUsableDescription("The best of feeling of a cameroonian dish", "fr")).toBe(false);
  });

  it("accepts real French prose on a French page", () => {
    expect(isUsableDescription(
      "Une cuisine camerounaise généreuse préparée chaque jour dans notre maison de Ndogbong, avec des produits du marché.",
      "fr",
    )).toBe(true);
  });

  it("accepts real English prose on an English page", () => {
    expect(isUsableDescription(
      "A generous Cameroonian kitchen, cooking fresh every day with produce from the market, and serving the whole neighbourhood.",
      "en",
    )).toBe(true);
  });

  it("rejects anything too short to be a sentence", () => {
    expect(isUsableDescription("Bonne cuisine camerounaise", "fr")).toBe(false);
    expect(isUsableDescription(null, "fr")).toBe(false);
  });

  it("rejects a keyword list with no function words", () => {
    expect(isUsableDescription("ndole poulet dg poisson braise grillades douala bonamoussadi akwa", "fr")).toBe(false);
  });
});
