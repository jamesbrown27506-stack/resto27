import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DICTIONARIES, interpolate, type TranslationKey } from "./dictionaries";
import { firstIssueMessage, isTranslationKey, translateIssueMessage } from "./issue-message";

const tFor = (locale: "fr" | "en") => (key: TranslationKey, vars?: Record<string, string | number>) =>
  interpolate(DICTIONARIES[locale][key] ?? key, vars);

describe("translateIssueMessage", () => {
  it("recognises dictionary keys", () => {
    expect(isTranslationKey("ecu.v.emailInvalid")).toBe(true);
    expect(isTranslationKey("Adresse email invalide")).toBe(false);
  });

  it("translates a schema message that is a key, in either language", () => {
    const schema = z.string().min(1, "ecu.v.addrLabel");
    const issue = schema.safeParse("").error!.issues[0]!;
    expect(translateIssueMessage(issue.message, tFor("fr"))).toBe("Donnez un libellé.");
    expect(translateIssueMessage(issue.message, tFor("en"))).toBe("Give it a label.");
  });

  it("returns the first issue translated, or 'check the form' when there is none", () => {
    const error = z.object({ label: z.string().min(1, "ecu.v.addrLabel") }).safeParse({ label: "" }).error!;
    expect(firstIssueMessage(error, tFor("en"))).toBe("Give it a label.");
    expect(firstIssueMessage({ issues: [] }, tFor("en"))).toBe(DICTIONARIES.en["ecu.checkForm"]);
  });

  it("passes zod's own default messages through untouched", () => {
    const issue = z.string().max(2).safeParse("abcd").error!.issues[0]!;
    expect(translateIssueMessage(issue.message, tFor("en"))).toBe(issue.message);
  });
});
