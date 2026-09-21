import { defineDict } from "../define";

/**
 * Restaurant settings and notification preferences (/m/settings).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `mset.` so two modules can never collide.
 *
 * The `mset.evt.*` / `mset.evtBody.*` pairs are the labels for the event
 * catalogue in lib/data/settings.ts. They live here and not there because that
 * module is imported by a Server Component, which cannot translate anything.
 */
export const settingsDict = defineDict({
  fr: {
    "mset.title": "Paramètres",
    "mset.subtitle": "Service, notifications et apparence.",

    /* -- Pause du service --------------------------------------------- */
    "mset.service.title": "Service",
    "mset.service.description":
      "Arrêter les commandes quand la cuisine ne suit plus, sans disparaître de la plateforme.",
    "mset.service.accepting": "Commandes ouvertes",
    "mset.service.paused": "Commandes en pause",
    "mset.service.acceptingBody":
      "Vos clients peuvent commander en ligne dès maintenant.",
    "mset.service.pausedBody":
      "Vos clients voient toujours votre page et votre carte, mais ne peuvent pas commander.",
    "mset.service.reasonShown": "Message affiché : « {reason} »",
    "mset.service.pause": "Mettre en pause",
    "mset.service.resume": "Reprendre le service",
    "mset.service.pauseTitle": "Mettre le service en pause",
    "mset.service.pauseBody":
      "Rien n'est supprimé et votre page reste en ligne. Vous reprenez quand vous voulez, depuis cet écran.",
    "mset.service.reason": "Motif",
    "mset.service.reasonHint":
      "Facultatif, mais vos clients le lisent. « Fermé pour un événement privé » vaut mieux qu'un bouton grisé sans explication.",
    "mset.service.reasonPlaceholder": "Cuisine complète jusqu'à 21 h…",
    "mset.service.pausedDone": "Service en pause. Les clients ne peuvent plus commander.",
    "mset.service.resumedDone": "Service repris. Les commandes sont de nouveau ouvertes.",
    "mset.service.failed": "Impossible de changer l'état du service. Réessayez.",
    "mset.service.note":
      "Différent d'une suspension : celle-ci vient de la plateforme, la pause vient de vous.",

    /* -- Apparence ----------------------------------------------------- */
    "mset.appearance.title": "Apparence",
    "mset.appearance.theme": "Thème",
    "mset.appearance.themeBody":
      "Clair ou sombre, enregistré sur cet appareil. L'écran de cuisine suit le thème choisi ici.",

    /* -- Notifications -------------------------------------------------- */
    "mset.notif.title": "Notifications",
    "mset.notif.description":
      "Vos réglages à vous, pour cette succursale. Vos collègues gardent les leurs.",
    "mset.notif.event": "Événement",
    "mset.notif.inApp": "Dans l'app",
    "mset.notif.email": "Email",
    "mset.notif.push": "Push",
    "mset.notif.locked": "Toujours actif",
    "mset.notif.lockedBody":
      "Les alertes de commande et de facturation ne peuvent pas être désactivées.",
    "mset.notif.channel": "{event} — {channel}",
    "mset.notif.saved": "Préférences enregistrées.",
    "mset.notif.nothingToSave": "Aucune modification à enregistrer.",
    "mset.notif.failed": "Impossible d'enregistrer vos préférences. Réessayez.",

    /* -- Notifications push (cet appareil) ------------------------------ */
    "mset.push.title": "Notifications sur cet appareil",
    "mset.push.body":
      "Recevez les alertes de commande même lorsque la fenêtre est fermée.",
    "mset.push.enable": "Activer",
    "mset.push.disable": "Désactiver",
    "mset.push.enabled": "Activées sur cet appareil",
    "mset.push.unsupported": "Non pris en charge par ce navigateur.",
    "mset.push.denied":
      "Bloquées par le navigateur. Autorisez-les dans les réglages du site.",
    "mset.push.failed": "Impossible d'activer les notifications sur cet appareil.",

    "mset.evt.table_service": "Service à table",
    "mset.evtBody.table_service": "Demandes d’accès, commandes et appels envoyés depuis les QR codes des tables.",
    "mset.evt.new_order": "Nouvelle commande",
    "mset.evtBody.new_order": "Dès qu'une commande arrive.",
    "mset.evt.order_updates": "Suivi de commande",
    "mset.evtBody.order_updates": "Réponses du client : frais acceptés ou refusés, réception confirmée, retards.",
    "mset.evt.order_cancelled": "Commande annulée",
    "mset.evtBody.order_cancelled": "Quand un client annule avant préparation.",
    "mset.evt.reservation": "Demande de réservation",
    "mset.evtBody.reservation": "Nouvelle demande de table à traiter.",
    "mset.evt.messages": "Messages clients",
    "mset.evtBody.messages": "Quand un client vous écrit dans la messagerie.",
    "mset.evt.review": "Nouvel avis",
    "mset.evtBody.review": "Quand un client laisse un avis sur votre établissement.",
    "mset.evt.low_stock": "Stock bas",
    "mset.evtBody.low_stock": "Quand un plat suivi passe sous son seuil.",
    "mset.evt.billing": "Facturation",
    "mset.evtBody.billing": "Échéance d'abonnement, paiement confirmé, période de grâce.",
  },
  en: {
    "mset.title": "Settings",
    "mset.subtitle": "Service, notifications and appearance.",

    /* -- Service pause -------------------------------------------------- */
    "mset.service.title": "Service",
    "mset.service.description":
      "Stop taking orders when the kitchen cannot keep up, without disappearing from the platform.",
    "mset.service.accepting": "Orders open",
    "mset.service.paused": "Orders paused",
    "mset.service.acceptingBody": "Your customers can order online right now.",
    "mset.service.pausedBody":
      "Customers still see your page and your menu, but cannot place an order.",
    "mset.service.reasonShown": "Message shown: “{reason}”",
    "mset.service.pause": "Pause orders",
    "mset.service.resume": "Resume service",
    "mset.service.pauseTitle": "Pause the service",
    "mset.service.pauseBody":
      "Nothing is deleted and your page stays online. You resume whenever you like, from this screen.",
    "mset.service.reason": "Reason",
    "mset.service.reasonHint":
      "Optional, but your customers read it. “Closed for a private event” beats a greyed-out button with no explanation.",
    "mset.service.reasonPlaceholder": "Kitchen fully booked until 9pm…",
    "mset.service.pausedDone": "Service paused. Customers can no longer order.",
    "mset.service.resumedDone": "Service resumed. Orders are open again.",
    "mset.service.failed": "Could not change the service state. Try again.",
    "mset.service.note":
      "Different from a suspension: that one comes from the platform, this one comes from you.",

    /* -- Appearance ----------------------------------------------------- */
    "mset.appearance.title": "Appearance",
    "mset.appearance.theme": "Theme",
    "mset.appearance.themeBody":
      "Light or dark, saved on this device. The kitchen display follows the theme you choose here.",

    /* -- Notifications -------------------------------------------------- */
    "mset.notif.title": "Notifications",
    "mset.notif.description":
      "Your own settings, for this location. Your colleagues keep theirs.",
    "mset.notif.event": "Event",
    "mset.notif.inApp": "In-app",
    "mset.notif.email": "Email",
    "mset.notif.push": "Push",
    "mset.notif.locked": "Always on",
    "mset.notif.lockedBody": "Order and billing alerts cannot be switched off.",
    "mset.notif.channel": "{event} — {channel}",
    "mset.notif.saved": "Preferences saved.",
    "mset.notif.nothingToSave": "Nothing changed to save.",
    "mset.notif.failed": "Could not save your preferences. Try again.",

    /* -- Push notifications (this device) ------------------------------ */
    "mset.push.title": "Notifications on this device",
    "mset.push.body": "Get order alerts even when the tab is closed.",
    "mset.push.enable": "Enable",
    "mset.push.disable": "Disable",
    "mset.push.enabled": "Enabled on this device",
    "mset.push.unsupported": "Not supported by this browser.",
    "mset.push.denied": "Blocked by the browser. Allow them in the site settings.",
    "mset.push.failed": "Could not enable notifications on this device.",

    "mset.evt.table_service": "Table service",
    "mset.evtBody.table_service": "Access requests, food orders and calls sent from table QR codes.",
    "mset.evt.new_order": "New order",
    "mset.evtBody.new_order": "The moment an order comes in.",
    "mset.evt.order_updates": "Order updates",
    "mset.evtBody.order_updates": "Customer responses: fee accepted or declined, delivery confirmed, delays.",
    "mset.evt.order_cancelled": "Order cancelled",
    "mset.evtBody.order_cancelled": "When a customer cancels before preparation.",
    "mset.evt.reservation": "Booking request",
    "mset.evtBody.reservation": "A new table request to deal with.",
    "mset.evt.messages": "Customer messages",
    "mset.evtBody.messages": "When a customer writes to you in the chat.",
    "mset.evt.review": "New review",
    "mset.evtBody.review": "When a customer reviews your restaurant.",
    "mset.evt.low_stock": "Low stock",
    "mset.evtBody.low_stock": "When a tracked dish drops below its threshold.",
    "mset.evt.billing": "Billing",
    "mset.evtBody.billing": "Subscription due, payment confirmed, grace period.",
  },
});
