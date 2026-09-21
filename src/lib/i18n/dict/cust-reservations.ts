import { defineDict } from "../define";

/**
 * Table bookings (/reservations).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * `crs.status.*` is read through `reservationStatusLabel` in
 * lib/format/reservation-status, which is what replaced a Record of French
 * strings that no amount of page translation could reach.
 *
 * Prefix every key with `crs.` so two modules can never collide.
 */
export const custReservationsDict = defineDict({
  fr: {
    "crs.title": "Réservations",
    "crs.subtitle": "Réservez une table et suivez vos demandes.",

    "crs.status.pending": "En attente",
    "crs.status.awaiting_payment": "Acompte à régler",
    "crs.status.confirmed": "Confirmée",
    "crs.status.seated": "Attablée",
    "crs.status.completed": "Honorée",
    "crs.status.cancelled": "Annulée",
    "crs.status.no_show": "Absent",

    "crs.upcoming": "À venir",
    "crs.upcomingEmpty": "Aucune réservation à venir",
    "crs.upcomingEmptyBody": "Utilisez le formulaire pour réserver une table.",
    "crs.history": "Historique",
    "crs.historyEmpty": "Aucune réservation passée",

    "crs.people": "{count} personne(s)",
    "crs.table": "table {number}",
    "crs.cancel": "Annuler",
    "crs.expiredPending": "Demande expirée",
    "crs.withdrawExpired": "Retirer la demande",
    "crs.cancelPolicyExpired": "Le créneau est passé sans confirmation. Aucun paiement ni frais d’annulation.",
    "crs.cancelBodyExpired": "Cette demande sera retirée de la liste d’attente et le restaurant sera prévenu.",

    "crs.book": "Réserver une table",
    "crs.restaurant": "Restaurant",
    "crs.date": "Date",
    "crs.guests": "Convives",
    "crs.slotFull": "Complet à cette heure",
    "crs.someSlotsFull": "Les créneaux barrés sont complets pour ce nombre de convives.",
    "crs.dayFull": "Plus aucune table pour {count} convive(s) ce jour-là. Essayez un autre jour, ou un groupe plus petit.",
    "crs.checkingAvailability": "Vérification des disponibilités…",
    "crs.availabilityFailed":
      "Les disponibilités n'ont pas pu être vérifiées. Vous pouvez quand même demander — le restaurant confirmera.",
    "crs.slot": "Créneau",
    "crs.pickDateFirst": "Choisissez d'abord une date.",
    "crs.openWindow": "Ouvert de {opens} à {closes} ce jour-là.",
    "crs.closedThatDay": "Ce restaurant est fermé ce jour-là. Choisissez une autre date.",
    "crs.noSlotsToday":
      "Plus de créneau ce soir — le service se termine. Choisissez une autre date.",
    "crs.notes": "Précisions",
    "crs.notesPh": "Anniversaire, près de la fenêtre…",
    "crs.deposit": "Acompte de {amount}.",
    "crs.depositAfterConfirm":
      "Rien n'est prélevé maintenant. Le restaurant examine votre demande, et l'acompte ne vous est demandé que s'il l'accepte. Il est déduit de votre addition.",
    "crs.depositDue": "Acompte de {amount} à régler.",
    "crs.depositDueBody":
      "Le restaurant garde votre table. Réglez l'acompte pour confirmer la réservation — il est déduit de votre addition sur place.",
    "crs.depositPaidDone": "Acompte réglé. Votre table est confirmée.",
    "crs.phoneRequired": "Entrez votre numéro Mobile Money.",
    "crs.depositBody":
      "Payé en ligne maintenant par Mobile Money — déduit de votre addition finale une fois sur place.",
    "crs.phone": "Numéro Mobile Money",
    "crs.phoneHint": "MTN MoMo ou Orange Money.",
    "crs.phonePh": "6XXXXXXXX",
    "crs.payDeposit": "Payer l'acompte {amount} et confirmer",
    "crs.payPendingTitle": "Confirmation du paiement en cours…",
    "crs.payPendingBody":
      "Validez la demande sur votre téléphone. La page se met à jour automatiquement.",
    "crs.payPendingHint":
      "Vous pouvez fermer cet écran sans interrompre le paiement. CamerPay et Resto237 continuent de le suivre en arrière-plan.",
    "crs.pendingBanner":
      "Votre paiement Mobile Money attend toujours sa confirmation. Ne lancez pas un deuxième paiement.",
    "crs.viewPayment": "Voir le paiement en cours",
    "crs.continueBackground": "Continuer en arrière-plan",
    "crs.paymentAmount": "Montant",
    "crs.paymentReference": "Réservation",
    "crs.paymentPhone": "Téléphone",
    "crs.paymentGateway": "Passerelle sécurisée",
    "crs.payFailed": "Le paiement de l'acompte n'a pas abouti. Réessayez.",
    "crs.payExpiredTitle": "Confirmation expirée",
    "crs.payExpiredBody":
      "Le délai de confirmation Mobile Money de cinq minutes est dépassé. Aucun paiement n'a été validé. Vous pouvez lancer une nouvelle demande.",
    "crs.payRetry": "Réessayer le paiement",
    "crs.payStillPending":
      "La confirmation prend plus de temps que prévu. Votre paiement reste suivi en arrière-plan — revenez ici dans quelques instants.",
    "crs.depositPerSeatMath": "{rate} par convive × {guests} convive(s).",
    "crs.depositPercent": "Acompte : {pct}% de votre addition finale.",
    "crs.depositPercentBody":
      "Aucun paiement en ligne — le pourcentage est réglé au restaurant et déduit de votre addition.",
    "crs.submit": "Demander la réservation",
    "crs.formHint":
      "Votre demande est envoyée au restaurant, qui la confirme ou propose un autre créneau.",

    "crs.sent": "Demande envoyée. Le restaurant confirme sous peu.",
    "crs.cancelled": "Réservation annulée.",
    "crs.cancelTitle": "Annuler cette réservation ?",
    "crs.cancelBody": "Le restaurant sera prévenu, la table sera libérée et le remboursement Mobile Money restera en attente jusqu’à la confirmation de CamerPay.",
    "crs.cancelPolicyFree": "Il reste au moins une heure : aucun frais d’annulation n’est appliqué et l’acompte est remboursé à 100 %.",
    "crs.cancelFreeUntil": "Annulation gratuite jusqu’à {time}.",
    "crs.cancelChargeNow": "Des frais d’annulation de 30 % s’appliquent maintenant.",
    "crs.refundWalletTitle": "Remboursement crédité",
    "crs.refundWalletBody": "{amount} ajouté à votre portefeuille pour la réservation {reference}.",
    "crs.useBalance": "Utiliser mon solde",
    "crs.refundBalanceAfter": "Solde après remboursement : {amount}",
    "crs.cancelPolicyLate": "Il reste moins d’une heure : des frais d’annulation tardive de 30 % s’appliquent et 70 % de l’acompte est remboursé.",
    "crs.cancelDeposit": "Acompte payé",
    "crs.cancelRefund": "Remboursé au client",
    "crs.cancelFee": "Frais d’annulation tardive (30 %)",
    "crs.refundPending": "Réservation annulée. Le remboursement Mobile Money est en cours.",
    "crs.refundDone": "Remboursement Mobile Money confirmé.",
    "crs.refundFailed": "Le remboursement Mobile Money a échoué. Contactez l’assistance Resto237.",
    "crs.refundStatusPending": "Remboursement {amount} en cours",
    "crs.refundStatusDone": "Remboursé {amount}",
    "crs.refundStatusFailed": "Remboursement {amount} à vérifier",
    "crs.cancelConfirm": "Annuler la réservation",
    "crs.cancelKeep": "Garder",
  },
  en: {
    "crs.title": "Bookings",
    "crs.subtitle": "Book a table and follow your requests.",

    "crs.status.pending": "Pending",
    "crs.status.awaiting_payment": "Deposit due",
    "crs.status.confirmed": "Confirmed",
    "crs.status.seated": "Seated",
    "crs.status.completed": "Honoured",
    "crs.status.cancelled": "Cancelled",
    "crs.status.no_show": "No show",

    "crs.upcoming": "Upcoming",
    "crs.upcomingEmpty": "No upcoming bookings",
    "crs.upcomingEmptyBody": "Use the form to book a table.",
    "crs.history": "History",
    "crs.historyEmpty": "No past bookings",

    "crs.people": "{count} people",
    "crs.table": "table {number}",
    "crs.cancel": "Cancel",
    "crs.expiredPending": "Request expired",
    "crs.withdrawExpired": "Withdraw request",
    "crs.cancelPolicyExpired": "The booking time passed without confirmation. No payment or cancellation fee applies.",
    "crs.cancelBodyExpired": "This request will be removed from the waiting list and the restaurant will be notified.",

    "crs.book": "Book a table",
    "crs.restaurant": "Restaurant",
    "crs.date": "Date",
    "crs.guests": "Guests",
    "crs.slotFull": "Fully booked at this time",
    "crs.someSlotsFull": "Crossed-out times are fully booked for this party size.",
    "crs.dayFull": "No table left for {count} on that day. Try another day, or a smaller party.",
    "crs.checkingAvailability": "Checking availability…",
    "crs.availabilityFailed":
      "Availability could not be checked. You can still request — the restaurant will confirm.",
    "crs.slot": "Time",
    "crs.pickDateFirst": "Pick a date first.",
    "crs.openWindow": "Open {opens} – {closes} that day.",
    "crs.closedThatDay": "This restaurant is closed that day. Pick another date.",
    "crs.noSlotsToday":
      "No seatings left tonight — service is ending. Pick another date.",
    "crs.notes": "Notes",
    "crs.notesPh": "Birthday, near the window…",
    "crs.deposit": "{amount} deposit.",
    "crs.depositAfterConfirm":
      "Nothing is taken now. The restaurant reviews your request, and the deposit is only asked for if it accepts. It comes off your bill.",
    "crs.depositDue": "{amount} deposit due.",
    "crs.depositDueBody":
      "The restaurant is holding your table. Pay the deposit to confirm the booking — it comes off your bill when you arrive.",
    "crs.depositPaidDone": "Deposit paid. Your table is confirmed.",
    "crs.phoneRequired": "Enter your Mobile Money number.",
    "crs.depositBody":
      "Paid online now by Mobile Money — deducted from your final bill once you arrive.",
    "crs.phone": "Mobile Money number",
    "crs.phoneHint": "MTN MoMo or Orange Money.",
    "crs.phonePh": "6XXXXXXXX",
    "crs.payDeposit": "Pay the {amount} deposit and confirm",
    "crs.payPendingTitle": "Waiting for payment confirmation…",
    "crs.payPendingBody":
      "Approve the request on your phone. This page updates automatically.",
    "crs.payPendingHint":
      "You may close this screen without interrupting payment. CamerPay and Resto237 will keep tracking it in the background.",
    "crs.pendingBanner":
      "Your Mobile Money payment is still awaiting confirmation. Do not start a second payment.",
    "crs.viewPayment": "View pending payment",
    "crs.continueBackground": "Continue in background",
    "crs.paymentAmount": "Amount",
    "crs.paymentReference": "Booking",
    "crs.paymentPhone": "Phone",
    "crs.paymentGateway": "Secure gateway",
    "crs.payFailed": "The deposit payment did not go through. Please try again.",
    "crs.payExpiredTitle": "Confirmation expired",
    "crs.payExpiredBody":
      "The five-minute Mobile Money confirmation window has expired. No payment was confirmed. You can start a new request.",
    "crs.payRetry": "Try payment again",
    "crs.payStillPending":
      "Confirmation is taking longer than expected. Your payment is still tracked in the background — check back here shortly.",
    "crs.depositPerSeatMath": "{rate} per guest × {guests} guest(s).",
    "crs.depositPercent": "Deposit: {pct}% of your final bill.",
    "crs.depositPercentBody":
      "No online charge — the percentage is settled at the restaurant and deducted from your bill.",
    "crs.submit": "Request the booking",
    "crs.formHint":
      "Your request goes to the restaurant, which confirms it or offers another time.",

    "crs.sent": "Request sent. The restaurant will confirm shortly.",
    "crs.cancelled": "Booking cancelled.",
    "crs.cancelTitle": "Cancel this booking?",
    "crs.cancelBody": "The restaurant will be notified, the table released, and the Mobile Money refund will remain pending until CamerPay confirms it.",
    "crs.cancelPolicyFree": "At least one hour remains: there is no cancellation charge and 100% of the deposit is refunded.",
    "crs.cancelFreeUntil": "Free cancellation until {time}.",
    "crs.cancelChargeNow": "A 30% cancellation charge applies now.",
    "crs.refundWalletTitle": "Refund credited",
    "crs.refundWalletBody": "{amount} added to your wallet for reservation {reference}.",
    "crs.useBalance": "Use my balance",
    "crs.refundBalanceAfter": "Balance after refund: {amount}",
    "crs.cancelPolicyLate": "Less than one hour remains: a 30% late cancellation fee applies and 70% of the deposit is refunded.",
    "crs.cancelDeposit": "Deposit paid",
    "crs.cancelRefund": "Refunded to customer",
    "crs.cancelFee": "Late cancellation fee (30%)",
    "crs.refundPending": "Booking cancelled. The Mobile Money refund is processing.",
    "crs.refundDone": "Mobile Money refund confirmed.",
    "crs.refundFailed": "The Mobile Money refund failed. Contact Resto237 support.",
    "crs.refundStatusPending": "{amount} refund processing",
    "crs.refundStatusDone": "{amount} refunded",
    "crs.refundStatusFailed": "{amount} refund needs attention",
    "crs.cancelConfirm": "Cancel the booking",
    "crs.cancelKeep": "Keep it",
  },
});
