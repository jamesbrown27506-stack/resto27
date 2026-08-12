/**
 * Dietary tag and allergen helpers.
 *
 * `dietaryTags` and `allergens` are comma-separated strings, DENORMALISED on
 * purpose — they are display filters and are never joined on (§3). The label
 * maps and the splitter live on this shared module (no server-only import) so
 * both server-rendered menus and client components can use them.
 */

export const DIETARY_TAG_LABEL: Record<string, string> = {
  "végétarien": "Végétarien",
  vegan: "Vegan",
  "sans-gluten": "Sans gluten",
};

export const ALLERGEN_LABEL: Record<string, string> = {
  arachide: "Arachide",
  "crustacés": "Crustacés",
  poisson: "Poisson",
  gluten: "Gluten",
  lait: "Lait",
  oeuf: "Œuf",
};

/** Split a denormalised tag string. Empty string → empty array, not [""]. */
export function splitTags(value: string): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}