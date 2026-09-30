import { describe, expect, it } from "vitest";
import { cleanRecipientName, sameRecipient } from "./recipient-name";

describe("cleanRecipientName", () => {
  it("removes the padding CamerPay sends", () => {
    // The live answer on 2026-09-30 was " EDOUARD TAHALI".
    expect(cleanRecipientName(" EDOUARD TAHALI")).toBe("EDOUARD TAHALI");
    expect(cleanRecipientName("EDOUARD   TAHALI\n")).toBe("EDOUARD TAHALI");
    expect(cleanRecipientName(null)).toBe("");
  });
});

describe("sameRecipient", () => {
  it("accepts the name the sender was shown, whatever its spacing, case or accents", () => {
    expect(sameRecipient("EDOUARD TAHALI", " EDOUARD TAHALI")).toBe(true);
    expect(sameRecipient("Édouard Tahali", "EDOUARD  TAHALI")).toBe(true);
  });

  it("refuses another holder", () => {
    expect(sameRecipient("EDOUARD TAHALI", "EMMANUEL FOQUO")).toBe(false);
    expect(sameRecipient("EDOUARD TAHALI", "EDOUARD TAHALI JUNIOR")).toBe(false);
  });

  it("never treats 'no name' as a match", () => {
    expect(sameRecipient("", "")).toBe(false);
    expect(sameRecipient(undefined, "EDOUARD TAHALI")).toBe(false);
    expect(sameRecipient("EDOUARD TAHALI", null)).toBe(false);
    expect(sameRecipient("   ", "   ")).toBe(false);
  });
});
