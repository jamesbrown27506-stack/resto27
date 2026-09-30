/**
 * Did THIS attempt's settlement pay the order? — the question asked before any
 * money is sent back as a "late payment". Pure, so it is tested
 * (order-payer.test.ts); collect.ts reads the rows and calls it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A PAID ORDER WAS BEING REFUNDED WHILE IT STAYED PAID.
 *
 *  settlePayment() marks the order paid, sends its notifications, and only
 *  then stamps the attempt finished. For those seconds a second caller on the
 *  same attempt — the webhook beside the browser poll, a re-tap, the
 *  reconciler after a crash — found an order "no longer waiting for this
 *  payment", which is how a late payment looks, and refunded it: restaurant
 *  credited, order still paid, customer given the whole amount back.
 *
 *  With migration 0070 the order says who paid it (`paid_attempt_id`, written
 *  in the transaction that marks it paid) and the answer is exact.
 *
 *  Before it, the other confirmed attempts for the order are read instead:
 *    · one of them is already settled, with no refund owed → THAT one paid,
 *      and this attempt is a second payment: "no".
 *    · otherwise the earliest confirmed attempt is the payer. Every caller
 *      applies the same rule, so two confirmed payments for one order end
 *      with exactly one of them refunded, whichever ran first.
 *
 *  An order that is unpaid, cancelled, still waiting, paid another way or for
 *  another amount was paid by nobody here: "no". A failed read is "unknown" —
 *  never a reason to send money back, and never a reason to call it done.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface PayerOrder {
  status: string;
  payment_method: string;
  total: number;
  is_paid: boolean;
  /** The attempt whose settlement marked the order paid (0070). Absent before that migration. */
  paid_attempt_id?: string | null;
}

export interface PayerAttempt {
  id: string;
  createdAt: string;
  amount: number;
}

/** Another CONFIRMED attempt for the same order. */
export interface OtherConfirmedAttempt {
  id: string;
  createdAt: string;
  settledAt: string | null;
  /** It was itself refunded as a late payment, so it is not what paid the order. */
  refundDue: boolean;
}

export type PayerVerdict = "yes" | "no" | "unknown";

/** True when the order itself can answer, so the other attempts need not be read. */
export function orderNamesItsPayer(order: PayerOrder): boolean {
  return typeof order.paid_attempt_id === "string" && order.paid_attempt_id !== "";
}

/**
 * False when the order cannot have been paid by a Mobile Money attempt of this
 * amount at all.
 *
 * A CANCELLED order is not excluded. An unpaid order cancelled by the time
 * limit has `is_paid` false and is caught by that. One that was paid and THEN
 * cancelled by the restaurant (cancel_paid_order, 0059) keeps `is_paid` true
 * and already has its refund: if the attempt that paid it is asked again
 * before its stamp landed, calling it "not the payer" would send a second
 * refund for the same money.
 */
export function orderCouldBePaidBy(order: PayerOrder, attempt: PayerAttempt): boolean {
  return (
    order.is_paid &&
    order.status !== "awaiting_customer" &&
    order.status !== "pending" &&
    order.payment_method === "mobile_money" &&
    Number(order.total) === attempt.amount
  );
}

export function orderPayerVerdict(
  order: PayerOrder,
  attempt: PayerAttempt,
  /** Null when the other attempts could not be read. */
  others: OtherConfirmedAttempt[] | null,
): PayerVerdict {
  // The order's own record wins over everything inferred from its state.
  if (orderNamesItsPayer(order)) return order.paid_attempt_id === attempt.id ? "yes" : "no";
  if (!orderCouldBePaidBy(order, attempt)) return "no";

  if (others === null) return "unknown";
  const rivals = others.filter((other) => other.id !== attempt.id);
  if (rivals.some((other) => other.settledAt && !other.refundDue)) return "no";

  const earlier = rivals.some(
    (other) =>
      !other.settledAt &&
      (other.createdAt < attempt.createdAt || (other.createdAt === attempt.createdAt && other.id < attempt.id)),
  );
  return earlier ? "no" : "yes";
}
