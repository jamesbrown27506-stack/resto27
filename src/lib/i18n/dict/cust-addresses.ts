import { defineDict } from "../define";

/**
 * Delivery addresses (/addresses).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `cad.` so two modules can never collide.
 */
export const custAddressesDict = defineDict({
  fr: {
    "cad.title": "Adresses",
    "cad.subtitle": "Où vous faire livrer.",
  },
  en: {
    "cad.title": "Addresses",
    "cad.subtitle": "Where to deliver to you.",
  },
});
