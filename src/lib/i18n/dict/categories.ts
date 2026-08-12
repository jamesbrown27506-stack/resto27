import { defineDict } from "../define";

/**
 * Menu categories (/m/categories) and the icon picker.
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `mc.` so two modules can never collide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE `icons.` KEYS ARE ALSO OURS.
 *
 *  CATEGORY_ICON_GROUPS (components/layout/icon.tsx) deliberately carries no
 *  labels: it is imported by Server Components, which cannot call useLocale.
 *  So the group headings live here as `icons.group.<key>`, and every icon it
 *  offers gets a name as `icons.name.<IconName>` — that name IS the button's
 *  accessible label, and a screen-reader user choosing between sixty buttons
 *  called "UtensilsCrossed" and "HandPlatter" is choosing blind.
 *
 *  One entry per icon in CATEGORY_ICON_GROUPS. A new icon there without a
 *  name here shows the raw key, which is how you notice.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Counted strings come in `_one` / `_other` pairs rather than "{count}
 * plat(s)": the parenthesised plural is a shortcut that reads as a form
 * field, and French counts 0 as singular where English does not — the caller
 * picks the variant, so each language keeps its own rule.
 */
export const categoriesDict = defineDict({
  fr: {
    "mc.title": "Catégories",
    "mc.subtitle": "Organisez votre carte — les clients voient vos catégories dans cet ordre.",

    /* ── Liste ────────────────────────────────────────────────────────── */
    "mc.new": "Nouvelle catégorie",
    "mc.empty": "Aucune catégorie",
    "mc.emptyBody":
      "Créez des catégories pour organiser votre carte — les clients les voient dans cet ordre.",
    "mc.hidden": "Masquée",
    "mc.dishes_one": "{count} plat",
    "mc.dishes_other": "{count} plats",
    "mc.moveUp": "Monter {name}",
    "mc.moveDown": "Descendre {name}",
    "mc.editCategory": "Modifier {name}",
    "mc.deleteCategory": "Supprimer {name}",
    "mc.readOnly": "Vous pouvez consulter cette liste, mais pas la modifier.",

    /* ── Panneau d'édition ────────────────────────────────────────────── */
    "mc.newTitle": "Nouvelle catégorie",
    "mc.editTitle": "Modifier la catégorie",
    "mc.name": "Nom",
    "mc.namePh": "Grillades",
    "mc.nameHint": "Deux caractères minimum. C'est le titre que vos clients lisent sur la carte.",
    "mc.icon": "Icône",
    "mc.iconHint": "Touchez une icône : elle accompagne la catégorie sur votre carte.",
    "mc.chooseIcon": "Choisir une icône",
    "mc.preview": "Aperçu",
    "mc.visible": "Visible par les clients",
    "mc.visibleHint": "Masquée, la catégorie et ses plats disparaissent de votre carte publique.",

    /* ── Retours ──────────────────────────────────────────────────────── */
    "mc.created": "Catégorie créée.",
    "mc.saved": "Catégorie enregistrée.",
    "mc.deleted": "Catégorie supprimée.",
    "mc.deletedWithDishes_one": "Catégorie supprimée. {count} plat est maintenant sans catégorie.",
    "mc.deletedWithDishes_other":
      "Catégorie supprimée. {count} plats sont maintenant sans catégorie.",

    /* ── Suppression ──────────────────────────────────────────────────── */
    "mc.deleteTitle": "Supprimer {name} ?",
    "mc.deleteEmpty": "Cette catégorie est vide. Rien d'autre ne sera supprimé.",
    "mc.deleteBody_one":
      "{count} plat passera en « sans catégorie ». Il reste sur votre carte, vous pourrez le reclasser.",
    "mc.deleteBody_other":
      "{count} plats passeront en « sans catégorie ». Ils restent sur votre carte, vous pourrez les reclasser.",

    /* ── Groupes du sélecteur d'icônes ────────────────────────────────── */
    "icons.group.savoury": "Plats salés",
    "icons.group.produce": "Fruits et légumes",
    "icons.group.drinks": "Boissons",
    "icons.group.sweet": "Sucré et desserts",
    "icons.group.markers": "Repères",

    /* ── Noms des icônes (libellé accessible de chaque bouton) ────────── */
    "icons.name.UtensilsCrossed": "Couverts croisés",
    "icons.name.Utensils": "Couverts",
    "icons.name.ChefHat": "Toque de chef",
    "icons.name.HandPlatter": "Plateau de service",
    "icons.name.Soup": "Soupe",
    "icons.name.Salad": "Salade",
    "icons.name.Beef": "Bœuf",
    "icons.name.Drumstick": "Cuisse de poulet",
    "icons.name.Fish": "Poisson",
    "icons.name.Shell": "Coquillage",
    "icons.name.Ham": "Jambon",
    "icons.name.Egg": "Œuf",
    "icons.name.EggFried": "Œuf au plat",
    "icons.name.Pizza": "Pizza",
    "icons.name.Hamburger": "Burger",
    "icons.name.Sandwich": "Sandwich",

    "icons.name.Leaf": "Feuille",
    "icons.name.Vegan": "Végétalien",
    "icons.name.Carrot": "Carotte",
    "icons.name.Bean": "Haricot",
    "icons.name.Wheat": "Blé",
    "icons.name.Nut": "Noix",
    "icons.name.Apple": "Pomme",
    "icons.name.Banana": "Banane",
    "icons.name.Cherry": "Cerise",
    "icons.name.Citrus": "Agrume",
    "icons.name.Grape": "Raisin",

    "icons.name.Coffee": "Café",
    "icons.name.CupSoda": "Soda",
    "icons.name.GlassWater": "Eau",
    "icons.name.Milk": "Lait",
    "icons.name.Beer": "Bière",
    "icons.name.Wine": "Vin",
    "icons.name.Martini": "Cocktail",

    "icons.name.Dessert": "Dessert",
    "icons.name.Cake": "Gâteau",
    "icons.name.CakeSlice": "Part de gâteau",
    "icons.name.IceCreamCone": "Cornet de glace",
    "icons.name.IceCreamBowl": "Coupe glacée",
    "icons.name.Cookie": "Biscuit",
    "icons.name.Croissant": "Croissant",
    "icons.name.Donut": "Beignet",
    "icons.name.Candy": "Bonbon",
    "icons.name.Lollipop": "Sucette",
    "icons.name.Popcorn": "Pop-corn",

    "icons.name.Flame": "Flamme",
    "icons.name.Star": "Étoile",
    "icons.name.Sparkles": "Étincelles",
    "icons.name.Gift": "Cadeau",
    "icons.name.PartyPopper": "Fête",
    "icons.name.Snowflake": "Flocon",
    "icons.name.Sun": "Soleil",
    "icons.name.ShoppingBasket": "Panier",
    "icons.name.LayoutGrid": "Grille",
  },
  en: {
    "mc.title": "Categories",
    "mc.subtitle": "Organise your menu — customers see your categories in this order.",

    /* ── List ─────────────────────────────────────────────────────────── */
    "mc.new": "New category",
    "mc.empty": "No categories yet",
    "mc.emptyBody": "Create categories to organise your menu — customers see them in this order.",
    "mc.hidden": "Hidden",
    "mc.dishes_one": "{count} dish",
    "mc.dishes_other": "{count} dishes",
    "mc.moveUp": "Move {name} up",
    "mc.moveDown": "Move {name} down",
    "mc.editCategory": "Edit {name}",
    "mc.deleteCategory": "Delete {name}",
    "mc.readOnly": "You can view this list, but not change it.",

    /* ── Edit panel ───────────────────────────────────────────────────── */
    "mc.newTitle": "New category",
    "mc.editTitle": "Edit the category",
    "mc.name": "Name",
    "mc.namePh": "Grills",
    "mc.nameHint": "Two characters minimum. This is the heading customers read on your menu.",
    "mc.icon": "Icon",
    "mc.iconHint": "Tap an icon: it sits beside the category on your menu.",
    "mc.chooseIcon": "Choose an icon",
    "mc.preview": "Preview",
    "mc.visible": "Visible to customers",
    "mc.visibleHint": "Hidden, the category and its dishes disappear from your public menu.",

    /* ── Feedback ─────────────────────────────────────────────────────── */
    "mc.created": "Category created.",
    "mc.saved": "Category saved.",
    "mc.deleted": "Category deleted.",
    "mc.deletedWithDishes_one": "Category deleted. {count} dish is now uncategorised.",
    "mc.deletedWithDishes_other": "Category deleted. {count} dishes are now uncategorised.",

    /* ── Deletion ─────────────────────────────────────────────────────── */
    "mc.deleteTitle": "Delete {name}?",
    "mc.deleteEmpty": "This category is empty. Nothing else is deleted.",
    "mc.deleteBody_one":
      "{count} dish will become uncategorised. It stays on your menu and you can file it again.",
    "mc.deleteBody_other":
      "{count} dishes will become uncategorised. They stay on your menu and you can file them again.",

    /* ── Icon picker groups ───────────────────────────────────────────── */
    "icons.group.savoury": "Savoury",
    "icons.group.produce": "Fruit & vegetables",
    "icons.group.drinks": "Drinks",
    "icons.group.sweet": "Sweet & desserts",
    "icons.group.markers": "Markers",

    /* ── Icon names (each button's accessible label) ──────────────────── */
    "icons.name.UtensilsCrossed": "Crossed cutlery",
    "icons.name.Utensils": "Cutlery",
    "icons.name.ChefHat": "Chef's hat",
    "icons.name.HandPlatter": "Serving platter",
    "icons.name.Soup": "Soup",
    "icons.name.Salad": "Salad",
    "icons.name.Beef": "Beef",
    "icons.name.Drumstick": "Chicken drumstick",
    "icons.name.Fish": "Fish",
    "icons.name.Shell": "Shellfish",
    "icons.name.Ham": "Ham",
    "icons.name.Egg": "Egg",
    "icons.name.EggFried": "Fried egg",
    "icons.name.Pizza": "Pizza",
    "icons.name.Hamburger": "Burger",
    "icons.name.Sandwich": "Sandwich",

    "icons.name.Leaf": "Leaf",
    "icons.name.Vegan": "Vegan",
    "icons.name.Carrot": "Carrot",
    "icons.name.Bean": "Bean",
    "icons.name.Wheat": "Wheat",
    "icons.name.Nut": "Nut",
    "icons.name.Apple": "Apple",
    "icons.name.Banana": "Banana",
    "icons.name.Cherry": "Cherry",
    "icons.name.Citrus": "Citrus",
    "icons.name.Grape": "Grapes",

    "icons.name.Coffee": "Coffee",
    "icons.name.CupSoda": "Soft drink",
    "icons.name.GlassWater": "Water",
    "icons.name.Milk": "Milk",
    "icons.name.Beer": "Beer",
    "icons.name.Wine": "Wine",
    "icons.name.Martini": "Cocktail",

    "icons.name.Dessert": "Dessert",
    "icons.name.Cake": "Cake",
    "icons.name.CakeSlice": "Slice of cake",
    "icons.name.IceCreamCone": "Ice cream cone",
    "icons.name.IceCreamBowl": "Ice cream bowl",
    "icons.name.Cookie": "Biscuit",
    "icons.name.Croissant": "Croissant",
    "icons.name.Donut": "Doughnut",
    "icons.name.Candy": "Sweet",
    "icons.name.Lollipop": "Lollipop",
    "icons.name.Popcorn": "Popcorn",

    "icons.name.Flame": "Flame",
    "icons.name.Star": "Star",
    "icons.name.Sparkles": "Sparkles",
    "icons.name.Gift": "Gift",
    "icons.name.PartyPopper": "Party",
    "icons.name.Snowflake": "Snowflake",
    "icons.name.Sun": "Sun",
    "icons.name.ShoppingBasket": "Basket",
    "icons.name.LayoutGrid": "Grid",
  },
});
