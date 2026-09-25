import { describe, expect, it } from "vitest";
import { isSameAddress } from "./address-match";

describe("isSameAddress", () => {
  it("ignores case, accents, punctuation and spacing", () => {
    expect(
      isSameAddress(
        { addressLine: "Rue Joss, Immeuble Épi — 3e étage", quartier: "Bonapriso" },
        { addressLine: "rue joss immeuble epi 3e  etage", quartier: "bonapriso" },
      ),
    ).toBe(true);
  });

  it("treats a different quartier as a different address", () => {
    expect(
      isSameAddress(
        { addressLine: "Rue 1.234", quartier: "Akwa" },
        { addressLine: "Rue 1.234", quartier: "Bali" },
      ),
    ).toBe(false);
  });

  it("never matches an empty street line", () => {
    expect(isSameAddress({ addressLine: "", quartier: "Akwa" }, { addressLine: "", quartier: "Akwa" })).toBe(false);
  });
});
