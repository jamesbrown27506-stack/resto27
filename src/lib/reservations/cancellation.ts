export interface ReservationCancellationQuote {
  late: boolean;
  deposit: number;
  refund: number;
  restaurantCompensation: number;
  platformFee: number;
}

/**
 * Quote the disclosed cancellation split. At exactly one hour or earlier the
 * deposit is fully refundable; inside the final hour the 70/25/5 split applies.
 * PostgreSQL repeats this calculation under a row lock when cancellation runs.
 */
export function quoteReservationCancellation(
  depositPaid: boolean,
  depositAmount: number,
  reservedFor: string | number | Date,
  now: string | number | Date = Date.now(),
): ReservationCancellationQuote {
  const deposit = depositPaid ? Math.max(0, Math.round(Number(depositAmount) || 0)) : 0;
  const reservedMs =
    reservedFor instanceof Date ? reservedFor.getTime() : typeof reservedFor === "number" ? reservedFor : Date.parse(reservedFor);
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  const remaining = reservedMs - nowMs;
  const late = remaining > 0 && remaining < 60 * 60_000;
  const refund = late ? Math.round(deposit * 0.7) : deposit;
  const platformFee = late ? Math.round(deposit * 0.05) : 0;
  return {
    late,
    deposit,
    refund,
    platformFee,
    restaurantCompensation: deposit - refund - platformFee,
  };
}
