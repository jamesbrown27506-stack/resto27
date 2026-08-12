import { defineDict } from "../define";

/**
 * The customer's own profile (/profile).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `cpf.` so two modules can never collide.
 */
export const custProfileDict = defineDict({
  fr: {
    "cpf.title": "Profil",
    "cpf.subtitle": "Vos informations personnelles.",
  },
  en: {
    "cpf.title": "Profile",
    "cpf.subtitle": "Your personal details.",
  },
});
