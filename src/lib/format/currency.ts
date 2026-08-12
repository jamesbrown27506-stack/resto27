/**
 * Money formatting.
 *
 * XAF is a ZERO-DECIMAL currency — there are no centimes (§13). Amounts are
 * stored as `integer` whole francs, and nothing in the UI may ever render a
 * decimal point. The old MySQL `DECIMAL(10,2)` carried a `.00` that could
 * never be non-zero; if you see one on screen, something upstream is wrong.
 *
 * Every price, total, invoice line and report figure goes through here. Do not
 * inline `toLocaleString` at a call site — the moment two formatters exist,
 * the basket and the receipt start disagreeing.
 */

export const DEFAULT_CURRENCY = "XAF";

/** Currencies with no minor unit. Amounts are already whole units. */
const ZERO_DECIMAL = new Set(["XAF", "XOF", "JPY", "KRW", "CLP", "VND", "GNF"]);

/** What we print instead of the ISO code. "FCFA" is what people actually say. */
const SYMBOL: Record<string, string> = {
  XAF: "FCFA",
  XOF: "CFA",
};

function groupDigits(n: number): string {
  // Narrow non-breaking space as the thousands separator — the French/CFA
  // convention, and non-breaking so "12 500 FCFA" never wraps mid-number.
  return Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export interface MoneyOptions {
  /** ISO code. Kept per-row for the multi-region plan (§13). */
  currency?: string;
  /** Render the unit ("12 500 FCFA" vs "12 500"). Default true. */
  showSymbol?: boolean;
  /** Show an explicit "+" on positive values — used by the loyalty ledger. */
  signed?: boolean;
}

/**
 * @param amount whole units (francs), never minor units for XAF
 */
export function formatMoney(amount: number, options: MoneyOptions = {}): string {
  const { currency = DEFAULT_CURRENCY, showSymbol = true, signed = false } = options;

  const rounded = ZERO_DECIMAL.has(currency) ? Math.round(amount) : amount;
  const sign = rounded < 0 ? "−" : signed && rounded > 0 ? "+" : "";
  const body = groupDigits(rounded);
  const unit = SYMBOL[currency] ?? currency;

  return showSymbol ? `${sign}${body} ${unit}` : `${sign}${body}`;
}

/** Compact form for dashboard tiles: 1,2 M FCFA. Never use on a receipt. */
export function formatMoneyCompact(amount: number, currency = DEFAULT_CURRENCY): string {
  const unit = SYMBOL[currency] ?? currency;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";

  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(".", ",")} M ${unit}`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1000)} k ${unit}`;
  return formatMoney(amount, { currency });
}

/** Percentages — commission rates, service charge, discounts. */
export function formatPercent(value: number, decimals = 0): string {
  return `${value.toFixed(decimals).replace(".", ",")} %`;
}

/**
 * Parse user input back to whole francs. Accepts "12 500", "12.500", "12,500".
 * Returns null on anything unparseable so the caller can show a field error
 * rather than silently storing NaN.
 */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[\s  .,]/g, "");
  if (!/^-?\d+$/.test(cleaned)) return null;
  return Number.parseInt(cleaned, 10);
}
