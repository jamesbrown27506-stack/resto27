/**
 * One translation module.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THE DICTIONARY IS SPLIT.
 *
 *  It lived as a single 1 200-line file holding both languages. That made it
 *  the one file EVERY new page had to edit, which is a merge conflict waiting
 *  on every parallel branch, and it made "did I translate this page" a
 *  question you answered by scrolling.
 *
 *  A module is one screen's strings, both languages side by side, so a missing
 *  English line is visible on the same page of the same file as the French one
 *  it belongs to — and `defineDict` makes it a COMPILE ERROR rather than a
 *  French word appearing in an English UI.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The `const` type parameter is what keeps the keys as literals; without it
 * `T` widens to Record<string, string> and `TranslationKey` degrades to
 * `string`, taking every autocomplete and typo check with it.
 */
export function defineDict<const T extends Record<string, string>>(dict: {
  fr: T;
  /** Typed against `fr`: every French key must have an English one. */
  en: Record<keyof T, string>;
}): { fr: T; en: Record<keyof T, string> } {
  return dict;
}
