export interface LoyaltySummary {
  pointValue: number;
  outstandingPoints: number;
  outstandingValue: number;
  customersWithPoints: number;
  negativeBalances: number;
  pendingRedemptionValue: number;
  fundedValue: number;
  reversedValue: number;
  restaurantBalances: number;
  customerBalances: number;
  pendingRefunds: number;
  pendingWithdrawals: number;
  unconfirmedPayouts: number;
}

/** Pending withdrawals and funded loyalty are already inside restaurant balances. */
export function loyaltyReserve(summary: LoyaltySummary, gatewayBalance: number | null) {
  const cashObligations = summary.restaurantBalances + summary.customerBalances + summary.pendingRefunds;
  const futureLoyalty = summary.outstandingValue + summary.pendingRedemptionValue;
  // Unconfirmed payouts may already have left CamerPay. Reserve them
  // conservatively until their final outcome is recorded; never count them as income.
  const recommended = cashObligations + futureLoyalty + summary.unconfirmedPayouts;
  return { cashObligations, futureLoyalty, recommended,
    shortfall: gatewayBalance === null ? null : Math.max(0, recommended - gatewayBalance),
    surplus: gatewayBalance === null ? null : Math.max(0, gatewayBalance - recommended) };
}
