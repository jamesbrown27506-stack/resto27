import { defineDict } from "../define";

/**
 * The basket and checkout (/cart, /checkout).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `cct.` so two modules can never collide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE `cct.err.*` BLOCK IS THE POINT OF THIS FILE.
 *
 *  `placeOrder` refuses with a REASON CODE — "itemSoldOut", "belowMinimum",
 *  "promoUsedUp". There is one key here for every one of them, because a
 *  checkout that fails with `notEnoughStock` printed on screen is worse than
 *  one that fails with a sentence: the customer cannot act on a code, and the
 *  money path is the last place to make someone guess.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const custCartDict = defineDict({
  fr: {
    /* ── Basket ─────────────────────────────────────────────────────── */
    "cct.title": "Panier",
    "cct.heading": "Votre panier",
    "cct.empty": "Votre panier est vide",
    "cct.emptyBody": "Parcourez les restaurants de votre quartier et composez votre commande.",
    "cct.browse": "Voir les restaurants",
    "cct.items": "{count} article(s)",
    "cct.addMore": "Ajouter",
    "cct.perUnit": "{price} l'unité",
    "cct.checkout": "Commander",
    "cct.goToCheckout": "Passer commande",
    "cct.guestQ": "Pas encore inscrit ?",
    "cct.signIn": "Se connecter",
    "cct.guestKept": "Votre panier est conservé.",
    "cct.lineNote": "Note",

    /* ── Promo code ─────────────────────────────────────────────────── */
    "cct.promo.label": "Code promo",
    "cct.promo.placeholder": "Code promo",
    "cct.promo.apply": "Appliquer",
    "cct.promo.applied": "{code} appliqué",
    "cct.promo.remove": "Retirer le code promo",
    "cct.promo.checking": "Vérification…",

    "cct.promoErr.unknown": "Ce code n'existe pas pour ce restaurant.",
    "cct.promoErr.inactive": "Ce code n'est plus actif.",
    "cct.promoErr.expired": "Ce code a expiré.",
    "cct.promoErr.notStarted": "Ce code n'est pas encore valable.",
    "cct.promoErr.usedUp": "Ce code a atteint sa limite d'utilisation.",
    "cct.promoErr.minimum": "Ce code demande une commande d'au moins {amount}.",
    "cct.promoErr.failed": "Impossible de vérifier ce code pour le moment. Réessayez.",

    /* ── Loyalty ────────────────────────────────────────────────────── */
    "cct.loy.title": "Utiliser mes points",
    "cct.loy.available": "{count} disponibles",
    "cct.loy.slider": "Points à utiliser",
    "cct.loy.min": "Il faut au moins {count} points pour les utiliser.",
    "cct.loy.have": "Vous en avez {count}.",
    "cct.loy.guest": "Connectez-vous pour utiliser vos points de fidélité.",
    "cct.loy.belowMin":
      "Il faut {min} points pour commencer à les utiliser. Vous en avez {balance} — encore {missing} à gagner.",
    "cct.loy.basketTooSmall":
      "Votre panier est trop petit pour utiliser {min} points. Ajoutez un plat pour les dépenser.",
    "cct.loy.useMax": "Utiliser {points}",
    "cct.loy.useNone": "Ne pas utiliser mes points",
    "cct.loy.minHint": "Minimum {min} points par commande.",

    /* ── Totals ─────────────────────────────────────────────────────── */
    "cct.sum.title": "Récapitulatif",
    "cct.sum.subtotal": "Sous-total",
    "cct.sum.discount": "Réduction",
    "cct.sum.discountCode": "Réduction ({code})",
    "cct.sum.service": "Frais de service ({percent} %)",
    "cct.sum.delivery": "Livraison",
    "cct.sum.loyalty": "Points de fidélité",
    "cct.sum.total": "Total",
    "cct.sum.toConfirm": "à confirmer",
    "cct.sum.feeNote":
      "Les frais de livraison sont fixés par le restaurant à la confirmation, selon votre quartier. Ils s'ajouteront à ce total.",

    /* ── Checkout ───────────────────────────────────────────────────── */
    "cct.co.title": "Finaliser la commande",
    "cct.co.back": "Retour au panier",
    "cct.co.emptyBody": "Ajoutez des articles avant de passer commande.",

    "cct.co.how": "Mode de retrait",
    "cct.co.typeDelivery": "Livraison",
    "cct.co.typePickup": "À emporter",
    "cct.co.deliveryHint": "Livré à l'adresse que vous indiquez.",
    "cct.co.pickupHint": "Vous récupérez la commande au restaurant.",
    "cct.co.deliveryEst": "≈ {minutes} min",
    "cct.co.pickupAt": "Retrait à {quartier}",
    "cct.co.pickupWhere": "À récupérer chez {restaurant} — {quartier}.",
    "cct.co.pickupReady": "Prêt dans environ {minutes} min",
    "cct.co.belowMinHint": "Encore {amount} pour atteindre le minimum de commande.",

    "cct.co.contact": "Vos coordonnées",
    "cct.co.name": "Nom",
    "cct.co.namePh": "Marie Ngo",
    "cct.co.phone": "Téléphone",
    "cct.co.phonePh": "6 99 00 00 00",
    "cct.co.phoneHint": "Le restaurant et le livreur vous appellent sur ce numéro.",
    "cct.co.guestNote":
      "Pas besoin de compte pour commander. Connectez-vous si vous voulez retrouver vos commandes et vos points.",

    "cct.co.address": "Adresse de livraison",
    "cct.co.savedAddresses": "Mes adresses enregistrées",
    "cct.co.useNew": "Nouvelle adresse",
    "cct.co.useSaved": "Utiliser une adresse enregistrée",
    "cct.co.default": "Par défaut",
    "cct.co.destinationName": "Nom du destinataire",
    "cct.co.noAddresses":
      "Aucune adresse enregistrée — utilisez « Nouvelle adresse » ci-dessus.",
    "cct.co.chooseQuartier": "Choisir un quartier",
    "cct.co.addressLine": "Adresse",
    "cct.co.addressPh": "Rue, immeuble, étage",
    "cct.co.addressHint":
      "Où vous habitez : la rue, l'immeuble, l'étage. C'est l'adresse elle-même.",
    "cct.co.quartier": "Quartier",
    "cct.co.quartierPh": "Akwa, Bonapriso…",
    "cct.co.quartierHint":
      "Choisissez dans la liste ou tapez le vôtre s'il n'y figure pas.",
    "cct.co.landmark": "Point de repère",
    "cct.co.landmarkPh": "En face de la pharmacie du Golfe",
    "cct.co.landmarkHint":
      "C'est ce qui permet vraiment de vous trouver : « en face de la pharmacie », « derrière le carrefour Ndokoti ».",
    "cct.co.feeNote":
      "Les frais de livraison sont fixés par le restaurant lorsqu'il confirme votre commande, en fonction de votre quartier. Ils vous seront communiqués à ce moment-là.",
    "cct.co.feeRange":
      "Les frais de livraison de ce restaurant se situent entre {min} et {max}. Le montant exact est fixé à la confirmation, selon votre quartier — il ne dépassera pas {max}.",
    "cct.co.feeFrom":
      "Les frais de livraison de ce restaurant démarrent à {min}. Le montant exact est fixé à la confirmation, selon votre quartier.",
    "cct.co.addressesUnavailable": "Vos adresses enregistrées ne sont pas accessibles pour le moment.",
    "cct.co.pickupNote": "Le restaurant les utilise pour vous joindre au moment du retrait.",
    "cct.co.when": "Quand ?",
    "cct.co.asap": "Dès que possible",
    "cct.co.asapHint": "Le restaurant confirme dès réception de la commande",
    "cct.co.schedule": "Programmer",
    "cct.co.scheduleHint": "Choisir une heure de retrait ou de livraison",
    "cct.co.date": "Date",
    "cct.co.time": "Heure",
    "cct.co.scheduleRequired": "Choisissez une date et une heure pour la programmation.",
    "cct.co.onlineSoon": "Le paiement en ligne des commandes arrive bientôt.",
    "cct.co.noDelivery": "Ce restaurant ne propose pas la livraison.",
    "cct.co.noPickup": "Ce restaurant ne propose pas le retrait.",

    "cct.co.payment": "Paiement",
    "cct.co.payCashLabel": "Espèces à la livraison",
    "cct.co.payRestaurantLabel": "Paiement au restaurant",
    "cct.co.payCashDelivery": "Vous réglez le livreur à la remise de la commande.",
    "cct.co.payCashPickup": "Vous réglez au restaurant au moment du retrait.",
    "cct.co.payMomoDelivery": "Vous envoyez le paiement au livreur à la remise, depuis votre téléphone.",
    "cct.co.payMomoPickup": "Vous envoyez le paiement au restaurant au moment du retrait.",
    "cct.co.payNote":
      "Rien n'est prélevé maintenant : le paiement en ligne n'est pas encore disponible. Vous réglez à la livraison ou au restaurant.",

    "cct.co.notes": "Instructions",
    "cct.co.notesPh": "Sonner à l'interphone, appartement 3B…",

    "cct.co.yourOrder": "Votre commande",
    "cct.co.place": "Commander · {total}",
    "cct.co.terms1": "En commandant, vous acceptez nos",
    "cct.co.termsLink": "conditions d'utilisation",
    "cct.co.sent": "Commande {ref} envoyée au restaurant.",
    "cct.co.redirecting": "Nous vous emmenons à votre commande…",

    /* ── Why an order was refused (checkout-actions reason codes) ───── */
    "cct.err.emptyBasket": "Votre panier est vide.",
    "cct.err.badType": "Choisissez la livraison ou le retrait.",
    "cct.err.restaurantUnavailable": "Ce restaurant n'est plus disponible.",
    "cct.err.notAcceptingOrders": "Ce restaurant n'accepte pas de commandes en ce moment.",
    "cct.err.noDelivery": "Ce restaurant ne fait pas de livraison. Choisissez le retrait.",
    "cct.err.noPickup": "Ce restaurant ne fait pas de retrait. Choisissez la livraison.",
    "cct.err.itemGone": "Un plat de votre panier n'est plus au menu. Retirez-le pour continuer.",
    "cct.err.itemSoldOut": "{dish} n'est plus disponible.",
    "cct.err.badQuantity": "Une quantité de votre panier n'est pas valable.",
    "cct.err.notEnoughStock": "Il ne reste plus assez de {dish}.",
    "cct.err.optionGone": "Une option choisie n'existe plus. Recomposez ce plat.",
    "cct.err.optionUnavailable": "L'option {option} n'est plus disponible.",
    "cct.err.optionMismatch": "Une option ne correspond pas à son plat. Recomposez ce plat.",
    "cct.err.badPrice": "Le prix d'un plat est incorrect. Rechargez la page.",
    "cct.err.belowMinimum": "Ce restaurant demande une commande d'au moins {amount}.",
    "cct.err.promoInvalid": "Votre code promo n'est plus valable.",
    "cct.err.promoExpired": "Votre code promo a expiré.",
    "cct.err.promoUsedUp": "Votre code promo a atteint sa limite d'utilisation.",
    "cct.err.promoMinimum": "Ce code demande une commande d'au moins {amount}.",
    "cct.err.notEnoughPoints": "Vous n'avez pas assez de points.",
    "cct.err.belowMinPoints": "Il faut au moins {points} points pour les utiliser.",
    "cct.err.addressNotFound": "Cette adresse est introuvable. Choisissez-en une autre.",
    "cct.err.nameRequired": "Indiquez le nom de la personne à contacter.",
    "cct.err.phoneRequired": "Indiquez un numéro de téléphone.",
    "cct.err.addressRequired": "Indiquez l'adresse de livraison.",
    "cct.err.badSchedule": "La date de programmation est invalide.",
    "cct.err.scheduleTooSoon": "Choisissez un horaire à plus d'une minute.",
    "cct.err.scheduleTooFar": "La programmation est limitée à 7 jours.",
    "cct.err.rateLimited":
      "Trop de commandes passées récemment. Réessayez dans quelques minutes.",
    "cct.err.failed": "La commande n'a pas pu être enregistrée. Réessayez.",
    "cct.err.failedFallback": "La commande a échoué.",
  },
  en: {
    /* ── Basket ─────────────────────────────────────────────────────── */
    "cct.title": "Basket",
    "cct.heading": "Your basket",
    "cct.empty": "Your basket is empty",
    "cct.emptyBody": "Browse the restaurants around you and build your order.",
    "cct.browse": "Browse restaurants",
    "cct.items": "{count} item(s)",
    "cct.addMore": "Add more",
    "cct.perUnit": "{price} each",
    "cct.checkout": "Checkout",
    "cct.goToCheckout": "Go to checkout",
    "cct.guestQ": "No account yet?",
    "cct.signIn": "Sign in",
    "cct.guestKept": "Your basket is kept.",
    "cct.lineNote": "Note",

    /* ── Promo code ─────────────────────────────────────────────────── */
    "cct.promo.label": "Promo code",
    "cct.promo.placeholder": "Promo code",
    "cct.promo.apply": "Apply",
    "cct.promo.applied": "{code} applied",
    "cct.promo.remove": "Remove the promo code",
    "cct.promo.checking": "Checking…",

    "cct.promoErr.unknown": "That code does not exist for this restaurant.",
    "cct.promoErr.inactive": "That code is no longer active.",
    "cct.promoErr.expired": "That code has expired.",
    "cct.promoErr.notStarted": "That code is not valid yet.",
    "cct.promoErr.usedUp": "That code has reached its usage limit.",
    "cct.promoErr.minimum": "That code needs an order of at least {amount}.",
    "cct.promoErr.failed": "That code could not be checked right now. Try again.",

    /* ── Loyalty ────────────────────────────────────────────────────── */
    "cct.loy.title": "Use my points",
    "cct.loy.available": "{count} available",
    "cct.loy.slider": "Points to redeem",
    "cct.loy.min": "You need at least {count} points to redeem them.",
    "cct.loy.have": "You have {count}.",
    "cct.loy.guest": "Sign in to spend your loyalty points.",
    "cct.loy.belowMin":
      "You need {min} points before you can start spending them. You have {balance} — {missing} to go.",
    "cct.loy.basketTooSmall":
      "Your basket is too small to spend {min} points. Add a dish to use them.",
    "cct.loy.useMax": "Use {points}",
    "cct.loy.useNone": "Don't use my points",
    "cct.loy.minHint": "Minimum {min} points per order.",

    /* ── Totals ─────────────────────────────────────────────────────── */
    "cct.sum.title": "Summary",
    "cct.sum.subtotal": "Subtotal",
    "cct.sum.discount": "Discount",
    "cct.sum.discountCode": "Discount ({code})",
    "cct.sum.service": "Service charge ({percent}%)",
    "cct.sum.delivery": "Delivery",
    "cct.sum.loyalty": "Loyalty points",
    "cct.sum.total": "Total",
    "cct.sum.toConfirm": "to be confirmed",
    "cct.sum.feeNote":
      "The delivery fee is set by the restaurant when it confirms, based on your neighbourhood. It is added on top of this total.",

    /* ── Checkout ───────────────────────────────────────────────────── */
    "cct.co.title": "Checkout",
    "cct.co.back": "Back to the basket",
    "cct.co.emptyBody": "Add something to your basket before checking out.",

    "cct.co.how": "How would you like it?",
    "cct.co.typeDelivery": "Delivery",
    "cct.co.typePickup": "Pickup",
    "cct.co.deliveryHint": "Brought to the address you give us.",
    "cct.co.pickupHint": "You collect the order at the restaurant.",
    "cct.co.deliveryEst": "≈ {minutes} min",
    "cct.co.pickupAt": "Pickup in {quartier}",
    "cct.co.pickupWhere": "Collect at {restaurant} — {quartier}.",
    "cct.co.pickupReady": "Ready in about {minutes} min",
    "cct.co.belowMinHint": "{amount} more to reach the minimum order.",

    "cct.co.contact": "Your details",
    "cct.co.name": "Name",
    "cct.co.namePh": "Marie Ngo",
    "cct.co.phone": "Phone",
    "cct.co.phonePh": "6 99 00 00 00",
    "cct.co.phoneHint": "The restaurant and the rider call you on this number.",
    "cct.co.guestNote":
      "No account is needed to order. Sign in if you want your orders and your points kept.",

    "cct.co.address": "Delivery address",
    "cct.co.savedAddresses": "My saved addresses",
    "cct.co.useNew": "New address",
    "cct.co.useSaved": "Use a saved address",
    "cct.co.default": "Default",
    "cct.co.destinationName": "Recipient name",
    "cct.co.noAddresses":
      "No saved address — use “New address” above.",
    "cct.co.chooseQuartier": "Choose a neighbourhood",
    "cct.co.addressLine": "Address",
    "cct.co.addressPh": "Street, building, floor",
    "cct.co.addressHint":
      "Where you live: the street, the building, the floor. This is the address itself.",
    "cct.co.quartier": "Neighbourhood",
    "cct.co.quartierPh": "Akwa, Bonapriso…",
    "cct.co.quartierHint": "Pick one from the list, or type yours if it is not there.",
    "cct.co.landmark": "Landmark",
    "cct.co.landmarkPh": "Opposite the Golfe pharmacy",
    "cct.co.landmarkHint":
      "This is what actually gets you found: “opposite the pharmacy”, “behind the Ndokoti junction”.",
    "cct.co.feeNote":
      "The delivery fee is set by the restaurant when it confirms your order, based on your neighbourhood. You will be told the amount then.",
    "cct.co.feeRange":
      "This restaurant's delivery fee is between {min} and {max}. The exact amount is set at confirmation based on your neighbourhood — it will not go above {max}.",
    "cct.co.feeFrom":
      "This restaurant's delivery fee starts at {min}. The exact amount is set at confirmation based on your neighbourhood.",
    "cct.co.addressesUnavailable": "Your saved addresses cannot be reached right now.",
    "cct.co.pickupNote": "The restaurant uses these to reach you at pickup time.",
    "cct.co.when": "When?",
    "cct.co.asap": "As soon as possible",
    "cct.co.asapHint": "The restaurant confirms as soon as it receives the order",
    "cct.co.schedule": "Schedule it",
    "cct.co.scheduleHint": "Pick a pickup or delivery time",
    "cct.co.date": "Date",
    "cct.co.time": "Time",
    "cct.co.scheduleRequired": "Pick a date and time for the scheduled order.",
    "cct.co.onlineSoon": "Online payment for orders is coming soon.",
    "cct.co.noDelivery": "This restaurant does not offer delivery.",
    "cct.co.noPickup": "This restaurant does not offer pickup.",

    "cct.co.payment": "Payment",
    "cct.co.payCashLabel": "Cash on delivery",
    "cct.co.payRestaurantLabel": "Pay at the restaurant",
    "cct.co.payCashDelivery": "You pay the rider when the order is handed over.",
    "cct.co.payCashPickup": "You pay at the restaurant when you collect.",
    "cct.co.payMomoDelivery": "You send the payment to the rider from your phone at handover.",
    "cct.co.payMomoPickup": "You send the payment to the restaurant when you collect.",
    "cct.co.payNote":
      "Nothing is charged now — online payment is not available yet. You pay on delivery or at the restaurant.",

    "cct.co.notes": "Instructions",
    "cct.co.notesPh": "Ring the intercom, flat 3B…",

    "cct.co.yourOrder": "Your order",
    "cct.co.place": "Place order · {total}",
    "cct.co.terms1": "By ordering, you accept our",
    "cct.co.termsLink": "terms of use",
    "cct.co.sent": "Order {ref} sent to the restaurant.",
    "cct.co.redirecting": "Taking you to your order…",

    /* ── Why an order was refused (checkout-actions reason codes) ───── */
    "cct.err.emptyBasket": "Your basket is empty.",
    "cct.err.badType": "Choose delivery or pickup.",
    "cct.err.restaurantUnavailable": "This restaurant is no longer available.",
    "cct.err.notAcceptingOrders": "This restaurant is not taking orders right now.",
    "cct.err.noDelivery": "This restaurant does not deliver. Choose pickup.",
    "cct.err.noPickup": "This restaurant does not do pickup. Choose delivery.",
    "cct.err.itemGone": "A dish in your basket is no longer on the menu. Remove it to continue.",
    "cct.err.itemSoldOut": "{dish} is sold out.",
    "cct.err.badQuantity": "One of the quantities in your basket is not valid.",
    "cct.err.notEnoughStock": "There is not enough {dish} left.",
    "cct.err.optionGone": "An option you chose no longer exists. Build that dish again.",
    "cct.err.optionUnavailable": "The option {option} is no longer available.",
    "cct.err.optionMismatch": "An option does not belong to its dish. Build that dish again.",
    "cct.err.badPrice": "The price of a dish is wrong. Reload the page.",
    "cct.err.belowMinimum": "This restaurant needs an order of at least {amount}.",
    "cct.err.promoInvalid": "Your promo code is no longer valid.",
    "cct.err.promoExpired": "Your promo code has expired.",
    "cct.err.promoUsedUp": "Your promo code has reached its usage limit.",
    "cct.err.promoMinimum": "That code needs an order of at least {amount}.",
    "cct.err.notEnoughPoints": "You do not have that many points.",
    "cct.err.belowMinPoints": "You need at least {points} points to redeem them.",
    "cct.err.addressNotFound": "That address could not be found. Pick another one.",
    "cct.err.nameRequired": "Give the name of the person to contact.",
    "cct.err.phoneRequired": "Give a phone number.",
    "cct.err.addressRequired": "Give the delivery address.",
    "cct.err.badSchedule": "The scheduled date is not valid.",
    "cct.err.scheduleTooSoon": "Pick a time more than a minute from now.",
    "cct.err.scheduleTooFar": "Scheduling is limited to 7 days ahead.",
    "cct.err.rateLimited": "Too many orders placed recently. Try again in a few minutes.",
    "cct.err.failed": "The order could not be saved. Try again.",
    "cct.err.failedFallback": "The order failed.",
  },
});
