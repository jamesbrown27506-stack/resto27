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
      "Les événements qui déclenchent une notification, quel que soit le canal choisi ci-dessus.",
    "cst.evt.orderStatus": "Statut de mes commandes",
    "cst.evtBody.orderStatus": "Confirmation, préparation, livraison.",
    "cst.evt.reservations": "Réservations",
    "cst.evtBody.reservations": "Confirmation ou refus de vos demandes de table.",
    "cst.evt.loyalty": "Points de fidélité",
    "cst.evtBody.loyalty": "Quand vous gagnez ou utilisez des points.",
    "cst.evt.promotions": "Offres et promotions",
    "cst.evtBody.promotions": "Codes promo et nouveautés des restaurants que vous suivez.",
    "cst.locked": "Non désactivable.",
    "cst.saved": "Préférences enregistrées.",

    "cst.delete": "Supprimer mon compte",
    "cst.deleteBody": "Action définitive.",
    "cst.deleteWhat": "Ce qui se passe exactement",
    "cst.deletePoint1": "Votre nom, votre email et votre téléphone sont définitivement anonymisés.",
    "cst.deletePoint2": "Vous ne pouvez plus vous connecter et vos points sont perdus.",
    "cst.deletePoint3":
      "Vos commandes passées sont conservées sous forme anonyme : elles font partie de la comptabilité des restaurants et ne peuvent pas être effacées.",
    "cst.deleteTitle": "Supprimer définitivement votre compte",
    "cst.deleteMessage":
      "Vos données personnelles seront anonymisées et vous ne pourrez plus vous connecter. Vos commandes passées restent dans la comptabilité des restaurants, sans lien avec votre identité.",
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
      "The events that trigger a notification, whichever channel you picked above.",
    "cst.evt.orderStatus": "My order status",
    "cst.evtBody.orderStatus": "Confirmation, preparation, delivery.",
    "cst.evt.reservations": "Bookings",
    "cst.evtBody.reservations": "Confirmation or refusal of your table requests.",
    "cst.evt.loyalty": "Loyalty points",
    "cst.evtBody.loyalty": "When you earn or spend points.",
    "cst.evt.promotions": "Offers and promotions",
    "cst.evtBody.promotions": "Promo codes and news from the restaurants you follow.",
    "cst.locked": "Cannot be turned off.",
    "cst.saved": "Preferences saved.",

    "cst.delete": "Delete my account",
    "cst.deleteBody": "Permanent.",
    "cst.deleteWhat": "Exactly what happens",
    "cst.deletePoint1": "Your name, email and phone number are permanently anonymised.",
    "cst.deletePoint2": "You can no longer sign in, and your points are lost.",
    "cst.deletePoint3":
      "Your past orders are kept in anonymised form: they are part of the restaurants' accounts and cannot be erased.",
    "cst.deleteTitle": "Permanently delete your account",
    "cst.deleteMessage":
      "Your personal data will be anonymised and you will no longer be able to sign in. Your past orders stay in the restaurants' accounts, with no link to your identity.",
    "cst.deletePhrase": "DELETE",
    "cst.deleteHint": "This action cannot be undone.",
    "cst.deleted": "Your account has been deleted. Goodbye.",
  },
});
