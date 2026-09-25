import { DICTIONARIES, type TranslationKey } from "./dictionaries";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/**
 * Is this string a dictionary key?
 *
 * Checked against the French dictionary because French is the source language:
 * every key exists there first, and `defineDict` makes English follow.
 */
export function isTranslationKey(value: string): value is TranslationKey {
  return Object.prototype.hasOwnProperty.call(DICTIONARIES.fr, value);
}

/**
 * The message a zod issue carries, in the viewer's language.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THE SCHEMAS HOLD KEYS, NOT SENTENCES.
 *
 *  The server-side schemas (auth/schemas.ts, the address and profile schemas)
 *  used to carry French sentences as their messages, and the actions returned
 *  `issue.message` straight into the form — so an English reader got
 *  "Adresse email invalide" under an English label. A schema is built once at
 *  module load and cannot know who is reading, so the schemas now carry the
 *  dictionary KEY and the action translates it here, where `t` exists.
 *
 *  Anything that is not a key — zod's own default messages for the limits
 *  that were never given a custom message — passes through untouched, exactly
 *  as it did before.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function translateIssueMessage(message: string, t: Translate): string {
  return isTranslationKey(message) ? t(message) : message;
}

/**
 * The first issue of a failed parse, translated — what the single-message
 * actions return as `error`. "Check the form" when there is no issue at all.
 */
export function firstIssueMessage(
  error: { issues: readonly { message: string }[] },
  t: Translate,
  fallback: TranslationKey = "ecu.checkForm",
): string {
  const message = error.issues[0]?.message;
  return message ? translateIssueMessage(message, t) : t(fallback);
}
