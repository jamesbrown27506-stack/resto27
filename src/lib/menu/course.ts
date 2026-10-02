import { normalizeText } from "@/lib/search/fuzzy";

/**
 * The platform's four kinds of dish — one vocabulary for every menu, so a
 * customer can browse "drinks" across Douala whatever each restaurant named
 * its own sections.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  light    petit-déjeuner, en-cas, entrées — BHB, beignets, omelette
 *  main     plats principaux — Ndolé, Poulet DG, Eru… (the default)
 *  dessert  après le repas — glaces, gâteaux, chocolat, pâtisserie
 *  drink    boissons — jus de bissap (Foléré), sodas, bières, café
 *
 *  A restaurant may set it per dish (menu_items.course, 0071). Until it does
 *  — and for every dish created before — it is INFERRED: a drink or dessert
 *  word in the dish's own name first (a "Jus de bissap" filed under "Plats"
 *  is still a drink), then the restaurant's section name, then light-meal
 *  words, and otherwise a main dish. Inference keeps the whole catalogue
 *  browsable on day one; the manager's choice always wins.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const DISH_COURSES = ["light", "main", "dessert", "drink"] as const;
export type DishCourse = (typeof DISH_COURSES)[number];

export function isDishCourse(value: unknown): value is DishCourse {
  return typeof value === "string" && (DISH_COURSES as readonly string[]).includes(value);
}

/** Whole words (or phrases), matched on normalised text. */
const DRINK = [
  "boisson", "boissons", "drink", "drinks", "jus", "juice", "bissap", "folere", "soda", "sodas",
  "coca", "fanta", "sprite", "biere", "bieres", "beer", "vin", "wine", "eau", "eau minerale",
  "cafe", "coffee", "tea", "infusion", "cocktail", "cocktails", "mocktail", "smoothie",
  "milkshake", "malta", "guinness", "castel", "citronnade", "limonade",
];
const DESSERT = [
  "dessert", "desserts", "glace", "glaces", "ice cream", "gateau", "gateaux", "cake", "cakes",
  "patisserie", "patisseries", "pastry", "chocolat", "chocolate", "crepe", "crepes", "tarte",
  "yaourt", "yogurt", "salade de fruits", "fruits", "donut", "donuts", "muffin", "cookie",
  "cookies", "biscuit", "flan", "mousse", "tiramisu", "douceur", "douceurs", "sucre",
];
const LIGHT = [
  "petit dejeuner", "petit dej", "breakfast", "entree", "entrees", "starter", "starters", "snack",
  "snacks", "encas", "en cas", "beignet", "beignets", "bhb", "omelette", "sandwich", "croissant",
  "pain", "bread", "bouillie", "salade", "brunch",
];
const MAIN = ["plat", "plats", "plats principaux", "plat principal", "main", "mains", "resistance"];

function hasWord(text: string, words: string[]): boolean {
  const padded = ` ${text} `;
  return words.some((word) => padded.includes(` ${word} `));
}

export function inferCourse(name: string, categoryName?: string | null): DishCourse {
  const dish = normalizeText(name);
  const section = normalizeText(categoryName ?? "");
  // "Eru & Water Fufu" is a meal: "water" is deliberately not a drink word.
  if (hasWord(dish, DRINK)) return "drink";
  if (hasWord(dish, DESSERT)) return "dessert";
  if (section) {
    if (hasWord(section, DRINK)) return "drink";
    if (hasWord(section, DESSERT)) return "dessert";
    if (hasWord(section, LIGHT)) return "light";
    if (hasWord(section, MAIN)) return "main";
  }
  if (hasWord(dish, LIGHT)) return "light";
  return "main";
}

/** The course a dish is shown under: the restaurant's choice, else the inference. */
export function effectiveCourse(dish: { course?: string | null; name: string; categoryName?: string | null }): DishCourse {
  return isDishCourse(dish.course) ? dish.course : inferCourse(dish.name, dish.categoryName);
}

/** The course of a dish served by several kitchens: what most of them call it. */
export function majorityCourse(courses: DishCourse[]): DishCourse {
  const counts = new Map<DishCourse, number>();
  for (const course of courses) counts.set(course, (counts.get(course) ?? 0) + 1);
  let best: DishCourse = "main";
  let bestCount = 0;
  for (const course of DISH_COURSES) {
    const count = counts.get(course) ?? 0;
    if (count > bestCount) {
      best = course;
      bestCount = count;
    }
  }
  return best;
}
