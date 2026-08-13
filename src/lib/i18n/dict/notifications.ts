import { defineDict } from "../define";

/**
 * The notification settings panel — ONE screen, three actors.
 *
 * The customer (/settings), the manager (/m/settings) and the admin
 * (/a/notifications) all render the same component, so all three read these
 * strings. Prefix every key with `nset.` so two modules can never collide.
 *
 * The push copy is deliberately specific about WHY it cannot be turned on.
 * "Could not enable notifications" is the message that sent someone hunting
 * through browser settings for a problem that was actually a missing server
 * key — each cause now says its own sentence.
 */
export const notificationsDict = defineDict({
  fr: {
    "nset.title": "Notifications",
    "nset.subtitle": "Choisissez comment nous vous joignons.",

    "nset.inApp.label": "Dans l'application",
    "nset.inApp.body":
      "La cloche, le badge et l'alerte en direct pendant que l'onglet est ouvert.",

    "nset.email.label": "Par email",
    "nset.email.body": "Un message à votre adresse pour les événements importants.",

    "nset.push.label": "Notifications push",
    "nset.push.body":
      "Des alertes de votre téléphone ou de votre ordinateur, même quand l'onglet est fermé.",

    "nset.push.device": "Cet appareil",
    "nset.push.deviceOn": "Activées sur cet appareil",
    "nset.push.deviceOff": "Pas encore activées sur cet appareil",
    "nset.push.deviceOther":
      "Activées sur vos autres appareils, mais pas sur celui-ci.",
    "nset.push.enable": "Activer sur cet appareil",
    "nset.push.disable": "Désactiver sur cet appareil",

    "nset.push.unsupported":
      "Ce navigateur ne prend pas en charge les notifications push.",
    "nset.push.insecure":
      "Les notifications push exigent une connexion sécurisée (https). Ouvrez le site en https et réessayez.",
    "nset.push.notConfigured":
      "Les notifications push ne sont pas encore configurées sur ce serveur. Prévenez l'administrateur.",
    "nset.push.denied":
      "Votre navigateur bloque les notifications pour ce site. Autorisez-les dans les réglages du site (cadenas dans la barre d'adresse), puis réessayez.",
    "nset.push.dismissed":
      "Vous n'avez pas autorisé les notifications. Réessayez et choisissez « Autoriser ».",
    "nset.push.failed": "Impossible d'activer les notifications sur cet appareil.",
    "nset.push.iosHint":
      "Sur iPhone et iPad, ajoutez d'abord le site à l'écran d'accueil : les notifications ne fonctionnent que depuis l'application installée.",
    "nset.push.grantHint":
      "Votre navigateur mémorise l'autorisation. S'il ne vous demande plus rien, c'est qu'elle est déjà accordée.",

    "nset.push.enabled":
      "Notifications push activées — un message de confirmation vient de vous être envoyé.",
    "nset.push.enabledNoSend":
      "Notifications push activées sur cet appareil.",
    "nset.push.disabled": "Notifications push désactivées sur cet appareil.",

    "nset.saved": "Préférences de notification enregistrées.",
    "nset.saveFailed": "Les préférences n'ont pas pu être enregistrées.",
    "nset.allOff":
      "Tous les canaux sont désactivés : vous ne recevrez plus aucune alerte, y compris pour vos commandes.",
    "nset.footnote":
      "Les messages essentiels liés à une commande en cours restent envoyés par les canaux encore actifs.",
  },
  en: {
    "nset.title": "Notifications",
    "nset.subtitle": "Choose how we reach you.",

    "nset.inApp.label": "In the app",
    "nset.inApp.body": "The bell, the badge and the live alert while the tab is open.",

    "nset.email.label": "By email",
    "nset.email.body": "A message to your address for the events that matter.",

    "nset.push.label": "Push notifications",
    "nset.push.body":
      "Alerts from your phone or computer, even when the tab is closed.",

    "nset.push.device": "This device",
    "nset.push.deviceOn": "Enabled on this device",
    "nset.push.deviceOff": "Not enabled on this device yet",
    "nset.push.deviceOther": "Enabled on your other devices, but not this one.",
    "nset.push.enable": "Enable on this device",
    "nset.push.disable": "Disable on this device",

    "nset.push.unsupported": "This browser does not support push notifications.",
    "nset.push.insecure":
      "Push notifications need a secure connection (https). Open the site over https and try again.",
    "nset.push.notConfigured":
      "Push notifications are not configured on this server yet. Let the administrator know.",
    "nset.push.denied":
      "Your browser is blocking notifications for this site. Allow them in the site settings (the padlock in the address bar), then try again.",
    "nset.push.dismissed":
      "You did not allow notifications. Try again and choose “Allow”.",
    "nset.push.failed": "Could not enable notifications on this device.",
    "nset.push.iosHint":
      "On iPhone and iPad, add the site to your home screen first — notifications only work from the installed app.",
    "nset.push.grantHint":
      "Your browser remembers the permission. If it stops asking, it has already been granted.",

    "nset.push.enabled":
      "Push notifications enabled — a confirmation has just been sent to you.",
    "nset.push.enabledNoSend": "Push notifications enabled on this device.",
    "nset.push.disabled": "Push notifications disabled on this device.",

    "nset.saved": "Notification preferences saved.",
    "nset.saveFailed": "Your preferences could not be saved.",
    "nset.allOff":
      "Every channel is off: you will no longer receive any alert, including about your own orders.",
    "nset.footnote":
      "Essential messages about an order in progress are still sent through whichever channels are left on.",
  },
});
