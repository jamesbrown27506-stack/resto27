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
  },
});
