import { describe, expect, it } from "vitest";
import { normalisePhone, selectReportRow, type ReportRow } from "./match";

/**
 * The transaction report as it stood on 2026-09-13 (numbers replaced): a paid
 * 500 FCFA Orange collection at 14:17 (#149), then two unpaid retries for the
 * same number and amount (#150, #151), with MTN rows from another number.
 */
const ORANGE = "691098999";
const MTN = "679534849";
const rows: (ReportRow & { used: boolean })[] = [
  { id: 151, action: "RETRAIT_ORANGE", Amount: 500, "customer number": ORANGE, used: false },
  { id: 150, action: "RETRAIT_ORANGE", Amount: 500, "customer number": ORANGE, used: false },
  { id: 149, action: "RETRAIT_ORANGE", Amount: 500, "customer number": ORANGE, used: true, ref: "CO260913.1418.A73075" },
  { id: 148, action: "RETRAIT_ORANGE", Amount: 2000, "customer number": ORANGE, used: false },
  { id: 147, action: "RETRAIT_MTN", Amount: 2000, "customer number": MTN, used: true },
  { id: 146, action: "RETRAIT_MTN", Amount: 500, "customer number": MTN, used: false },
  { id: 140, action: "DEPOT_ORANGE", Amount: 500, "customer number": ORANGE, used: true },
];

const facts = (overrides: Partial<Parameters<typeof selectReportRow>[1]> = {}) => ({
  needle: "2ff69d1a-0000-4000-8000-000000000000",
  phone: ORANGE,
  amount: 500,
  direction: "collect" as const,
  exclude: new Set<string>(),
  ...overrides,
});

describe("selectReportRow", () => {
  it("picks the row a request created, not a newer retry's", () => {
    // The 14:17 request captured counter 148 before it was sent.
    expect(selectReportRow(rows, facts({ afterId: 148 }))?.id).toBe(149);
  });

  it("gives each retry its own row", () => {
    expect(selectReportRow(rows, facts({ afterId: 149 }))?.id).toBe(150);
    expect(selectReportRow(rows, facts({ afterId: 150 }))?.id).toBe(151);
  });

  it("skips a row another attempt already settled from", () => {
    expect(selectReportRow(rows, facts({ afterId: 148, exclude: new Set(["149"]) }))?.id).toBe(150);
  });

  it("never matches a payout, another amount or another number", () => {
    expect(selectReportRow(rows, facts({ afterId: 100, amount: 2000 }))?.id).toBe(148);
    expect(selectReportRow(rows, facts({ afterId: 100, phone: MTN }))?.id).toBe(146);
    expect(selectReportRow(rows, facts({ afterId: 100, direction: "payout" }))?.id).toBe(140);
  });

  it("falls back to the newest match only when no counter was captured", () => {
    expect(selectReportRow(rows, facts())?.id).toBe(151);
  });

  it("refuses to guess with nothing identifying", () => {
    expect(selectReportRow(rows, facts({ phone: null, amount: undefined, needle: "" }))).toBeUndefined();
  });

  it("reads the customer from numeroClient, never our own account in numero", () => {
    // The live report shape (2026-09-13): `numero` is OUR CamerPay account,
    // `numeroClient` the customer who paid.
    const live = [{ id: 149, numero: MTN, numeroClient: ORANGE, montant: 500, action: "RETRAIT_ORANGE" }];
    expect(selectReportRow(live, facts({ afterId: 148 }))?.id).toBe(149);
    expect(selectReportRow(live, facts({ afterId: 148, phone: MTN }))).toBeUndefined();
  });

  it("reads the customer number under any spelling the report uses", () => {
    const lower = [{ id: 9, action: "RETRAIT_MTN", montant: 500, numeroClient: "237 6 79 53 48 49" }];
    expect(selectReportRow(lower, facts({ phone: MTN, afterId: 1 }))?.id).toBe(9);
  });
});

describe("normalisePhone", () => {
  it("accepts the forms people type and rejects the rest", () => {
    expect(normalisePhone("+237 691 09 89 99")).toBe("691098999");
    expect(normalisePhone("00237691098999")).toBe("691098999");
    expect(normalisePhone("591098999")).toBeNull();
  });
});
