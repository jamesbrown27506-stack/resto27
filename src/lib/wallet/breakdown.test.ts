import { describe, expect, it } from "vitest";
import { ledgerBucket, summarizeLedger } from "./breakdown";

const entry = (amount: number, kind: string, note: string | null, reference: string | null) => ({ amount, kind, note, reference });

describe("where a wallet entry belongs", () => {
  it("files online orders and table bills apart", () => {
    expect(ledgerBucket(entry(4_500, "payment", "Online order CMD-AB12CD", "CMD-AB12CD"))).toBe("orders");
    expect(ledgerBucket(entry(6_000, "payment", "Table 4 — CMD-ZZ99", "CMD-ZZ99"))).toBe("tables");
    expect(ledgerBucket(entry(3_000, "order", "Wallet payment for order CMD-OLD1", "CMD-OLD1"))).toBe("orders");
  });

  it("files every reservation deposit, online or at the counter", () => {
    expect(ledgerBucket(entry(1_000, "deposit", "Acompte RES-AB12 (paiement en ligne)", "RES-AB12"))).toBe("reservations");
    expect(ledgerBucket(entry(1_000, "deposit", "Acompte RES-AB12", "RES-AB12"))).toBe("reservations");
  });

  it("tells an order refund from a booking refund", () => {
    expect(ledgerBucket(entry(-4_500, "adjustment", "Order CMD-AB12CD cancelled — customer refunded", "CMD-AB12CD"))).toBe("orderRefunds");
    expect(ledgerBucket(entry(-1_000, "adjustment", "Reservation RES-AB12 cancellation settlement", "RES-AB12"))).toBe("reservationRefunds");
  });

  it("nets a failed withdrawal's credit-back against withdrawals", () => {
    expect(ledgerBucket(entry(-5_000, "withdrawal", "Withdrawal 1", "w1"))).toBe("withdrawals");
    expect(ledgerBucket(entry(5_000, "adjustment", "Withdrawal 1 reversed — refused: x", "w1"))).toBe("withdrawals");
  });

  it("puts top-ups and manual credits under credits", () => {
    expect(ledgerBucket(entry(10_000, "payment", "Approvisionnement Mobile Money PAY-1", "PAY-1"))).toBe("credits");
    expect(ledgerBucket(entry(2_000, "payment", "Geste commercial", null))).toBe("credits");
  });
});

describe("the breakdown adds up to the balance", () => {
  it("explains a 2 000 FCFA wallet holding one order and one deposit", () => {
    const sums = summarizeLedger([
      entry(1_000, "payment", "Online order CMD-1", "CMD-1"),
      entry(1_000, "deposit", "Acompte RES-1 (paiement en ligne)", "RES-1"),
    ]);
    expect(sums).toMatchObject({ orders: 1_000, reservations: 1_000, total: 2_000 });
  });

  it("partitions every entry, so the buckets always sum to the total", () => {
    const sums = summarizeLedger([
      entry(10_000, "payment", "Online order CMD-1", "CMD-1"),
      entry(-10_000, "adjustment", "Order CMD-1 cancelled — customer refunded", "CMD-1"),
      entry(6_000, "payment", "Table 2 — CMD-2", "CMD-2"),
      entry(3_000, "deposit", "Acompte RES-1", "RES-1"),
      entry(-3_000, "adjustment", "Reservation RES-1 cancelled by the restaurant — customer refunded", "RES-1"),
      entry(-4_000, "withdrawal", "Withdrawal w1", "w1"),
      entry(500, "payment", "Ajustement", null),
    ]);
    const { total, ...buckets } = sums;
    expect(Object.values(buckets).reduce((a, b) => a + b, 0)).toBe(total);
    expect(total).toBe(2_500);
  });
});
