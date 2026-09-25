import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  cameroonMsisdn,
  cameroonNetwork,
  parseSaspayAmount,
  saspayAmount,
  saspayVerdict,
  verifySaspaySignature,
} from "./cameroon";

describe("SasPay Cameroon rules", () => {
  it("maps Cameroon prefixes to the right network", () => {
    expect(cameroonNetwork("677123456")).toBe("mtn_cm");
    expect(cameroonNetwork("681234567")).toBe("mtn_cm");
    expect(cameroonNetwork("650123456")).toBe("mtn_cm");
    expect(cameroonNetwork("654123456")).toBe("mtn_cm");
    expect(cameroonNetwork("655123456")).toBe("orange_cm");
    expect(cameroonNetwork("659123456")).toBe("orange_cm");
    expect(cameroonNetwork("691234567")).toBe("orange_cm");
  });

  it("refuses numbers with no SasPay network in Cameroon", () => {
    expect(cameroonNetwork("620123456")).toBeNull();
    expect(cameroonNetwork("222123456")).toBeNull();
    expect(cameroonNetwork("67712345")).toBeNull();
  });

  it("formats amounts and numbers the way SasPay expects", () => {
    expect(saspayAmount(2500)).toBe("2500.00");
    expect(parseSaspayAmount("2500.00")).toBe(2500);
    expect(Number.isNaN(parseSaspayAmount(undefined))).toBe(true);
    expect(cameroonMsisdn("677123456")).toBe("+237677123456");
  });

  it("collapses statuses to verdicts", () => {
    expect(saspayVerdict("SUCCESS")).toBe("success");
    expect(saspayVerdict("FAILED")).toBe("failed");
    expect(saspayVerdict("CANCELLED")).toBe("failed");
    expect(saspayVerdict("PENDING")).toBe("pending");
    expect(saspayVerdict(undefined)).toBe("pending");
  });

  it("verifies webhook signatures and refuses replays", () => {
    const secret = "whsec_test";
    const rawBody = JSON.stringify({ event: "transaction.success", data: { id: "x" } });
    const timestamp = "1790000000";
    const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    const ok = { rawBody, signature, timestamp, secret, nowSeconds: 1790000100 };
    expect(verifySaspaySignature(ok)).toBe(true);
    expect(verifySaspaySignature({ ...ok, rawBody: rawBody + " " })).toBe(false);
    expect(verifySaspaySignature({ ...ok, secret: "other" })).toBe(false);
    expect(verifySaspaySignature({ ...ok, nowSeconds: 1790000000 + 301 })).toBe(false);
    expect(verifySaspaySignature({ ...ok, signature: null })).toBe(false);
  });
});
