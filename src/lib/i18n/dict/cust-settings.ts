import { defineDict } from "../define";

/**
 * Customer settings (/settings).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `cst.` so two modules can never collide.
 */
export const custSettingsDict = defineDict({
  fr: {
    "cst.title": "Paramètres",
    "cst.subtitle": "Langue, thème et notifications.",

    /* -- Notifications push (cet appareil) ------------------------------ */
    "cst.push.title": "Notifications sur cet appareil",
    "cst.push.body":
      "Recevez les alertes de commande même lorsque la fenêtre est fermée.",
    "cst.push.enable": "Activer",
    "cst.push.disable": "Désactiver",
    "cst.push.enabled": "Activées sur cet appareil",
    "cst.push.unsupported": "Non pris en charge par ce navigateur.",
    "cst.push.denied":
      "Bloquées par le navigateur. Autorisez-les dans les réglages du site.",
    "cst.push.failed": "Impossible d'activer les notifications sur cet appareil.",

    "cst.appearance": "Apparence",
    "cst.theme": "Thème",
    "cst.themeBody": "Clair, sombre, ou suivre les réglages de votre appareil.",

    "cst.topics": "Ce que vous voulez recevoir",
    "cst.topicsBody":
      "Choisissez, pour chaque sujet, par quel canal vous voulez être prévenu. Les interrupteurs ci-dessus coupent un canal entièrement : ce qui est coupé là-haut ne passe pas, même coché ici.",
    "cst.evt.order_status": "Statut de mes commandes",
    "cst.evtBody.order_status": "Confirmation, préparation, livraison.",
    "cst.evt.reservations": "Réservations",
    "cst.evtBody.reservations": "Confirmation ou refus de vos demandes de table.",
    "cst.evt.messages": "Messages",
    "cst.evtBody.messages": "Quand un restaurant ou le support vous répond.",
    "cst.evt.reviews": "Réponses à mes avis",
    "cst.evtBody.reviews": "Quand un restaurant répond à un avis que vous avez laissé.",
    "cst.evt.loyalty": "Points de fidélité",
    "cst.evtBody.loyalty": "Quand vous gagnez ou utilisez des points.",
    "cst.evt.promotions": "Offres et promotions",
    "cst.evtBody.promotions": "Codes promo et nouveautés des restaurants que vous suivez.",
    "cst.ch.inApp": "Dans l'app",
    "cst.ch.email": "E-mail",
    "cst.ch.push": "Push",
    "cst.locked": "Non désactivable.",
    "cst.lockedInApp":
      "Le suivi dans l'app ne peut pas être coupé — c'est votre seule trace de la commande. L'e-mail et le push, si.",
    "cst.saved": "Préférences enregistrées.",
    "cst.saveFailed": "Les préférences n'ont pas pu être enregistrées. Réessayez.",

    "cst.delete": "Supprimer mon compte",
    "cst.deleteBody": "Action définitive.",
    "cst.deleteWhat": "Ce qui se passe exactement",
    "cst.deletePoint1": "Les champs nom, email et téléphone de votre profil sont anonymisés.",
    "cst.deletePoint2": "Vous ne pouvez plus vous connecter et vos points sont perdus.",
    "cst.deletePoint3":
      "Vos commandes, réservations et paiements passés restent conservés. Ces dossiers peuvent encore contenir les coordonnées saisies lors de la transaction.",
    "cst.deleteTitle": "Supprimer définitivement votre compte",
    "cst.deleteMessage":
      "Les coordonnées de votre profil seront anonymisées et vous ne pourrez plus vous connecter. Vos anciens dossiers de commande, réservation et paiement peuvent encore contenir les coordonnées fournies à ce moment-là.",
    "cst.deletePhrase": "SUPPRIMER",
    "cst.deleteHint": "Cette action ne peut pas être annulée.",
    "cst.deleted": "Votre compte a été supprimé. Au revoir.",
  },
  en: {
    "cst.title": "Settings",
    "cst.subtitle": "Language, theme and notifications.",

    /* -- Push notifications (this device) ------------------------------ */
    "cst.push.title": "Notifications on this device",
    "cst.push.body": "Get order alerts even when the tab is closed.",
    "cst.push.enable": "Enable",
    "cst.push.disable": "Disable",
    "cst.push.enabled": "Enabled on this device",
    "cst.push.unsupported": "Not supported by this browser.",
    "cst.push.denied": "Blocked by the browser. Allow them in the site settings.",
    "cst.push.failed": "Could not enable notifications on this device.",

    "cst.appearance": "Appearance",
    "cst.theme": "Theme",
    "cst.themeBody": "Light, dark, or follow your device settings.",

    "cst.topics": "What you want to receive",
    "cst.topicsBody":
      "Pick how you want to hear about each subject. The switches above turn a channel off entirely: anything closed up there does not arrive, even if it is ticked here.",
    "cst.evt.order_status": "My order status",
    "cst.evtBody.order_status": "Confirmation, preparation, delivery.",
    "cst.evt.reservations": "Bookings",
    "cst.evtBody.reservations": "Confirmation or refusal of your table requests.",
    "cst.evt.messages": "Messages",
    "cst.evtBody.messages": "When a restaurant or support replies to you.",
    "cst.evt.reviews": "Replies to my reviews",
    "cst.evtBody.reviews": "When a restaurant replies to a review you left.",
    "cst.evt.loyalty": "Loyalty points",
    "cst.evtBody.loyalty": "When you earn or spend points.",
    "cst.evt.promotions": "Offers and promotions",
    "cst.evtBody.promotions": "Promo codes and news from the restaurants you follow.",
    "cst.ch.inApp": "In the app",
    "cst.ch.email": "Email",
    "cst.ch.push": "Push",
    "cst.locked": "Cannot be turned off.",
    "cst.lockedInApp":
      "In-app tracking cannot be turned off — it is your only record of the order. Email and push can.",
    "cst.saved": "Preferences saved.",
    "cst.saveFailed": "Your preferences could not be saved. Try again.",

    "cst.delete": "Delete my account",
    "cst.deleteBody": "Permanent.",
    "cst.deleteWhat": "Exactly what happens",
    "cst.deletePoint1": "The name, email and phone fields in your profile are anonymised.",
    "cst.deletePoint2": "You can no longer sign in, and your points are lost.",
    "cst.deletePoint3":
      "Your past orders, reservations and payments remain on record. These records may still contain contact details entered for the transaction.",
    "cst.deleteTitle": "Permanently delete your account",
    "cst.deleteMessage":
      "Your profile contact details will be anonymised and you will no longer be able to sign in. Past order, reservation and payment records may still contain the contact details provided at the time.",
    "cst.deletePhrase": "DELETE",
    "cst.deleteHint": "This action cannot be undone.",
    "cst.deleted": "Your account has been deleted. Goodbye.",
  },
});
