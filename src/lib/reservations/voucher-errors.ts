import type { TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * redeem_reservation_voucher's refusals (0068), as dictionary keys — shared by
 * the table bill (dining-actions) and the voucher page (voucher-actions) so a
 * waiter reads the same sentence wherever they scanned the code.
 */
export function voucherErrorKey(message: string): TranslationKey {
  if (message.includes("voucher_not_found")) return "ons.err.voucherNotFound";
  if (message.includes("voucher_used")) return "ons.err.voucherUsed";
  if (message.includes("voucher_expired")) return "ons.err.voucherExpired";
  if (message.includes("voucher_too_early")) return "ons.err.voucherTooEarly";
  if (message.includes("voucher_cancelled")) return "ons.err.voucherCancelled";
  if (message.includes("voucher_not_confirmed")) return "ons.err.voucherNotConfirmed";
  if (message.includes("staff_forbidden")) return "ons.err.voucherOtherRestaurant";
  if (message.includes("session_not_open")) return "est.tableSessionNotFound";
  if (message.includes("table_unavailable")) return "est.tableOutOfService";
  return "ons.err.voucherFailed";
}
