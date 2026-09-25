import { defineDict } from "../define";

/**
 * Small components that appear on several customer screens: the global error
 * page, the Mobile Money "waiting for your PIN" state, the "add my location"
 * button and the reorder button. Prefix `sui.`.
 *
 * They used to carry their copy inline — `locale === "fr" ? … : …` — or, for
 * the error page, in French only, so an English-speaking customer who hit an
 * error was told "Réessayer".
 */
export const sharedUiDict = defineDict({
  fr: {
    /* ── app/error.tsx ─────────────────────────────────────────────── */
    "sui.error.title": "Une erreur est survenue",
    "sui.error.body":
      "Quelque chose s'est mal passé de notre côté. Réessayez — si le problème persiste, écrivez-nous en mentionnant la référence ci-dessous.",
    "sui.error.retry": "Réessayer",
    "sui.error.home": "Retour à l'accueil",

    /* ── Payment pending (Orange USSD step) ───────────────────────── */
    "sui.pay.orangeTitle": "Action Orange requise",
    "sui.pay.copy": "Copier le code",
    "sui.pay.copied": "Code copié",
    "sui.pay.openPhone": "Ouvrir le téléphone",
    "sui.pay.step1": "Copiez le code",
    "sui.pay.step2": "Ouvrez l’application Téléphone",
    "sui.pay.step3": "Composez le code et validez",
    "sui.pay.step4": "Revenez sur Resto237",
    "sui.pay.iosHint":
      "Sur iPhone, le code ne peut pas être composé depuis un lien : copiez-le, puis collez-le dans le clavier de l’application Téléphone.",

    /* ── Location button ───────────────────────────────────────────── */
    "sui.loc.add": "Ajouter ma position au repère",
    "sui.loc.busy": "Localisation…",
    "sui.loc.tooLong": "Raccourcissez le repère avant d'ajouter votre position.",
    "sui.loc.added": "Position ajoutée (précision : {meters} m). Vérifiez aussi votre adresse.",
    "sui.loc.failed": "Position indisponible. Vérifiez les autorisations ou saisissez votre repère.",
    "sui.loc.denied":
      "La localisation est refusée pour ce site. Autorisez-la dans les réglages du navigateur, ou saisissez votre repère.",

    /* ── Reorder button ────────────────────────────────────────────── */
    "sui.reorder.button": "Commander à nouveau",
    "sui.reorder.working": "Préparation du panier…",
    "sui.reorder.replaceTitle": "Remplacer votre panier ?",
    "sui.reorder.replaceBody":
      "Votre panier contient déjà des plats d’un autre restaurant. Les remplacer par cette commande ?",
    "sui.reorder.replaceConfirm": "Remplacer",
    "sui.reorder.cancel": "Annuler",
    "sui.reorder.done": "Panier prêt avec les plats de cette commande.",
    "sui.reorder.skipped": "Plus disponible(s), non ajouté(s) : {dishes}.",
    "sui.reorder.nothing": "Aucun plat de cette commande n’est disponible aujourd’hui.",
    "sui.reorder.unavailable": "Ce restaurant ne prend pas de commandes pour le moment.",
    "sui.reorder.failed": "Impossible de préparer le panier. Réessayez.",
  },
  en: {
    "sui.error.title": "Something went wrong",
    "sui.error.body":
      "Something went wrong on our side. Try again — if it keeps happening, write to us and quote the reference below.",
    "sui.error.retry": "Try again",
    "sui.error.home": "Back to home",

    "sui.pay.orangeTitle": "Orange action required",
    "sui.pay.copy": "Copy code",
    "sui.pay.copied": "Code copied",
    "sui.pay.openPhone": "Open Phone",
    "sui.pay.step1": "Copy the code",
    "sui.pay.step2": "Open the Phone app",
    "sui.pay.step3": "Dial the code and confirm",
    "sui.pay.step4": "Return to Resto237",
    "sui.pay.iosHint":
      "On iPhone the code cannot be dialled from a link: copy it, then paste it into the Phone app's keypad.",

    "sui.loc.add": "Add my location to landmark",
    "sui.loc.busy": "Locating…",
    "sui.loc.tooLong": "Shorten the landmark before adding your location.",
    "sui.loc.added": "Location added (accuracy: {meters} m). Check your street address too.",
    "sui.loc.failed": "Location unavailable. Check permissions or enter your landmark manually.",
    "sui.loc.denied":
      "Location is blocked for this site. Allow it in your browser settings, or enter your landmark manually.",

    "sui.reorder.button": "Order again",
    "sui.reorder.working": "Preparing your basket…",
    "sui.reorder.replaceTitle": "Replace your basket?",
    "sui.reorder.replaceBody":
      "Your basket already holds dishes from another restaurant. Replace them with this order?",
    "sui.reorder.replaceConfirm": "Replace",
    "sui.reorder.cancel": "Cancel",
    "sui.reorder.done": "Basket ready with the dishes from this order.",
    "sui.reorder.skipped": "No longer available, not added: {dishes}.",
    "sui.reorder.nothing": "None of the dishes from this order are available today.",
    "sui.reorder.unavailable": "This restaurant is not taking orders right now.",
    "sui.reorder.failed": "The basket could not be prepared. Try again.",
  },
});
