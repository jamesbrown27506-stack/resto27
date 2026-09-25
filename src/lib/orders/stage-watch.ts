/**
 * FORGOTTEN STEPS — the rules the order watchdog applies (0065). Pure.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  The app REMINDS about steps that should have moved (it never moves an
 *  order forward itself — "on its way" must never be said about food still
 *  in the kitchen), and FINISHES orders whose last button was never pressed
 *  (closing only records what already happened).
 *
 *    paid, not started        one reminder after PAID_NOT_STARTED_MINUTES
 *    preparing                a reminder at 1× the restaurant's usual time,
 *                             a second (and the admins) at 2×
 *    on its way / ready       finished after AUTO_CLOSE_HOURS.paid
 *    served, bill paid        finished after AUTO_CLOSE_HOURS.paid
 *    served, bill unrecorded  finished after AUTO_CLOSE_HOURS.unpaidTable,
 *                             marked "paiement non enregistré"
 *
 *  The database gate (cron_due_orders in 0065) mirrors these numbers — keep
 *  them in step.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const PAID_NOT_STARTED_MINUTES = 10;

export const AUTO_CLOSE_HOURS = { paid: 3, unpaidTable: 12 } as const;

/** The restaurant's usual time, bounded to something sensible (15 min – 2 h). */
export function prepMinutes(estimateMinutes: number | null | undefined): number {
  const n = Number(estimateMinutes);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(Math.max(Math.round(n), 15), 120);
}

/**
 * Which preparing reminder is due now (1 or 2), or null. `alreadySent` is how
 * many were sent for THIS step (0, 1 or 2).
 */
export function prepNudgeDue(input: {
  enteredAt: number;
  now: number;
  estimateMinutes: number | null | undefined;
  alreadySent: number;
}): 1 | 2 | null {
  if (input.alreadySent >= 2) return null;
  const next = (input.alreadySent + 1) as 1 | 2;
  const dueAfter = prepMinutes(input.estimateMinutes) * next * 60_000;
  return input.now - input.enteredAt >= dueAfter ? next : null;
}
