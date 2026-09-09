import { describe, expect, it } from "vitest";
import { composeStreetAddress, formatQuartier, regionForCity } from "./geo-cm";

describe("regionForCity", () => {
  /**
   * The bug this replaces: `addressRegion` was filled with the quartier, so
   * Mami Chop's schema claimed a region of "ndogbong". The region is Littoral,
   * and a wrong one contradicts any Google Business Profile the restaurant
   * later claims.
   */
  it("maps Douala to Littoral, not to a neighbourhood", () => {
    expect(regionForCity("Douala")).toBe("Littoral");
    expect(regionForCity("douala")).toBe("Littoral");
  });

  it("knows the other cities the platform could expand to", () => {
    expect(regionForCity("Yaoundé")).toBe("Centre");
    expect(regionForCity("Buea")).toBe("Sud-Ouest");
  });

  it("returns null rather than guessing for an unknown city", () => {
    expect(regionForCity("Nowhere")).toBeNull();
    expect(regionForCity(null)).toBeNull();
  });
});

describe("formatQuartier", () => {
  it("title-cases what operators typed in lower case", () => {
    expect(formatQuartier("ndogbong")).toBe("Ndogbong");
    expect(formatQuartier("BONAMOUSSADI")).toBe("Bonamoussadi");
  });

  it("keeps multi-part names readable", () => {
    expect(formatQuartier("pk 14")).toBe("Pk 14");
    expect(formatQuartier("bonaberi-nord")).toBe("Bonaberi-Nord");
  });

  it("changes casing only — never spelling", () => {
    expect(formatQuartier("Ndokoti")).toBe("Ndokoti");
    expect(formatQuartier("")).toBe("");
  });
});

describe("composeStreetAddress", () => {
  it("puts the quartier in the street address, where it belongs", () => {
    expect(composeStreetAddress("carrefour Bifaga", "ndogbong")).toBe("carrefour Bifaga, Ndogbong");
  });

  it("copes with either half missing", () => {
    expect(composeStreetAddress(null, "ndokoti")).toBe("Ndokoti");
    expect(composeStreetAddress("Rue Njo-Njo", null)).toBe("Rue Njo-Njo");
    expect(composeStreetAddress(null, null)).toBeUndefined();
  });
});
