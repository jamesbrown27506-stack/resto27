import { describe, expect, it } from "vitest";
import { orderPayerVerdict, type OtherConfirmedAttempt, type PayerOrder } from "./order-payer";

const attempt = { id: "b-attempt", createdAt: "2026-09-30T14:00:00.000Z", amount: 1015 };
const paid: PayerOrder = { status: "confirmed", payment_method: "mobile_money", total: 1015, is_paid: true };
const other = (o: Partial<OtherConfirmedAttempt>): OtherConfirmedAttempt => ({
  id: "a-attempt",
  createdAt: "2026-09-30T13:59:00.000Z",
  settledAt: null,
  refundDue: false,
  ...o,
});

describe("orderPayerVerdict — before a late-payment refund is sent", () => {
  it("the attempt that just paid the order is not refunded by its own second caller", () => {
    // The webhook and the poll on one attempt: the first marked the order paid
    // and is still notifying, so nothing is stamped yet.
    expect(orderPayerVerdict(paid, attempt, [])).toBe("yes");
    // Whatever stage the order has reached since.
    expect(orderPayerVerdict({ ...paid, status: "delivered" }, attempt, [])).toBe("yes");
  });

  it("is exact once the order names its payer (0070)", () => {
    expect(orderPayerVerdict({ ...paid, paid_attempt_id: "b-attempt" }, attempt, null)).toBe("yes");
    expect(orderPayerVerdict({ ...paid, paid_attempt_id: "a-attempt" }, attempt, [])).toBe("no");
  });

  it("refunds a payment for an order nobody can have paid this way", () => {
    // Cancelled by the time limit before anyone paid.
    expect(orderPayerVerdict({ ...paid, status: "cancelled", is_paid: false }, attempt, [])).toBe("no");
    expect(orderPayerVerdict({ ...paid, is_paid: false }, attempt, [])).toBe("no");
    expect(orderPayerVerdict({ ...paid, status: "awaiting_customer" }, attempt, [])).toBe("no");
    expect(orderPayerVerdict({ ...paid, payment_method: "wallet" }, attempt, [])).toBe("no");
    expect(orderPayerVerdict({ ...paid, total: 2000 }, attempt, [])).toBe("no");
  });

  it("does not refund a second time an order that was paid, then cancelled with its refund", () => {
    // cancel_paid_order already refunded it; the paying attempt is asked again
    // because its own stamp never landed.
    const cancelledPaid = { ...paid, status: "cancelled" };
    expect(orderPayerVerdict(cancelledPaid, attempt, [])).toBe("yes");
    expect(orderPayerVerdict({ ...cancelledPaid, paid_attempt_id: "b-attempt" }, attempt, null)).toBe("yes");
    // A genuine second payment on it still goes back.
    expect(orderPayerVerdict({ ...cancelledPaid, paid_attempt_id: "a-attempt" }, attempt, [])).toBe("no");
    expect(orderPayerVerdict(cancelledPaid, attempt, [other({ settledAt: "2026-09-30T14:00:05.000Z" })])).toBe("no");
  });

  it("refunds the second of two real payments, and only that one", () => {
    // Another attempt already settled the order: this one is the extra payment.
    expect(orderPayerVerdict(paid, attempt, [other({ settledAt: "2026-09-30T14:00:05.000Z" })])).toBe("no");
    // The other was itself refunded as late: it is not what paid the order.
    expect(orderPayerVerdict(paid, attempt, [other({ settledAt: "2026-09-30T14:00:05.000Z", refundDue: true })])).toBe("yes");

    // Neither stamped yet: the earliest is the payer, whoever asks.
    const a = { id: "a-attempt", createdAt: "2026-09-30T13:59:00.000Z", amount: 1015 };
    expect(orderPayerVerdict(paid, attempt, [other({})])).toBe("no");
    expect(orderPayerVerdict(paid, a, [other({ id: "b-attempt", createdAt: attempt.createdAt })])).toBe("yes");
  });

  it("never sends money back, or calls it done, on a read that failed", () => {
    expect(orderPayerVerdict(paid, attempt, null)).toBe("unknown");
  });
});
