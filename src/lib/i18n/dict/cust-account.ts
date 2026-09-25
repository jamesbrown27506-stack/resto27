import { defineDict } from "../define";

/**
 * The customer dashboard (/account).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `cac.` so two modules can never collide.
 */
export const custAccountDict = defineDict({
  fr: {
    "cac.title": "Tableau de bord",
    "cac.subtitle": "Vos commandes, vos réservations et vos points.",
    "cac.greeting": "Bonjour, {name}",
    "cac.order": "Commander",

    "cac.stat.active": "Commandes en cours",
    "cac.stat.activeLive": "Suivi en direct",
    "cac.stat.activeNone": "Aucune en cours",
    "cac.stat.points": "Points de fidélité",
    "cac.stat.pointsWorth": "soit {amount}",
    "cac.stat.upcoming": "Réservations à venir",
    "cac.stat.upcomingNone": "Aucune",

    "cac.recent.title": "Commandes récentes",
    "cac.seeAll": "Tout voir",
    "cac.recent.empty": "Aucune commande",
    "cac.recent.emptyBody": "Vos commandes apparaîtront ici.",
    "cac.recent.discover": "Découvrir les restaurants",

    "cac.upcoming.title": "Prochaines réservations",
    "cac.upcoming.manage": "Gérer",
    "cac.upcoming.empty": "Aucune réservation",
    "cac.upcoming.emptyBody": "Réservez une table dans vos restaurants favoris.",
    "cac.upcoming.people": "{count} pers.",

    "cac.points.unit": "pts",
    "cac.points.body": "Utilisables dès votre prochaine commande, soit {amount} de réduction.",
    "cac.points.history": "Voir mon historique de points →",

    "cac.wallet.title": "Portefeuille Resto237",
    "cac.wallet.body": "Les remboursements de commandes payées en ligne arrivent ici. Utilisez ce solde pour payer vos prochaines commandes.",
    "cac.wallet.empty": "Aucun mouvement pour l’instant.",
    "cac.wallet.unavailable": "Le portefeuille n’est pas encore disponible sur votre compte.",
    "cac.wallet.recent": "Derniers mouvements",
    "cac.wallet.kind.refund": "Remboursement",
    "cac.wallet.kind.payment": "Paiement de commande",
    "cac.wallet.kind.adjustment": "Ajustement",
    "cac.wallet.balanceAfter": "Solde : {amount}",

    "cac.favorites.title": "Vos favoris",
    "cac.favorites.empty": "Aucun favori pour l'instant",
    "cac.favorites.emptyBody": "Touchez le cœur sur un restaurant pour le retrouver ici.",
  },
  en: {
    "cac.title": "Dashboard",
    "cac.subtitle": "Your orders, your bookings and your points.",
    "cac.greeting": "Hello, {name}",
    "cac.order": "Order",

    "cac.stat.active": "Orders in progress",
    "cac.stat.activeLive": "Tracked live",
    "cac.stat.activeNone": "None in progress",
    "cac.stat.points": "Loyalty points",
    "cac.stat.pointsWorth": "worth {amount}",
    "cac.stat.upcoming": "Upcoming bookings",
    "cac.stat.upcomingNone": "None",

    "cac.recent.title": "Recent orders",
    "cac.seeAll": "See all",
    "cac.recent.empty": "No orders",
    "cac.recent.emptyBody": "Your orders will appear here.",
    "cac.recent.discover": "Discover restaurants",

    "cac.upcoming.title": "Next bookings",
    "cac.upcoming.manage": "Manage",
    "cac.upcoming.empty": "No bookings",
    "cac.upcoming.emptyBody": "Book a table at one of your favourite restaurants.",
    "cac.upcoming.people": "{count} people",

    "cac.points.unit": "pts",
    "cac.points.body": "Usable on your next order — {amount} off.",
    "cac.points.history": "See my points history →",

    "cac.wallet.title": "Resto237 wallet",
    "cac.wallet.body": "Refunds for orders paid online land here. Use this balance to pay for your next orders.",
    "cac.wallet.empty": "No movements yet.",
    "cac.wallet.unavailable": "The wallet is not available on your account yet.",
    "cac.wallet.recent": "Latest movements",
    "cac.wallet.kind.refund": "Refund",
    "cac.wallet.kind.payment": "Order payment",
    "cac.wallet.kind.adjustment": "Adjustment",
    "cac.wallet.balanceAfter": "Balance: {amount}",

    "cac.favorites.title": "Your favourites",
    "cac.favorites.empty": "No favourites yet",
    "cac.favorites.emptyBody": "Tap the heart on a restaurant to find it here.",
  },
});
