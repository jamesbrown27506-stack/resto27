import { defineDict } from "../define";

/**
 * Discount codes (/m/promotions).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `mpr.` so two modules can never collide.
 *
 * `mpr.type.*` and `mpr.status.*` are keyed on the RAW column values
 * (`discount_type`, and the dates/counters the status is derived from) so the
 * component never has to hold a French word to decide what to draw.
 */
export const promotionsDict = defineDict({
  fr: {
    "mpr.title": "Promotions",
    "mpr.subtitle": "Vos codes de réduction et leur utilisation réelle.",

    /* Liste */
    "mpr.new": "Nouveau code",
    "mpr.empty": "Aucune promotion",
    "mpr.emptyBody":
      "Créez un code de réduction pour vos clients fidèles ou pour lancer un nouveau plat.",

    /* Type de remise — clé = valeur de la colonne discount_type */
    "mpr.type.percent": "Pourcentage",
    "mpr.type.fixed": "Montant fixe",

    /* État déduit des dates et des compteurs, jamais saisi à la main */
    "mpr.status.active": "Active",
    "mpr.status.scheduled": "Programmée",
    "mpr.status.expired": "Expirée",
    "mpr.status.usedUp": "Épuisée",

    "mpr.percentOff": "−{value} %",
    "mpr.amountOff": "−{amount}",
    "mpr.minOrder": "dès {amount}",
    "mpr.cappedAt": "plafonné à {amount}",
    "mpr.uncapped": "sans plafond",
    "mpr.usedTimes": "Utilisée {count} fois",
    "mpr.usedOfLimit": "Utilisée {count} / {limit} fois",
    "mpr.startsOn": "à partir du {date}",
    "mpr.until": "jusqu'au {date}",

    /* Interrupteur d'activation */
    "mpr.on": "Activée",
    "mpr.off": "Désactivée",
    "mpr.toggleAria": "Activer ou désactiver le code {code}",
    "mpr.enabled": "Code activé.",
    "mpr.disabled": "Code désactivé.",

    /* Limite de formule */
    "mpr.planLimit": "Limite de la formule atteinte",
    "mpr.limitReached": "Limite atteinte : {used} / {limit} promotions actives.",
    "mpr.limitBody":
      "Vos codes existants continuent de fonctionner. Désactivez-en un, ou passez à une formule supérieure.",
    "mpr.changePlan": "Changer de formule",

    /* Formulaire */
    "mpr.code": "Code",
    "mpr.codeHint": "3 à 24 lettres et chiffres, sans espace.",
    "mpr.codePh": "RENTREE20",
    "mpr.label": "Description",
    "mpr.labelHint": "Pour vous. Le client ne la voit pas.",
    "mpr.labelPh": "Campagne de rentrée",
    "mpr.discountType": "Type",
    "mpr.valuePercent": "Réduction (%)",
    "mpr.valueAmount": "Réduction (FCFA)",
    "mpr.minOrderField": "Commande minimum (FCFA)",
    "mpr.maxDiscountField": "Réduction maximum (FCFA)",
    "mpr.maxDiscountPh": "5000",
    "mpr.maxDiscountHint":
      "Fortement recommandé. Sans plafond, une grosse commande prend le pourcentage entier.",
    "mpr.endsAtField": "Fin",
    "mpr.endsAtHint": "Vide = sans date de fin.",
    "mpr.usageLimitField": "Utilisations max",
    "mpr.usageLimitHint": "Vide = illimité.",
    "mpr.created": "Code créé.",
    "mpr.createdUncapped":
      "Code créé sans plafond — une grosse commande prendra le pourcentage entier.",
  },
  en: {
    "mpr.title": "Promotions",
    "mpr.subtitle": "Your discount codes and how they are actually used.",

    /* List */
    "mpr.new": "New code",
    "mpr.empty": "No promotions",
    "mpr.emptyBody": "Create a discount code for your regulars, or to launch a new dish.",

    /* Discount type — key is the discount_type column value */
    "mpr.type.percent": "Percentage",
    "mpr.type.fixed": "Fixed amount",

    /* State derived from the dates and counters, never typed by hand */
    "mpr.status.active": "Active",
    "mpr.status.scheduled": "Scheduled",
    "mpr.status.expired": "Expired",
    "mpr.status.usedUp": "Used up",

    "mpr.percentOff": "−{value}%",
    "mpr.amountOff": "−{amount}",
    "mpr.minOrder": "from {amount}",
    "mpr.cappedAt": "capped at {amount}",
    "mpr.uncapped": "no cap",
    "mpr.usedTimes": "Used {count} times",
    "mpr.usedOfLimit": "Used {count} / {limit} times",
    "mpr.startsOn": "starts {date}",
    "mpr.until": "until {date}",

    /* Activation switch */
    "mpr.on": "On",
    "mpr.off": "Off",
    "mpr.toggleAria": "Turn code {code} on or off",
    "mpr.enabled": "Code switched on.",
    "mpr.disabled": "Code switched off.",

    /* Plan limit */
    "mpr.planLimit": "Plan limit reached",
    "mpr.limitReached": "Limit reached: {used} / {limit} active promotions.",
    "mpr.limitBody":
      "Your existing codes keep working. Switch one off, or move up to a larger plan.",
    "mpr.changePlan": "Change plan",

    /* Form */
    "mpr.code": "Code",
    "mpr.codeHint": "3 to 24 letters and digits, no spaces.",
    "mpr.codePh": "BACK2SCHOOL",
    "mpr.label": "Description",
    "mpr.labelHint": "For you. The customer never sees it.",
    "mpr.labelPh": "Back-to-school campaign",
    "mpr.discountType": "Type",
    "mpr.valuePercent": "Discount (%)",
    "mpr.valueAmount": "Discount (FCFA)",
    "mpr.minOrderField": "Minimum order (FCFA)",
    "mpr.maxDiscountField": "Maximum discount (FCFA)",
    "mpr.maxDiscountPh": "5000",
    "mpr.maxDiscountHint":
      "Strongly recommended. With no cap, one large order takes the full percentage.",
    "mpr.endsAtField": "End date",
    "mpr.endsAtHint": "Empty = no end date.",
    "mpr.usageLimitField": "Max uses",
    "mpr.usageLimitHint": "Empty = unlimited.",
    "mpr.created": "Code created.",
    "mpr.createdUncapped":
      "Created with no maximum discount — a large order will take the full percentage.",
  },
});
