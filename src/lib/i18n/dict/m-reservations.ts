import { defineDict } from "../define";

/**
 * Reservation timing, restaurant cancellation and sitting length — the
 * strings added with migration 0060 on /m/reservations, /m/tables and the
 * reservation panel of /m/settings.
 *
 * OWNED BY THOSE SCREENS. Prefix every key with `mres.` so two modules can
 * never collide. The older `res.*` / `tbl.*` keys still live in the base
 * dictionary; new copy for these screens goes here rather than growing it.
 */
export const mReservationsDict = defineDict({
  fr: {
    /* Board */
    "mres.window": "{start} – {end}",
    "mres.answerBefore": "Répondre avant {time}",
    "mres.answerLate": "Délai de réponse dépassé — la demande va expirer",
    "mres.noShowFrom": "Absence possible à partir de {time}",
    "mres.cancelBooking": "Annuler",
    "mres.cancelTitle": "Annuler une réservation confirmée",
    "mres.cancelBody":
      "Le client est prévenu immédiatement, avec votre raison. Préférez « Absent » si le client ne s'est simplement pas présenté.",
    "mres.cancelRefund":
      "L'acompte de {amount} FCFA réglé en ligne sera intégralement remboursé au client sur Mobile Money, et débité de votre portefeuille.",
    "mres.cancelNoRefund": "Aucun acompte en ligne n'a été réglé : rien n'est remboursé.",
    "mres.cancelReasonPh": "Ex. : salle privatisée ce soir pour un événement.",
    "mres.cancelConfirm": "Annuler la réservation",
    "mres.cancelDone": "Réservation annulée — le client est prévenu.",

    /* Floor */
    "mres.floor.reserved": "Réservée",
    "mres.floor.heldBy": "{name} · {start}–{end}",

    /* Settings */
    "mres.set.title": "Réservations",
    "mres.set.description": "Combien de temps une réservation bloque sa table.",
    "mres.set.duration": "Durée d'une réservation",
    "mres.set.durationHint":
      "Pendant ce temps, la table n'est proposée à personne d'autre. S'applique aux nouvelles réservations ; celles déjà prises gardent leur durée.",
    "mres.set.minutes": "{count} min",
    "mres.set.hours": "{h} h",
    "mres.set.hoursMinutes": "{h} h {m}",
    "mres.set.saved": "Durée des réservations enregistrée.",
    "mres.set.failed": "La durée n'a pas pu être enregistrée.",
  },
  en: {
    "mres.window": "{start} – {end}",
    "mres.answerBefore": "Answer before {time}",
    "mres.answerLate": "Answer time is over — the request is about to expire",
    "mres.noShowFrom": "No-show possible from {time}",
    "mres.cancelBooking": "Cancel",
    "mres.cancelTitle": "Cancel a confirmed reservation",
    "mres.cancelBody":
      "The guest is told straight away, with your reason. Use “No show” instead if the guest simply did not turn up.",
    "mres.cancelRefund":
      "The {amount} FCFA deposit paid online will be refunded in full to the guest's Mobile Money and debited from your wallet.",
    "mres.cancelNoRefund": "No online deposit was paid: nothing is refunded.",
    "mres.cancelReasonPh": "E.g. the room is booked for a private event tonight.",
    "mres.cancelConfirm": "Cancel the reservation",
    "mres.cancelDone": "Reservation cancelled — the guest has been told.",

    "mres.floor.reserved": "Reserved",
    "mres.floor.heldBy": "{name} · {start}–{end}",

    "mres.set.title": "Reservations",
    "mres.set.description": "How long a reservation holds its table.",
    "mres.set.duration": "Reservation length",
    "mres.set.durationHint":
      "During this time the table is offered to nobody else. Applies to new reservations; existing ones keep their length.",
    "mres.set.minutes": "{count} min",
    "mres.set.hours": "{h} h",
    "mres.set.hoursMinutes": "{h} h {m}",
    "mres.set.saved": "Reservation length saved.",
    "mres.set.failed": "The reservation length could not be saved.",
  },
});
