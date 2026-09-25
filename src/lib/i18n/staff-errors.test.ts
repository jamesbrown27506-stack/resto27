import { describe, expect, it } from "vitest";
import { localizeActionError } from "./staff-errors";

describe("localizeActionError", () => {
  it("translates a known action error for French staff", () => {
    expect(localizeActionError("Order not found.", "fr")).toBe("Commande introuvable.");
  });

  it("translates messages that carry a value", () => {
    expect(localizeActionError('"Poulet DG" is sold out.', "fr")).toBe("« Poulet DG » est épuisé.");
    expect(
      localizeActionError("Your advertised maximum is 2 000 FCFA. Quote that amount or less.", "fr"),
    ).toContain("2 000 FCFA");
  });

  it("leaves English readers and unknown messages alone", () => {
    expect(localizeActionError("Order not found.", "en")).toBe("Order not found.");
    expect(localizeActionError("Something new broke.", "fr")).toBe("Something new broke.");
  });

  it("falls back when there is no message at all", () => {
    expect(localizeActionError(undefined, "fr", "Erreur")).toBe("Erreur");
  });
});
