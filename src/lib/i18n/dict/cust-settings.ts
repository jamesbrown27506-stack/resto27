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
  },
  en: {
    "cst.title": "Settings",
    "cst.subtitle": "Language, theme and notifications.",
  },
});
