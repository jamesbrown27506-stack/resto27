import { defineDict } from "../define";

/**
 * The dish list and its editor (/m/menu).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `mm.` so two modules can never collide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE DIET AND ALLERGEN LABELS LIVE HERE, NOT IN lib/menu/tags.ts.
 *
 *  That module owns the TAG IDS — the values actually stored in
 *  `menu_items.dietary_tags` and `menu_items.allergens` — and it is imported
 *  by Server Components, so it cannot call useLocale and its label maps are
 *  French-only. Translating them here keeps the stored value ("sans-gluten")
 *  and the rendered word ("Gluten free") separate, which is what lets the
 *  interface change language without rewriting a single database row.
 *
 *  One `mm.diet.<id>` per entry of DIETARY_TAGS and one `mm.allergen.<id>`
 *  per entry of ALLERGENS. A new tag there without a label here renders its
 *  raw id, which is how you notice.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Counted strings come in `_one` / `_other` pairs rather than "{count}
 * plat(s)": French counts 0 as singular where English does not, so the caller
 * picks the variant and each language keeps its own rule.
 */
export const menuDict = defineDict({
  fr: {
    "mm.title": "Menu",
    "mm.subtitle": "Vos plats, leur disponibilité, leur stock et leurs options.",

    /* ── Limite de formule (§5) ───────────────────────────────────────── */
    "mm.limit.reached": "Limite atteinte : {used} / {limit} plats.",
    "mm.limit.body":
      "Vos plats existants restent actifs. Passez à une formule supérieure pour en ajouter.",
    "mm.limit.changePlan": "Changer de formule",
    "mm.limit.hint": "Limite de la formule atteinte",

    /* ── Filtres et barre d'outils ────────────────────────────────────── */
    "mm.search": "Nom ou description…",
    "mm.filter.category": "Catégorie",
    "mm.filter.allCategories": "Toutes catégories",
    "mm.filter.availability": "Disponibilité",
    "mm.filter.all": "Tous",
    "mm.filter.available": "Disponibles",
    "mm.filter.unavailable": "Indisponibles",
    "mm.new": "Nouveau plat",
    "mm.needCategory": "Créez d'abord une catégorie",

    /* ── Amorce « créez une catégorie » ───────────────────────────────── */
    "mm.noCategoryYet": "Votre carte n'a pas encore de catégorie. Créez-en une pour ranger vos plats.",
    "mm.createCategory": "Créer une catégorie",

    /* ── Liste ────────────────────────────────────────────────────────── */
    "mm.count_one": "{count} plat",
    "mm.count_other": "{count} plats",
    "mm.usage": "{used} / {limit} utilisés",
    "mm.readOnly": "Vous pouvez consulter la carte, mais pas la modifier.",
    "mm.empty": "Votre carte est vide",
    "mm.emptyBody": "Ajoutez votre premier plat — c'est ce que vos clients verront.",
    "mm.none": "Aucun plat",
    "mm.noneBody": "Ajustez vos filtres pour voir d'autres plats.",

    /* ── Badges de ligne ──────────────────────────────────────────────── */
    "mm.badge.soldOut": "Épuisé",
    "mm.badge.stock": "Stock {count}",
    "mm.badge.options_one": "{count} groupe d'options",
    "mm.badge.options_other": "{count} groupes d'options",
    "mm.badge.uncategorised": "Sans catégorie",
    "mm.badge.unavailable": "Indisponible",
    "mm.badge.featured": "Mis en avant",

    /* ── Actions de ligne ─────────────────────────────────────────────── */
    "mm.available": "Disponible",
    "mm.availabilityOf": "Disponibilité de {name}",
    "mm.options": "Options",
    "mm.optionsOf": "Options de {name}",
    "mm.editDish": "Modifier {name}",
    "mm.deleteDish": "Supprimer {name}",

    /* ── Éditeur ──────────────────────────────────────────────────────── */
    "mm.newTitle": "Nouveau plat",
    "mm.editTitle": "Modifier le plat",
    "mm.name": "Nom du plat",
    "mm.namePh": "Poulet DG",
    "mm.description": "Description",
    "mm.descriptionPh": "Poulet sauté aux plantains mûrs, carottes et poivrons.",
    "mm.price": "Prix (FCFA)",
    "mm.priceHint": "En francs entiers — le FCFA n'a pas de centimes.",
    "mm.prep": "Préparation (min)",
    "mm.category": "Catégorie",
    "mm.uncategorisedHint":
      "Sans catégorie, ce plat apparaît dans « Autres plats » sur votre carte publique. Choisissez une catégorie pour le ranger.",
    "mm.availableToOrder": "Disponible à la commande",
    "mm.featured": "Mettre en avant",
    "mm.trackStock": "Suivre le stock",
    "mm.stock": "Quantité en stock",
    "mm.threshold": "Seuil d'alerte",
    "mm.thresholdHint": "Vous prévient avant la rupture.",
    "mm.diets": "Régimes",
    "mm.allergens": "Allergènes",

    /* ── Photo du plat ────────────────────────────────────────────────── */
    "mm.photo": "Photo du plat",
    "mm.photoHint":
      "PNG, JPEG, GIF ou WebP, 2 Mo maximum. Envoyée sur votre serveur au moment de l'enregistrement.",
    "mm.photoErr.empty": "Aucun fichier reçu.",
    "mm.photoErr.tooLarge": "Cette photo dépasse 2 Mo.",
    "mm.photoErr.rejected":
      "Photo refusée. Vérifiez qu'il s'agit bien d'une image PNG, JPEG, GIF ou WebP — c'est le contenu du fichier qui est vérifié, pas son nom.",

    /* ── Retours ──────────────────────────────────────────────────────── */
    "mm.added": "Plat ajouté.",
    "mm.saved": "Plat enregistré.",
    "mm.deleted": "Plat supprimé.",
    "mm.markedSoldOut": "{name} marqué épuisé.",
    "mm.markedAvailable": "{name} de nouveau disponible.",

    /* ── Suppression ──────────────────────────────────────────────────── */
    "mm.deleteTitle": "Supprimer {name} ?",
    "mm.deleteBody":
      "Les commandes déjà passées gardent le nom et le prix d'origine. Cette action est définitive.",

    /* ── Régimes (ids : DIETARY_TAGS de lib/menu/tags.ts) ─────────────── */
    "mm.diet.végétarien": "Végétarien",
    "mm.diet.vegan": "Vegan",
    "mm.diet.sans-gluten": "Sans gluten",

    /* ── Allergènes (ids : ALLERGENS de lib/menu/tags.ts) ─────────────── */
    "mm.allergen.arachide": "Arachide",
    "mm.allergen.crustacés": "Crustacés",
    "mm.allergen.poisson": "Poisson",
    "mm.allergen.gluten": "Gluten",
    "mm.allergen.lait": "Lait",
    "mm.allergen.oeuf": "Œuf",
  },
  en: {
    "mm.title": "Menu",
    "mm.subtitle": "Your dishes, their availability, their stock and their options.",

    /* ── Plan limit (§5) ──────────────────────────────────────────────── */
    "mm.limit.reached": "Limit reached: {used} / {limit} dishes.",
    "mm.limit.body": "Your existing dishes keep working. Move up a plan to add more.",
    "mm.limit.changePlan": "Change plan",
    "mm.limit.hint": "Plan limit reached",

    /* ── Filters and toolbar ──────────────────────────────────────────── */
    "mm.search": "Name or description…",
    "mm.filter.category": "Category",
    "mm.filter.allCategories": "All categories",
    "mm.filter.availability": "Availability",
    "mm.filter.all": "All",
    "mm.filter.available": "Available",
    "mm.filter.unavailable": "Unavailable",
    "mm.new": "New dish",
    "mm.needCategory": "Create a category first",

    /* ── "Create a category" nudge ────────────────────────────────────── */
    "mm.noCategoryYet": "Your menu has no category yet. Create one to file your dishes under.",
    "mm.createCategory": "Create a category",

    /* ── List ─────────────────────────────────────────────────────────── */
    "mm.count_one": "{count} dish",
    "mm.count_other": "{count} dishes",
    "mm.usage": "{used} / {limit} used",
    "mm.readOnly": "You can view the menu, but not change it.",
    "mm.empty": "Your menu is empty",
    "mm.emptyBody": "Add your first dish — it is what your customers will see.",
    "mm.none": "No dishes",
    "mm.noneBody": "Adjust your filters to see other dishes.",

    /* ── Row badges ───────────────────────────────────────────────────── */
    "mm.badge.soldOut": "Sold out",
    "mm.badge.stock": "Stock {count}",
    "mm.badge.options_one": "{count} option group",
    "mm.badge.options_other": "{count} option groups",
    "mm.badge.uncategorised": "No category",
    "mm.badge.unavailable": "Unavailable",
    "mm.badge.featured": "Featured",

    /* ── Row actions ──────────────────────────────────────────────────── */
    "mm.available": "Available",
    "mm.availabilityOf": "Availability of {name}",
    "mm.options": "Options",
    "mm.optionsOf": "Options for {name}",
    "mm.editDish": "Edit {name}",
    "mm.deleteDish": "Delete {name}",

    /* ── Editor ───────────────────────────────────────────────────────── */
    "mm.newTitle": "New dish",
    "mm.editTitle": "Edit the dish",
    "mm.name": "Dish name",
    "mm.namePh": "Poulet DG",
    "mm.description": "Description",
    "mm.descriptionPh": "Chicken sautéed with ripe plantain, carrot and peppers.",
    "mm.price": "Price (FCFA)",
    "mm.priceHint": "Whole francs — the FCFA has no centimes.",
    "mm.prep": "Prep time (min)",
    "mm.category": "Category",
    "mm.uncategorisedHint":
      "Without a category, this dish appears under \"Other dishes\" on your public menu. Pick a category to file it.",
    "mm.availableToOrder": "Available to order",
    "mm.featured": "Feature on the menu",
    "mm.trackStock": "Track stock",
    "mm.stock": "Stock quantity",
    "mm.threshold": "Low-stock alert",
    "mm.thresholdHint": "Warns you before you run out.",
    "mm.diets": "Dietary",
    "mm.allergens": "Allergens",

    /* ── Dish photo ───────────────────────────────────────────────────── */
    "mm.photo": "Dish photo",
    "mm.photoHint":
      "PNG, JPEG, GIF or WebP, 2 MB maximum. Sent to your own server when you save.",
    "mm.photoErr.empty": "No file received.",
    "mm.photoErr.tooLarge": "That photo is over 2 MB.",
    "mm.photoErr.rejected":
      "Photo refused. Check it really is a PNG, JPEG, GIF or WebP image — the file's contents are checked, not its name.",

    /* ── Feedback ─────────────────────────────────────────────────────── */
    "mm.added": "Dish added.",
    "mm.saved": "Dish saved.",
    "mm.deleted": "Dish deleted.",
    "mm.markedSoldOut": "{name} marked sold out.",
    "mm.markedAvailable": "{name} is available again.",

    /* ── Deletion ─────────────────────────────────────────────────────── */
    "mm.deleteTitle": "Delete {name}?",
    "mm.deleteBody":
      "Orders already placed keep the original name and price. This cannot be undone.",

    /* ── Diets (ids: DIETARY_TAGS in lib/menu/tags.ts) ────────────────── */
    "mm.diet.végétarien": "Vegetarian",
    "mm.diet.vegan": "Vegan",
    "mm.diet.sans-gluten": "Gluten free",

    /* ── Allergens (ids: ALLERGENS in lib/menu/tags.ts) ───────────────── */
    "mm.allergen.arachide": "Peanut",
    "mm.allergen.crustacés": "Shellfish",
    "mm.allergen.poisson": "Fish",
    "mm.allergen.gluten": "Gluten",
    "mm.allergen.lait": "Milk",
    "mm.allergen.oeuf": "Egg",
  },
});
