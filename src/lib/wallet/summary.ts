/** Safe, minimal wallet data for the restaurant navigation. No ledger or recipients. */
export interface BranchWalletSummary {
  restaurantId: string;
  /** Null means the balance/reserve could not be verified, never a guessed zero. */
  available: number | null;
  held: number | null;
  /** Query start time: an older request must not overwrite a newer page refresh. */
  checkedAt: string;
}

/** Keep branch switches and an older in-flight read from showing the wrong funds. */
export function latestBranchWalletSummary(
  restaurantId: string | null,
  initial: BranchWalletSummary | null,
  update: { restaurantId: string | null; wallet: BranchWalletSummary | null },
): BranchWalletSummary | null {
  const seed = initial?.restaurantId === restaurantId ? initial : null;
  if (update.restaurantId !== restaurantId) return seed;
  const next = update.wallet;
  // A denied membership clears previously serialized money, rather than retaining it.
  if (!next || next.restaurantId !== restaurantId) return null;
  return seed && seed.checkedAt > next.checkedAt ? seed : next;
}
