import { defineDict } from "../define";

/**
 * The restaurant's own public profile (/m/profile).
 *
 * OWNED BY THIS SCREEN. Every string it needs lives here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there is
 * no way to half-translate the page.
 *
 * Prefix every key with `mpf.` so two modules can never collide.
 *
 * The seven weekday names are DELIBERATELY ABSENT: the form builds them with
 * Intl.DateTimeFormat from the active locale, so a third language gets them for
 * free instead of needing fourteen more keys here.
 */
export const profileDict = defineDict({
  fr: {
    "mpf.title": "Profil du restaurant",
    "mpf.subtitle": "Ce que vos clients voient sur votre fiche publique.",

    /* Empty state — la ligne de l'établissement est absente ou illisible. */
    "mpf.missing": "Fiche introuvable",
    "mpf.missingBody":
      "Impossible de lire les informations de cet établissement. Réessayez, ou changez d'établissement.",

    /* Informations */
    "mpf.info": "Informations",
    "mpf.name": "Nom du restaurant",
    "mpf.namePlaceholder": "Chez Marcel",
    "mpf.branch": "Nom de la succursale",
    "mpf.branchHint": "Affiché à côté du nom quand vous avez plusieurs adresses.",
    "mpf.cuisine": "Type de cuisine",
    "mpf.cuisineHint": "Détermine où votre fiche apparaît dans l'annuaire public.",
    "mpf.cuisineNone": "Non précisé",
    "mpf.cuisineRequired":
      "Choisissez une cuisine : sans elle, votre restaurant n'apparaît sur aucune page de cuisine.",
    "mpf.phone": "Téléphone",
    "mpf.phonePlaceholder": "+237 6 99 11 22 33",
    "mpf.phoneHint": "Le numéro affiché à vos clients.",
    "mpf.description": "Description",
    "mpf.descriptionPlaceholder":
      "La cuisine camerounaise de tous les jours, préparée au feu de bois…",
    "mpf.descriptionHint": "Deux phrases. C'est le premier texte que lisent vos clients.",
    "mpf.quartier": "Quartier",
    "mpf.quartierHint": "Les quartiers proposés sont ceux de votre ville.",
    "mpf.quartierNone": "Non précisé",
    "mpf.address": "Adresse",
    "mpf.addressPlaceholder": "Rue, immeuble, repère",
    "mpf.publicUrl": "Adresse publique",
    "mpf.publicUrlHint":
      "Le lien ne change jamais : chaque lien déjà partagé continue de fonctionner.",
    "mpf.viewPublic": "Voir la fiche publique",

    /* Horaires */
    "mpf.hours": "Horaires d'ouverture",
    "mpf.hoursDesc": "Un jour fermé est enregistré comme tel, pas laissé vide.",
    "mpf.hours.closed": "Fermé",
    "mpf.hours.unset": "Jamais renseigné",
    "mpf.hours.openOn": "Ouvert le {day}",
    "mpf.hours.opensAt": "Heure d'ouverture — {day}",
    "mpf.hours.closesAt": "Heure de fermeture — {day}",
    "mpf.hours.to": "à",
    "mpf.hours.overnight": "Service jusqu'au lendemain",
    "mpf.hours.incomplete":
      "{day} : indiquez l'ouverture et la fermeture, ou marquez le jour fermé.",
    "mpf.hours.required":
      "Indiquez vos horaires pour au moins un jour : ils décident du badge « ouvert » vu par vos clients.",

    /* Livraison */
    "mpf.delivery": "Livraison",
    "mpf.deliveryDesc": "Les frais eux-mêmes sont fixés commande par commande, à la confirmation.",
    "mpf.minimumOrder": "Commande minimum",
    "mpf.minimumOrderHint": "En francs entiers. 0 pour ne pas imposer de minimum.",
    "mpf.estimate": "Délai estimé",
    "mpf.estimateHint": "Indicatif, affiché sur votre fiche.",
    "mpf.minDeliveryFee": "Frais de livraison minimum",
    "mpf.minDeliveryFeeHint":
      "Affiché aux clients avant qu'ils commandent, pour qu'ils sachent à quoi s'attendre.",
    "mpf.maxDeliveryFee": "Frais de livraison maximum",
    "mpf.maxDeliveryFeeHint":
      "C'est un engagement : vos frais ne pourront pas dépasser ce montant à la confirmation. Laissez vide si vous ne pouvez pas vous engager.",
    "mpf.feeNotSet": "Non défini",
    "mpf.minutes": "min",
    "mpf.acceptsDelivery": "Accepter la livraison",
    "mpf.acceptsDeliveryDesc": "Vos clients pourront commander en livraison.",
    "mpf.ownDeliveryQuestion": "Proposez-vous vous-même la livraison ? Si non, la plateforme s’en charge pour vous.",
    "mpf.acceptsPickup": "Accepter les commandes à emporter",
    "mpf.acceptsPickupDesc": "Vos clients viendront chercher leur commande sur place.",
    "mpf.noChannel":
      "Ni livraison ni à emporter : vos clients ne pourront pas commander en ligne.",

    /* Images */
    "mpf.images": "Photos",
    "mpf.logo": "Logo",
    "mpf.logoHint": "Carré, 512 px minimum. PNG, JPG ou WebP, 2 Mo maximum.",
    "mpf.cover": "Photo de couverture",
    "mpf.coverHint": "Format 16:9, 1 600 px de large minimum. 2 Mo maximum.",
    "mpf.imagesNote":
      "Les fichiers sont vérifiés par leur contenu, pas par leur nom. Le SVG est refusé : c'est du XML, il peut contenir des scripts.",
    "mpf.imagesPending": "Choisir une image ne l'enregistre pas. Appuyez sur Enregistrer.",

    /* Barre d'enregistrement */
    "mpf.saveHint": "Vos clients voient ces changements immédiatement.",
    "mpf.unsaved": "{count} modification(s) non enregistrée(s)",
    "mpf.noChanges": "Aucune modification.",
    "mpf.discard": "Abandonner les modifications",
    "mpf.discardShort": "Annuler",
    "mpf.saved": "Profil enregistré.",
    "mpf.invalidName": "Le nom du restaurant est trop court.",
    "mpf.invalidMinimum": "La commande minimum doit être un nombre entier de francs, à partir de 0.",
    "mpf.invalidFee": "Les frais de livraison doivent être un nombre entier de francs, à partir de 0.",
    "mpf.invalidFeeOrder": "Le maximum ne peut pas être inférieur au minimum.",
    "mpf.invalidEstimate": "Le délai estimé doit être d'au moins 1 minute.",
    "mpf.uploadFailed": "L'image n'a pas pu être envoyée.",
  },
  en: {
    "mpf.title": "Restaurant profile",
    "mpf.subtitle": "What your customers see on your public page.",

    "mpf.missing": "Profile not found",
    "mpf.missingBody":
      "This location's details could not be read. Try again, or switch to another location.",

    "mpf.info": "Details",
    "mpf.name": "Restaurant name",
    "mpf.namePlaceholder": "Chez Marcel",
    "mpf.branch": "Location name",
    "mpf.branchHint": "Shown beside the name when you have more than one address.",
    "mpf.cuisine": "Cuisine",
    "mpf.cuisineHint": "Decides where you appear in the public directory.",
    "mpf.cuisineNone": "Not set",
    "mpf.cuisineRequired":
      "Pick a cuisine: without one, your restaurant appears on no cuisine page.",
    "mpf.phone": "Phone",
    "mpf.phonePlaceholder": "+237 6 99 11 22 33",
    "mpf.phoneHint": "The number shown to your customers.",
    "mpf.description": "Description",
    "mpf.descriptionPlaceholder": "Everyday Cameroonian cooking, over a wood fire…",
    "mpf.descriptionHint": "Two sentences. It is the first thing your customers read.",
    "mpf.quartier": "Neighbourhood",
    "mpf.quartierHint": "Only the neighbourhoods of your own city are offered.",
    "mpf.quartierNone": "Not set",
    "mpf.address": "Address",
    "mpf.addressPlaceholder": "Street, building, landmark",
    "mpf.publicUrl": "Public address",
    "mpf.publicUrlHint": "This link never changes, so every link you have shared keeps working.",
    "mpf.viewPublic": "View the public page",

    "mpf.hours": "Opening hours",
    "mpf.hoursDesc": "A closed day is recorded as closed, not left blank.",
    "mpf.hours.closed": "Closed",
    "mpf.hours.unset": "Never set",
    "mpf.hours.openOn": "Open on {day}",
    "mpf.hours.opensAt": "Opening time — {day}",
    "mpf.hours.closesAt": "Closing time — {day}",
    "mpf.hours.to": "to",
    "mpf.hours.overnight": "Runs past midnight",
    "mpf.hours.incomplete": "{day}: set both an opening and a closing time, or mark the day closed.",
    "mpf.hours.required":
      "Set opening hours for at least one day: they decide the “open now” badge your customers see.",

    "mpf.delivery": "Delivery",
    "mpf.deliveryDesc": "The fee itself is quoted order by order, when you confirm.",
    "mpf.minimumOrder": "Minimum order",
    "mpf.minimumOrderHint": "Whole francs. Use 0 for no minimum.",
    "mpf.estimate": "Estimated time",
    "mpf.estimateHint": "Indicative only, shown on your public page.",
    "mpf.minDeliveryFee": "Minimum delivery fee",
    "mpf.minDeliveryFeeHint":
      "Shown to customers before they order, so they know what to expect.",
    "mpf.maxDeliveryFee": "Maximum delivery fee",
    "mpf.maxDeliveryFeeHint":
      "This is a commitment: your fee cannot go above it at confirmation. Leave empty if you cannot commit to a ceiling.",
    "mpf.feeNotSet": "Not set",
    "mpf.minutes": "min",
    "mpf.acceptsDelivery": "Accept delivery",
    "mpf.acceptsDeliveryDesc": "Customers will be able to order for delivery.",
    "mpf.ownDeliveryQuestion": "Do you run deliveries yourself? If not, the platform takes care of them for you.",
    "mpf.acceptsPickup": "Accept pickup orders",
    "mpf.acceptsPickupDesc": "Customers will collect their order from you.",
    "mpf.noChannel": "Neither delivery nor pickup: customers will not be able to order online.",

    "mpf.images": "Photos",
    "mpf.logo": "Logo",
    "mpf.logoHint": "Square, 512 px or more. PNG, JPG or WebP, 2 MB maximum.",
    "mpf.cover": "Cover photo",
    "mpf.coverHint": "16:9, 1,600 px wide or more. 2 MB maximum.",
    "mpf.imagesNote":
      "Files are checked by their contents, not by their name. SVG is refused: it is XML and it can carry scripts.",
    "mpf.imagesPending": "Choosing an image does not save it. Press Save.",

    "mpf.saveHint": "Your customers see these changes straight away.",
    "mpf.unsaved": "{count} unsaved change(s)",
    "mpf.noChanges": "No changes.",
    "mpf.discard": "Discard changes",
    "mpf.discardShort": "Discard",
    "mpf.saved": "Profile saved.",
    "mpf.invalidName": "The restaurant name is too short.",
    "mpf.invalidMinimum": "The minimum order must be a whole number of francs, 0 or more.",
    "mpf.invalidFee": "Delivery fees must be a whole number of francs, 0 or more.",
    "mpf.invalidFeeOrder": "The maximum cannot be lower than the minimum.",
    "mpf.invalidEstimate": "The estimated time must be at least 1 minute.",
    "mpf.uploadFailed": "The image could not be uploaded.",
  },
});
