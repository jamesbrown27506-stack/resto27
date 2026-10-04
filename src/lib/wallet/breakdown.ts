/**
 * Where a restaurant's wallet balance came from — read off the ledger.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE TILES MUST ADD UP TO THE BALANCE.
 *
 *  The wallet page used to show "Sales collected" computed from the ORDERS
 *  table, and a "payment fees" tile beside it. A restaurant with 2 000 FCFA
 *  in the wallet saw 1 000 of sales and no explanation for the other 1 000 —
 *  it was a reservation deposit, which no tile counted. And the platform's
 *  own fee is the platform's business, not a line on the restaurant's money.
 *
 *  So every figure now comes from `wallet_ledger`, the one record of every
 *  franc in and out, sorted into buckets the owner recognises. The buckets
 *  partition the ledger: their sum IS the balance, whatever happened.
 *
 *  The ledger stores no category, so it is derived from `kind`, the note
 *  and the reference each writer stamps (see the writers in 0059, 0060,
 *  0062, 0068, 0070, collect.ts, wallet-actions.ts, withdrawals.ts):
 *
 *    orders              payment / legacy 'order' — online orders (CMD-…)
 *    tables              payment, note "Table …" — bills paid at the table
 *    reservations        deposit — booking deposits, online or at the counter
 *    orderRefunds        adjustment < 0 — a paid order cancelled and refunded
 *    reservationRefunds  adjustment < 0 on a booking (RES-… / "Reservation …")
 *    withdrawals         withdrawal, and the credit-back of one that failed
 *    credits             everything else: top-ups and platform adjustments
 *
 *  Plain module — unit tested in breakdown.test.ts.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type LedgerBucket =
  | "orders"
  | "tables"
  | "reservations"
  | "orderRefunds"
  | "reservationRefunds"
  | "withdrawals"
  | "credits";

export interface LedgerEntry {
  amount: number;
  kind: string;
  note: string | null;
  reference: string | null;
}

export function ledgerBucket(entry: LedgerEntry): LedgerBucket {
  const note = entry.note ?? "";
  const reference = entry.reference ?? "";

  switch (entry.kind) {
    case "withdrawal":
      return "withdrawals";
    case "deposit":
      return "reservations";
    case "adjustment":
      if (entry.amount > 0) return note.startsWith("Withdrawal ") ? "withdrawals" : "credits";
      return reference.startsWith("RES-") || note.startsWith("Reservation ") ? "reservationRefunds" : "orderRefunds";
    case "payment":
    case "order":
      if (note.startsWith("Table ")) return "tables";
      if (note.startsWith("Approvisionnement")) return "credits";
      // Every automatic credit stamps a reference; a manual one does not.
      if (entry.kind === "payment" && !entry.reference) return "credits";
      return "orders";
    default:
      return "credits";
  }
}

export type WalletBreakdown = Record<LedgerBucket, number> & {
  /** The sum of every bucket — equal to the wallet balance. */
  total: number;
};

export function summarizeLedger(entries: LedgerEntry[]): WalletBreakdown {
  const sums: WalletBreakdown = {
    orders: 0,
    tables: 0,
    reservations: 0,
    orderRefunds: 0,
    reservationRefunds: 0,
    withdrawals: 0,
    credits: 0,
    total: 0,
  };
  for (const entry of entries) {
    const amount = Number(entry.amount) || 0;
    sums[ledgerBucket(entry)] += amount;
    sums.total += amount;
  }
  return sums;
}
