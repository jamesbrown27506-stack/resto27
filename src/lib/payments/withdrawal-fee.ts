/**
 * The withdrawal fee, as ONE pure function (migration 0020).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY A DEDICATED MODULE.
 *
 *  The same math runs in two places that must never disagree: the server
 *  action that executes the payout (probePayout) and the console that shows
 *  the breakdown before the click. It is also the money rule the whole fee
 *  revenue model rests on — which is why it lives here, pure and unit-tested,
 *  instead of inline in a component.
 *
 *  XAF has no decimals, so everything is whole francs: the fee is the gross
 *  × percent, rounded to the nearest franc (half-up), and the net is what
 *  actually leaves the balance.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface WithdrawalFeeSplit {
  /** Withheld francs, kept in the platform balance. */
  fee: number;
  /** What the recipient actually receives — what CamerPay is asked to send. */
  net: number;
}

export function computeWithdrawalFee(gross: number, percent: number): WithdrawalFeeSplit {
  const fee = Math.round((gross * percent) / 100);
  return { fee, net: gross - fee };
}
