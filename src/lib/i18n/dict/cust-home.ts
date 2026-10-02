import { defineDict } from "../define";

/**
 * The signed-in customer's home (/ when a customer is signed in).
 *
 * OWNED BY THIS SCREEN. Prefix every key with `chm.` so two modules can never
 * collide.
 */
export const custHomeDict = defineDict({
  fr: {
    "chm.greeting": "Bonjour, {name}",
    "chm.greetingNoName": "Bonjour",
    "chm.prompt": "On mange quoi aujourd'hui ?",
    "chm.search.label": "Rechercher un plat ou un restaurant",
    "chm.search.placeholder": "Un plat, un restaurant…",

    "chm.now.title": "À faire maintenant",
    "chm.now.inProgress": "En cours",

    "chm.pay.badge": "À payer",
    "chm.pay.title": "{restaurant} a accepté votre commande",
    "chm.pay.body": "Payez pour lancer la préparation. Sans paiement, elle est annulée automatiquement.",
    "chm.pay.minutesLeft": "{count} min restantes",
    "chm.pay.lastMinute": "Moins d'une minute",
    "chm.pay.before": "avant {time}",
    "chm.pay.total": "À payer maintenant",
    "chm.pay.deliveryCash": "Livraison {amount}, en espèces au livreur",
    "chm.pay.deliveryLater": "Livraison à régler en espèces au livreur",
    "chm.pay.cta": "Payer maintenant",
    "chm.pay.open": "Voir la commande",

    "chm.wait.badge": "En attente",
    "chm.wait.title": "{restaurant} n'a pas encore répondu",
    "chm.wait.body": "Vous serez prévenu dès que le restaurant accepte. Rien n'est à payer pour l'instant.",

    "chm.track.title": "Votre commande chez {restaurant}",
    "chm.track.paid": "Payée {amount}",
    "chm.track.cta": "Suivre la commande",

    "chm.booking.today": "Aujourd'hui · {time}",
    "chm.booking.tomorrow": "Demain · {time}",
    "chm.booking.on": "{day} · {time}",
    "chm.booking.party": "{restaurant} · {count} pers.",
    "chm.booking.voucher": "Mon bon",
    "chm.booking.pay": "Payer l'acompte",
    "chm.booking.depositDue": "Acompte à payer : {amount}",
    "chm.booking.pending": "En attente de confirmation",
    "chm.booking.open": "Voir",

    "chm.short.label": "Raccourcis",
    "chm.short.reorder": "Recommander",
    "chm.short.favorites": "Favoris",
    "chm.short.book": "Réserver",
    "chm.short.points": "Mes points",

    "chm.cravings.title": "Envies du moment",
    "chm.cravings.all": "Explorer",
    "chm.cravings.restaurants": "{count} restaurants",
    "chm.cravings.oneRestaurant": "1 restaurant",

    "chm.reorder.title": "Commander à nouveau",
    "chm.reorder.all": "Tout voir",

    "chm.menu.title": "Au menu aujourd'hui",
    "chm.menu.subtitle": "Des plats de nos restaurants, à commander tout de suite",
    "chm.menu.open": "Voir et commander : {dish}",
    "chm.menu.all": "Voir tous les plats",

    "chm.featured.title": "Restaurants à la une",
    "chm.featured.all": "Tous",
    "chm.featured.open": "Ouvert",
    "chm.featured.closed": "Fermé",
    "chm.featured.new": "Nouveau",
    "chm.featured.minutes": "{min} min",
  },
  en: {
    "chm.greeting": "Hello, {name}",
    "chm.greetingNoName": "Hello",
    "chm.prompt": "What are we eating today?",
    "chm.search.label": "Search for a dish or a restaurant",
    "chm.search.placeholder": "A dish, a restaurant…",

    "chm.now.title": "To do now",
    "chm.now.inProgress": "In progress",

    "chm.pay.badge": "To pay",
    "chm.pay.title": "{restaurant} accepted your order",
    "chm.pay.body": "Pay to start the cooking. Without payment, it is cancelled automatically.",
    "chm.pay.minutesLeft": "{count} min left",
    "chm.pay.lastMinute": "Under a minute",
    "chm.pay.before": "before {time}",
    "chm.pay.total": "To pay now",
    "chm.pay.deliveryCash": "Delivery {amount}, in cash to the rider",
    "chm.pay.deliveryLater": "Delivery paid in cash to the rider",
    "chm.pay.cta": "Pay now",
    "chm.pay.open": "View the order",

    "chm.wait.badge": "Waiting",
    "chm.wait.title": "{restaurant} has not answered yet",
    "chm.wait.body": "You will be told as soon as the restaurant accepts. Nothing is owed yet.",

    "chm.track.title": "Your order from {restaurant}",
    "chm.track.paid": "Paid {amount}",
    "chm.track.cta": "Track the order",

    "chm.booking.today": "Today · {time}",
    "chm.booking.tomorrow": "Tomorrow · {time}",
    "chm.booking.on": "{day} · {time}",
    "chm.booking.party": "{restaurant} · {count} people",
    "chm.booking.voucher": "My voucher",
    "chm.booking.pay": "Pay the deposit",
    "chm.booking.depositDue": "Deposit to pay: {amount}",
    "chm.booking.pending": "Waiting for confirmation",
    "chm.booking.open": "View",

    "chm.short.label": "Shortcuts",
    "chm.short.reorder": "Reorder",
    "chm.short.favorites": "Favourites",
    "chm.short.book": "Book",
    "chm.short.points": "My points",

    "chm.cravings.title": "Cravings",
    "chm.cravings.all": "Explore",
    "chm.cravings.restaurants": "{count} restaurants",
    "chm.cravings.oneRestaurant": "1 restaurant",

    "chm.reorder.title": "Order again",
    "chm.reorder.all": "See all",

    "chm.menu.title": "On the menu today",
    "chm.menu.subtitle": "Dishes from our restaurants, ready to order",
    "chm.menu.open": "View and order: {dish}",
    "chm.menu.all": "See all dishes",

    "chm.featured.title": "Featured restaurants",
    "chm.featured.all": "All",
    "chm.featured.open": "Open",
    "chm.featured.closed": "Closed",
    "chm.featured.new": "New",
    "chm.featured.minutes": "{min} min",
  },
});
