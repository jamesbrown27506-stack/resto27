import type { TranslationKey } from "@/lib/i18n/dictionaries";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/**
 * What collect.ts says when CamerPay refuses a charge and gives no message of
 * its own. Shared so paymentErrorMessage can tell "the operator explained
 * itself" (worth passing on) from "we filled the gap" (translate it).
 */
export const PROVIDER_REFUSED_FALLBACK = "Le paiement a été refusé par l'opérateur.";

/**
 * collect.ts / invoice-activation.ts failure codes → dictionary keys.
 *
 * Only the codes that reach an initiate/settle/check result are listed; the
 * resolution-only codes (claimLost, providerRowTaken, …) never leave the
 * webhook and cron paths, which render nothing.
 */
const REASON_KEYS: Record<string, TranslationKey> = {
  // initiatePaymentAttempt
  badPhone: "ecu.pay.badPhone",
  badAmount: "ecu.pay.badAmount",
  amountOutOfRange: "ecu.pay.amountOutOfRange",
  invoiceMissing: "ecu.pay.invoiceMissing",
  reservationMissing: "ecu.pay.reservationMissing",
  orderMissing: "ecu.pay.orderMissing",
  recordFailed: "ecu.pay.recordFailed",
  providerUnavailable: "ecu.pay.providerUnavailable",
  providerRefused: "ecu.pay.providerRefused",
  // checkPaymentAttempt / settlePayment / settleConfirmedAttempt
  attemptNotFound: "ecu.paymentNotFound",
  notConfirmed: "ecu.pay.notConfirmed",
  settleFailed: "ecu.pay.settleFailed",
  paymentFailed: "ecu.paymentFailed",
  activationFailed: "ecu.pay.settleFailed",
  walletFundingClaimFailed: "ecu.pay.walletCreditFailed",
  walletCreditFailed: "ecu.pay.walletCreditFailed",
  orderNotPayable: "ecu.pay.orderNotPayable",
  orderSettlementFailed: "ecu.pay.orderSettlementFailed",
  reservationClaimFailed: "ecu.pay.reservationClaimFailed",
  reservationNotFound: "ecu.reservationNotFound",
  reservationPromotionFailed: "ecu.pay.reservationPromotionFailed",
  reservationNotPayable: "ecu.pay.reservationNotPayable",
  attemptIncomplete: "ecu.pay.attemptIncomplete",
  // activateFromInvoice (subscription settlement)
  invoiceNotFound: "est.invoiceNotFound",
  invoiceVoid: "ecu.pay.invoiceVoid",
  noSubscription: "est.noSubscription",
  invoiceClaimFailed: "ecu.pay.invoiceClaimFailed",
  subscriptionExtendFailed: "ecu.pay.subscriptionExtendFailed",
  invoiceRepriced: "ecu.pay.invoiceRepriced",
};

/**
 * A payment failure in the reader's language.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE MACHINE CODE DECIDES, THE PROSE IS ONLY A FALLBACK.
 *
 *  collect.ts returns a French `error` next to every stable `reason`, and the
 *  customer and restaurant actions used to forward that `error` verbatim — so
 *  an English customer paying a deposit read "Numéro invalide. Attendu : 9
 *  chiffres…". The reason is mapped here instead. An unknown code (a new one
 *  added to collect.ts and not yet here) falls back to the French sentence,
 *  and a result with neither to the caller's own key: never a blank toast.
 *
 *  A CamerPay refusal that carries the operator's own words keeps them — "not
 *  enough balance" from the operator is more useful than our generic line —
 *  wrapped in a translated sentence.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function paymentErrorMessage(
  result: { reason?: string; error?: string },
  t: Translate,
  fallback: TranslationKey,
): string {
  if (result.reason === "providerRefused" && result.error && result.error !== PROVIDER_REFUSED_FALLBACK) {
    return t("ecu.pay.providerRefusedDetail", { detail: result.error });
  }
  const key = result.reason ? REASON_KEYS[result.reason] : undefined;
  if (key) return t(key);
  return result.error ?? t(fallback);
}
