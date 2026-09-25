import { defineDict } from "../define";

/**
 * Customer reviews and replies (/m/reviews).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `mrv.` so two modules can never collide.
 */
export const reviewsDict = defineDict({
  fr: {
    "mrv.title": "Avis",
    "mrv.subtitle": "Répondez publiquement — une réponse posée vaut mieux qu'un silence.",

    /* ── Chiffres d'en-tête ──────────────────────────────────────────── */
    "mrv.stat.average": "Note moyenne",
    "mrv.stat.averageHint": "sur {count} avis",
    "mrv.stat.unanswered": "À traiter",
    "mrv.stat.unansweredHint": "Nouveaux avis sans réponse, réaction ni lecture.",
    "mrv.stat.reported": "Signalés",
    "mrv.stat.reportedHint": "En cours d'examen par la plateforme.",

    /* ── Filtres ─────────────────────────────────────────────────────── */
    "mrv.filter.all": "Tous",
    "mrv.filter.unanswered": "À traiter",
    "mrv.filter.answered": "Répondus",
    "mrv.filter.reported": "Signalés",

    /* ── Une carte d'avis ────────────────────────────────────────────── */
    "mrv.anonymous": "Client",
    "mrv.noBody": "Note laissée sans commentaire.",
    "mrv.yourReply": "Votre réponse",
    "mrv.repliedMeta": "Publiée le {date}",
    "mrv.repliedMetaBy": "Publiée par {name} le {date}",
    "mrv.reportedBanner": "Signalé : {reason}",
    "mrv.reportedPending": "La plateforme examine ce signalement. L'avis reste visible en attendant.",

    "mrv.action.reply": "Répondre",
    "mrv.action.markRead": "J'ai lu",
    "mrv.markAllRead": "Tout marquer comme lu",
    "mrv.markAllDone": "Tous les avis sont marqués comme lus.",
    "mrv.new": "Nouveau",
    "mrv.react": "Réagir",
    "mrv.reaction.heart": "J'adore",
    "mrv.reaction.thanks": "Merci",
    "mrv.reaction.like": "J'aime",
    "mrv.action.editReply": "Modifier la réponse",
    "mrv.action.report": "Signaler",

    /* ── Fenêtre de réponse ──────────────────────────────────────────── */
    "mrv.reply.title": "Répondre publiquement",
    "mrv.reply.for": "Avis de {name}",
    "mrv.reply.label": "Votre réponse",
    "mrv.reply.placeholder": "Merci pour votre retour…",
    "mrv.reply.hint": "Visible publiquement sous l'avis, sur votre fiche restaurant.",
    "mrv.reply.submit": "Publier la réponse",
    "mrv.reply.done": "Réponse publiée.",

    /* ── Fenêtre de signalement ──────────────────────────────────────── */
    "mrv.report.title": "Signaler à la modération",
    "mrv.report.for": "Avis de {name}",
    "mrv.report.intro":
      "La plateforme lit votre motif, puis décide de retirer l'avis ou de le conserver. Signaler ne le masque pas.",
    "mrv.report.label": "Motif du signalement",
    "mrv.report.placeholder":
      "Ex. : propos injurieux, avis d'un concurrent, ne concerne pas notre établissement…",
    "mrv.report.hint":
      "Un motif précis fait gagner du temps au modérateur. Être en désaccord avec la note n'en est pas un.",
    "mrv.report.submit": "Envoyer le signalement",
    "mrv.report.done": "Avis signalé. La plateforme va l'examiner.",

    /* ── États vides ─────────────────────────────────────────────────── */
    "mrv.empty.title": "Aucun avis pour l'instant",
    "mrv.empty.body":
      "Les avis de vos clients apparaîtront ici dès la première note laissée après une commande.",
    "mrv.noResults.title": "Aucun avis dans ce filtre",
    "mrv.noResults.body": "Changez de filtre pour revoir les autres avis.",
  },
  en: {
    "mrv.title": "Reviews",
    "mrv.subtitle": "Reply in public — a measured answer beats silence.",

    "mrv.stat.average": "Average rating",
    "mrv.stat.averageHint": "across {count} reviews",
    "mrv.stat.unanswered": "To handle",
    "mrv.stat.unansweredHint": "New reviews with no reply, reaction or read mark yet.",
    "mrv.stat.reported": "Reported",
    "mrv.stat.reportedHint": "Being looked at by the platform.",

    "mrv.filter.all": "All",
    "mrv.filter.unanswered": "To handle",
    "mrv.filter.answered": "Answered",
    "mrv.filter.reported": "Reported",

    "mrv.anonymous": "Customer",
    "mrv.noBody": "Rating left without a comment.",
    "mrv.yourReply": "Your reply",
    "mrv.repliedMeta": "Posted on {date}",
    "mrv.repliedMetaBy": "Posted by {name} on {date}",
    "mrv.reportedBanner": "Reported: {reason}",
    "mrv.reportedPending": "The platform is looking at this report. The review stays visible meanwhile.",

    "mrv.action.reply": "Reply",
    "mrv.action.markRead": "Mark as read",
    "mrv.markAllRead": "Mark all as read",
    "mrv.markAllDone": "All reviews are marked as read.",
    "mrv.new": "New",
    "mrv.react": "React",
    "mrv.reaction.heart": "Love it",
    "mrv.reaction.thanks": "Thank you",
    "mrv.reaction.like": "Like",
    "mrv.action.editReply": "Edit the reply",
    "mrv.action.report": "Report",

    "mrv.reply.title": "Reply in public",
    "mrv.reply.for": "Review by {name}",
    "mrv.reply.label": "Your reply",
    "mrv.reply.placeholder": "Thank you for your feedback…",
    "mrv.reply.hint": "Shown publicly under the review, on your restaurant page.",
    "mrv.reply.submit": "Post the reply",
    "mrv.reply.done": "Reply posted.",

    "mrv.report.title": "Report to moderation",
    "mrv.report.for": "Review by {name}",
    "mrv.report.intro":
      "The platform reads your reason, then decides whether to take the review down or keep it. Reporting does not hide it.",
    "mrv.report.label": "Reason for reporting",
    "mrv.report.placeholder":
      "e.g. abusive language, a competitor's review, not about our restaurant…",
    "mrv.report.hint":
      "A specific reason saves the moderator time. Disagreeing with the rating is not one.",
    "mrv.report.submit": "Send the report",
    "mrv.report.done": "Review reported. The platform will look at it.",

    "mrv.empty.title": "No reviews yet",
    "mrv.empty.body":
      "Your customers' reviews will show up here as soon as the first rating is left after an order.",
    "mrv.noResults.title": "No reviews in this filter",
    "mrv.noResults.body": "Switch filters to see the other reviews.",
  },
});
