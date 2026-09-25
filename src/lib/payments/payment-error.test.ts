import { describe, expect, it } from "vitest";
import { DICTIONARIES, interpolate, type TranslationKey } from "@/lib/i18n/dictionaries";
import { paymentErrorMessage, PROVIDER_REFUSED_FALLBACK } from "./payment-error";

const en = (key: TranslationKey, vars?: Record<string, string | number>) =>
  interpolate(DICTIONARIES.en[key] ?? key, vars);

describe("paymentErrorMessage", () => {
  it("maps a known reason to the reader's language, ignoring the French prose", () => {
    expect(
      paymentErrorMessage({ reason: "badPhone", error: "Numéro invalide." }, en, "ecu.paymentFailed"),
    ).toBe(DICTIONARIES.en["ecu.pay.badPhone"]);
  });

  it("keeps the operator's own words on a refusal", () => {
    expect(
      paymentErrorMessage({ reason: "providerRefused", error: "Solde insuffisant" }, en, "ecu.paymentFailed"),
    ).toBe("The operator refused the payment: Solde insuffisant");
    expect(
      paymentErrorMessage({ reason: "providerRefused", error: PROVIDER_REFUSED_FALLBACK }, en, "ecu.paymentFailed"),
    ).toBe(DICTIONARIES.en["ecu.pay.providerRefused"]);
  });

  it("falls back to the French text for an unknown code, then to the caller's key", () => {
    expect(paymentErrorMessage({ reason: "brandNew", error: "Texte" }, en, "ecu.paymentFailed")).toBe("Texte");
    expect(paymentErrorMessage({}, en, "ecu.paymentFailed")).toBe(DICTIONARIES.en["ecu.paymentFailed"]);
  });
});
