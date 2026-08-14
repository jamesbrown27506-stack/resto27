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
    "crs.notes": "Précisions",
    "crs.notesPh": "Anniversaire, près de la fenêtre…",
    "crs.deposit": "Acompte requis : {amount}.",
    "crs.depositBody":
      "Ce restaurant demande un acompte pour réserver la table — il vous sera demandé pour confirmer.",
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
    "crs.notes": "Notes",
    "crs.notesPh": "Birthday, near the window…",
    "crs.deposit": "Deposit required: {amount}.",
    "crs.depositBody":
      "This restaurant asks for a deposit to hold the table — you will be asked for it to confirm.",
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
