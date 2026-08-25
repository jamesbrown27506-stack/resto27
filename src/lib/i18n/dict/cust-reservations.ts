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

    "crs.book": "Réserver une table",
    "crs.restaurant": "Restaurant",
    "crs.date": "Date",
    "crs.guests": "Convives",
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
      "Vous pouvez fermer cet écran sans interrompre le paiement. CamerPay et RestoLink continuent de le suivre en arrière-plan.",
    "crs.pendingBanner":
      "Votre paiement Mobile Money attend toujours sa confirmation. Ne lancez pas un deuxième paiement.",
    "crs.viewPayment": "Voir le paiement en cours",
    "crs.continueBackground": "Continuer en arrière-plan",
    "crs.paymentAmount": "Montant",
    "crs.paymentReference": "Réservation",
    "crs.paymentPhone": "Téléphone",
    "crs.paymentGateway": "Passerelle sécurisée",
    "crs.payFailed": "Le paiement de l'acompte n'a pas abouti. Réessayez.",
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
    "crs.cancelBody": "Le restaurant sera prévenu et la table sera libérée.",
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

    "crs.book": "Book a table",
    "crs.restaurant": "Restaurant",
    "crs.date": "Date",
    "crs.guests": "Guests",
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
      "You may close this screen without interrupting payment. CamerPay and RestoLink will keep tracking it in the background.",
    "crs.pendingBanner":
      "Your Mobile Money payment is still awaiting confirmation. Do not start a second payment.",
    "crs.viewPayment": "View pending payment",
    "crs.continueBackground": "Continue in background",
    "crs.paymentAmount": "Amount",
    "crs.paymentReference": "Booking",
    "crs.paymentPhone": "Phone",
    "crs.paymentGateway": "Secure gateway",
    "crs.payFailed": "The deposit payment did not go through. Please try again.",
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
    "crs.cancelBody": "The restaurant will be told and the table released.",
    "crs.cancelConfirm": "Cancel the booking",
    "crs.cancelKeep": "Keep it",
  },
});
