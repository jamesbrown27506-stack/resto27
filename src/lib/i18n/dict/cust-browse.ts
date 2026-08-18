import { defineDict } from "../define";

/**
 * The restaurant directory, a restaurant's public page and the dish menu
 * (/browse, /browse/[slug], the modifier sheet).
 *
 * OWNED BY THESE SCREENS. Add every string they need here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `cbr.` so two modules can never collide.
 */
export const custBrowseDict = defineDict({
  fr: {
    "cbr.title": "Restaurants",
    "cbr.subtitle": "Trouvez où commander près de chez vous.",
    "cbr.browseTitle": "Commander",
    "cbr.browseSubtitle": "Choisissez un restaurant et composez votre commande.",
    "cbr.addFavorite": "Ajouter aux favoris",
    "cbr.removeFavorite": "Retirer des favoris",

    /* ── Restaurant page / dish menu ─────────────────────────────────── */
    "cbr.order": "Commander",
    "cbr.bookTable": "Réserver une table",
    "cbr.verifiedTitle": "Vérifié par RestoLink",
    "cbr.verified": "Vérifié",
    "cbr.deliveryFrom": "Livraison dès {amount}",
    "cbr.pickup": "À emporter",
    "cbr.about": "environ {minutes} min",
    "cbr.menu": "Menu",
    "cbr.reviews": "Avis",
    "cbr.reviewCount": "({count})",
    "cbr.soldOut": "Épuisé",
    "cbr.others": "Autres plats",
    "cbr.optionGroups": "{groups}",

    /* ── Restaurant page sidebar ─────────────────────────────────────── */
    "cbr.hours": "Horaires",
    "cbr.delivery": "Livraison",
    "cbr.minOrder": "Commande minimum",
    "cbr.estTime": "Délai estimé",
    "cbr.fee": "Frais de livraison",
    "cbr.feeToConfirm": "à confirmer",
    "cbr.feeNote":
      "Les frais de livraison sont fixés par le restaurant lorsqu&apos;il confirme votre commande, selon votre quartier.",
    "cbr.openBadge": "Ouvert",
    "cbr.closedBadge": "Fermé",
    "cbr.notAccepting": "Ne prend plus de commandes",
    "cbr.openPlaceholder": "…",

    /* ── Reviews ─────────────────────────────────────────────────────── */
    "cbr.noReviews": "Pas encore d'avis",
    "cbr.noReviewsBody": "Soyez le premier à donner votre avis après votre commande.",
    "cbr.reply": "Réponse du restaurant",
    "cbr.photoAttached": "Photo jointe à l'avis",
    "cbr.hoursCaption": "Horaires d'ouverture",
    "cbr.today": "· aujourd'hui",

    /* ── Dish menu (browse/[slug]) ───────────────────────────────────── */
    "cbr.backAll": "Tous les restaurants",
    "cbr.infoReviews": "Infos et avis",
    "cbr.minimum": "Minimum {amount}",
    "cbr.categoriesAria": "Catégories",
    "cbr.lowStock": "Plus que {count}",
    "cbr.plusOptions": "+ options",
    "cbr.notAcceptingBanner":
      "Ce restaurant ne prend plus de commandes pour le moment. Vous pouvez toujours consulter la carte.",
    "cbr.items_one": "{count} article",
    "cbr.items_other": "{count} articles",
    "cbr.deliveryToConfirm": "livraison à confirmer",
    "cbr.viewCart": "Voir le panier",

    /* ── Modifier sheet ──────────────────────────────────────────────── */
    "cbr.add": "Ajouter · {price}",
    "cbr.required": "Obligatoire",
    "cbr.optional": "Facultatif",
    "cbr.max": "{max} max.",
    "cbr.optionUnavailable": "Indisponible aujourd'hui",
    "cbr.instructions": "Instructions",
    "cbr.instructionsOptional": "(facultatif)",
    "cbr.instructionsPh": "Sans oignons, bien cuit…",
    "cbr.chooseRequired": "Choisissez : {groups}.",
    "cbr.allergens": "Allergènes :",
    "cbr.replaceTitle": "Changer de restaurant ?",
    "cbr.replaceBody":
      "Votre panier contient des articles d'un autre restaurant. Ajouter celui-ci remplacera votre panier actuel.",
    "cbr.replaceConfirm": "Remplacer le panier",
    "cbr.cancel": "Annuler",
    "cbr.addedTitle": "Ajouté à votre panier",
    "cbr.addedBody": "Votre panier est prêt. Finalisez votre commande quand vous voulez.",
    "cbr.addedItems": "{count} article(s)",
    "cbr.addedTotal": "Total",
    "cbr.addedContinue": "Continuer la carte",
    "cbr.addedFinalize": "Finaliser la commande",

    /* ── Directory filters ───────────────────────────────────────────── */
    "cbr.quartier": "Quartier",
    "cbr.cuisine": "Cuisine",
    "cbr.rating": "Note",
    "cbr.budget": "Budget",
  },
  en: {
    "cbr.title": "Restaurants",
    "cbr.subtitle": "Find somewhere to order from near you.",
    "cbr.browseTitle": "Order",
    "cbr.browseSubtitle": "Pick a restaurant and build your order.",
    "cbr.addFavorite": "Add to favourites",
    "cbr.removeFavorite": "Remove from favourites",

    /* ── Restaurant page / dish menu ─────────────────────────────────── */
    "cbr.order": "Order",
    "cbr.bookTable": "Book a table",
    "cbr.verifiedTitle": "Verified by RestoLink",
    "cbr.verified": "Verified",
    "cbr.deliveryFrom": "Delivery from {amount}",
    "cbr.pickup": "Pickup",
    "cbr.about": "about {minutes} min",
    "cbr.menu": "Menu",
    "cbr.reviews": "Reviews",
    "cbr.reviewCount": "({count})",
    "cbr.soldOut": "Sold out",
    "cbr.others": "Other dishes",
    "cbr.optionGroups": "{groups}",

    /* ── Restaurant page sidebar ─────────────────────────────────────── */
    "cbr.hours": "Opening hours",
    "cbr.delivery": "Delivery",
    "cbr.minOrder": "Minimum order",
    "cbr.estTime": "Estimated time",
    "cbr.fee": "Delivery fee",
    "cbr.feeToConfirm": "to be confirmed",
    "cbr.feeNote":
      "The delivery fee is set by the restaurant when it confirms your order, based on your neighbourhood.",
    "cbr.openBadge": "Open",
    "cbr.closedBadge": "Closed",
    "cbr.notAccepting": "Not taking orders",
    "cbr.openPlaceholder": "…",

    /* ── Reviews ─────────────────────────────────────────────────────── */
    "cbr.noReviews": "No reviews yet",
    "cbr.noReviewsBody": "Be the first to leave a review after your order.",
    "cbr.reply": "Restaurant's reply",
    "cbr.photoAttached": "Photo attached to the review",
    "cbr.hoursCaption": "Opening hours",
    "cbr.today": "· today",

    /* ── Dish menu (browse/[slug]) ───────────────────────────────────── */
    "cbr.backAll": "All restaurants",
    "cbr.infoReviews": "Info & reviews",
    "cbr.minimum": "Minimum {amount}",
    "cbr.categoriesAria": "Categories",
    "cbr.lowStock": "Only {count} left",
    "cbr.plusOptions": "+ options",
    "cbr.notAcceptingBanner":
      "This restaurant is not taking orders right now. You can still browse the menu.",
    "cbr.items_one": "{count} item",
    "cbr.items_other": "{count} items",
    "cbr.deliveryToConfirm": "delivery to be confirmed",
    "cbr.viewCart": "View basket",

    /* ── Modifier sheet ──────────────────────────────────────────────── */
    "cbr.add": "Add · {price}",
    "cbr.required": "Required",
    "cbr.optional": "Optional",
    "cbr.max": "{max} max.",
    "cbr.optionUnavailable": "Unavailable today",
    "cbr.instructions": "Instructions",
    "cbr.instructionsOptional": "(optional)",
    "cbr.instructionsPh": "No onions, well done…",
    "cbr.chooseRequired": "Choose: {groups}.",
    "cbr.allergens": "Allergens:",
    "cbr.replaceTitle": "Switch restaurant?",
    "cbr.replaceBody":
      "Your basket holds dishes from another restaurant. Adding this one will replace your current basket.",
    "cbr.replaceConfirm": "Replace basket",
    "cbr.cancel": "Cancel",
    "cbr.addedTitle": "Added to your basket",
    "cbr.addedBody": "Your basket is ready. Finalize your order whenever you like.",
    "cbr.addedItems": "{count} item(s)",
    "cbr.addedTotal": "Total",
    "cbr.addedContinue": "Keep browsing",
    "cbr.addedFinalize": "Finalize order",

    /* ── Directory filters ───────────────────────────────────────────── */
    "cbr.quartier": "Neighbourhood",
    "cbr.cuisine": "Cuisine",
    "cbr.rating": "Rating",
    "cbr.budget": "Budget",
  },
});
