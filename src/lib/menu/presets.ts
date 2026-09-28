/**
 * Ready-made option lists for Cameroonian menus, and which dishes they suit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  SETTING UP OPTIONS DISH BY DISH IS WHY RESTAURANTS DO NOT.
 *
 *  Eru comes with water fufu, fufu de maïs or garri; ndolé with plantain,
 *  miondo or rice; nearly everything with or without piment. Twenty dishes
 *  × the same list typed twenty times is an afternoon nobody spends. So a
 *  list is prepared ONCE — from this library, or copied from a dish that
 *  already has it — and applied to every dish that needs it in one go
 *  (applyOptionTemplate). The names below are what the kitchen reads on the
 *  ticket, so they are the words a Douala menu uses.
 *
 *  Prices default to 0: most of these choices do not change the price. A
 *  restaurant types a price only where one does ("Grande portion +500").
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface OptionTemplate {
  /** The group's name, shown to customers and on the ticket. */
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  options: { name: string; priceDelta: number }[];
}

export interface OptionPreset {
  key: string;
  template: OptionTemplate;
  /** Words that suggest a dish needs this list (accent- and case-insensitive). */
  keywords: string[];
}

export const OPTION_PRESETS: OptionPreset[] = [
  {
    key: "sides",
    template: {
      name: "Accompagnement",
      minSelect: 1,
      maxSelect: 1,
      isRequired: true,
      options: [
        { name: "Water fufu", priceDelta: 0 },
        { name: "Fufu de maïs", priceDelta: 0 },
        { name: "Garri", priceDelta: 0 },
        { name: "Couscous manioc", priceDelta: 0 },
        { name: "Riz blanc", priceDelta: 0 },
        { name: "Plantain mûr", priceDelta: 0 },
        { name: "Plantain vert", priceDelta: 0 },
        { name: "Miondo", priceDelta: 0 },
        { name: "Bâton de manioc", priceDelta: 0 },
      ],
    },
    keywords: ["eru", "ndole", "okok", "koki", "achu", "mbongo", "nkui", "kwem", "sauce", "soupe", "pepper soup",
      "taro", "folong", "mbanga", "gombo", "legumes", "zom", "kondre", "bitter leaf", "njama"],
  },
  {
    key: "chili",
    template: {
      name: "Piment",
      minSelect: 0,
      maxSelect: 1,
      isRequired: false,
      options: [
        { name: "Sans piment", priceDelta: 0 },
        { name: "Piment doux", priceDelta: 0 },
        { name: "Piment fort", priceDelta: 0 },
      ],
    },
    keywords: ["poisson", "poulet", "porc", "boeuf", "soya", "brochette", "braise", "grille", "sauce", "soupe",
      "pepper", "eru", "ndole", "mbongo", "okok", "koki", "achu", "nkui", "dg", "kondre", "chicken", "fish"],
  },
  {
    key: "protein",
    template: {
      name: "Viande ou poisson",
      minSelect: 1,
      maxSelect: 1,
      isRequired: true,
      options: [
        { name: "Poulet", priceDelta: 0 },
        { name: "Bœuf", priceDelta: 0 },
        { name: "Poisson", priceDelta: 0 },
        { name: "Porc", priceDelta: 0 },
      ],
    },
    keywords: ["sauce", "soupe", "pepper soup", "ndole", "mbongo", "gombo", "okok", "kondre", "riz sauce"],
  },
  {
    key: "portion",
    template: {
      name: "Portion",
      minSelect: 1,
      maxSelect: 1,
      isRequired: true,
      options: [
        { name: "Normale", priceDelta: 0 },
        { name: "Grande", priceDelta: 500 },
      ],
    },
    keywords: [],
  },
  {
    key: "extras",
    template: {
      name: "Suppléments",
      minSelect: 0,
      maxSelect: 5,
      isRequired: false,
      options: [
        { name: "Viande en plus", priceDelta: 500 },
        { name: "Poisson en plus", priceDelta: 500 },
        { name: "Œuf", priceDelta: 200 },
        { name: "Avocat", priceDelta: 200 },
        { name: "Plantain en plus", priceDelta: 300 },
      ],
    },
    keywords: [],
  },
  {
    key: "cooking",
    template: {
      name: "Préparation",
      minSelect: 1,
      maxSelect: 1,
      isRequired: true,
      options: [
        { name: "Braisé", priceDelta: 0 },
        { name: "Frit", priceDelta: 0 },
      ],
    },
    keywords: ["poisson", "maquereau", "bar", "carpe", "tilapia", "machoiron", "fish"],
  },
];

/** Lower-case, accents removed — "Ndolé" matches "ndole". */
export function normaliseDishName(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The dishes a preset is likely meant for, by name. */
export function suggestDishes<T extends { id: string; name: string }>(preset: OptionPreset | null, dishes: T[]): string[] {
  if (!preset || preset.keywords.length === 0) return [];
  const words = preset.keywords.map(normaliseDishName);
  return dishes
    .filter((dish) => {
      const name = normaliseDishName(dish.name);
      return words.some((word) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(name));
    })
    .map((dish) => dish.id);
}

export const MAX_TEMPLATE_OPTIONS = 30;

/** Returns a problem code, or null when the list can be applied. */
export function templateProblem(template: OptionTemplate): "name" | "options" | "optionName" | "price" | "range" | null {
  if (template.name.trim().length < 2) return "name";
  if (template.options.length < 1 || template.options.length > MAX_TEMPLATE_OPTIONS) return "options";
  if (template.options.some((o) => o.name.trim().length < 1)) return "optionName";
  if (template.options.some((o) => !Number.isInteger(o.priceDelta))) return "price";
  if (template.maxSelect < 1 || template.maxSelect < template.minSelect) return "range";
  if (template.isRequired && template.minSelect < 1) return "range";
  return null;
}
