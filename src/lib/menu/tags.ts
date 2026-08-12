/**
 * Dietary tags and allergens.
 *
 * Stored on `menu_items` as comma-separated text, DENORMALISED ON PURPOSE
 * (§3): they are display filters and are never joined on. A junction table for
 * "contient de l'arachide" buys nothing and costs a query on every menu load.
 *
 * These are labels, not data — they belong in code rather than in the
 * database, which is why they survived the fixture purge.
 */

export const DIETARY_TAGS = ["végétarien", "vegan", "sans-gluten"] as const;

export const DIETARY_TAG_LABEL: Record<string, string> = {
  "végétarien": "Végétarien",
  vegan: "Vegan",
  "sans-gluten": "Sans gluten",
};

export const ALLERGENS = ["arachide", "crustacés", "poisson", "gluten", "lait", "oeuf"] as const;

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
  return value ? value.split(",").map((t) => t.trim()).filter(Boolean) : [];
}

/** Join back, normalised: trimmed, de-duplicated, no empty entries. */
export function joinTags(values: string[]): string {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].join(",");
}
