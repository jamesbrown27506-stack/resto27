import { defineDict } from "../define";

/**
 * Strings shared by more than one screen: verbs on buttons, filter chrome,
 * the vocabulary of a list. If a string is only ever seen on one page, it
 * belongs in that page's module instead.
 */
export const commonDict = defineDict({
  fr: {
    "common.search": "Rechercher…",
    "common.clear": "Effacer",
    "common.create": "Créer",
    "common.back": "Retour",
    "common.actions": "Actions",
    "common.none": "Aucun",
    "common.never": "Jamais",
    "common.optional": "Facultatif",
    "common.required": "Obligatoire",
    "common.loading": "Chargement…",
    "common.noResults": "Aucun résultat",
    "common.noResultsBody": "Ajustez vos filtres.",
    "common.retry": "Réessayer",
    "common.of": "sur",
    "common.total": "Total",

    /* Used wherever a count has to read naturally in both languages. */
    "common.countDishes": "{count} plat(s)",
    "common.countOrders": "{count} commande(s)",

    /*
     * Branch roles and capabilities.
     *
     * These live here, not in lib/capabilities.ts, because that module is
     * imported by Server Components and by the permission checks themselves —
     * it must stay a pure data module with no locale in it. It keeps its
     * French BRANCH_ROLE_LABEL for server-side use (emails, audit lines); the
     * keys below are what the interface renders.
     */
    "common.role.owner": "Propriétaire",
    "common.role.manager": "Gérant",
    "common.role.kitchen": "Cuisine",
    "common.role.cashier": "Caissier",
    "common.role.waiter": "Serveur",

    "common.roleDesc.owner": "Accès complet, y compris la facturation et le personnel.",
    "common.roleDesc.manager": "Gère le service, le menu et l'équipe. Pas la facturation.",
    "common.roleDesc.kitchen": "Écran de cuisine et avancement des commandes.",
    "common.roleDesc.cashier": "Commandes, encaissement et clients.",
    "common.roleDesc.waiter": "Prise de commande en salle, tables et réservations.",

    "common.cap.orders.view": "Voir les commandes",
    "common.cap.orders.advance": "Faire avancer les commandes",
    "common.cap.kitchen.display": "Écran de cuisine",
    "common.cap.menu.view": "Voir le menu",
    "common.cap.menu.edit": "Modifier le menu",
    "common.cap.tables.view": "Voir les tables",
    "common.cap.tables.manage": "Gérer les tables",
    "common.cap.reservations.view": "Voir les réservations",
    "common.cap.reservations.decide": "Décider des réservations",
    "common.cap.promotions.manage": "Gérer les promotions",
    "common.cap.customers.view": "Voir les clients",
    "common.cap.reviews.reply": "Répondre aux avis",
    "common.cap.reports.view": "Voir les rapports",
    "common.cap.staff.manage": "Gérer le personnel",
    "common.cap.billing.manage": "Gérer la facturation",
    "common.cap.profile.edit": "Modifier le profil",
    "common.cap.settings.manage": "Gérer les paramètres",

    /* Branch switcher and subscription banner — chrome, so these appear on
       every single manager screen and were the loudest untranslated strings. */
    "common.branch.switch": "Changer d'établissement",
    "common.branch.switchHint": "Votre rôle peut différer d'une succursale à l'autre.",
    "common.branch.primary": "Principal",

    "common.subState.active": "Actif",
    "common.subState.grace": "Période de grâce",
    "common.subState.locked": "Verrouillé",
    "common.subState.free_mode": "Gratuit",

    "common.sub.expiredTitle": "Votre abonnement a expiré",
    "common.sub.expiredBodyDate": "Renouvelez avant la fin de la période de grâce. Échéance : {date}.",
    "common.sub.expiredBody": "Renouvelez pour conserver votre accès complet.",
    "common.sub.lockedTitle": "Compte verrouillé",
    "common.sub.lockedBody":
      "Vos limites sont revenues au niveau Starter. Réglez votre facture pour rétablir l'accès complet.",
    "common.sub.freeTitle": "Mode gratuit actif",
    "common.sub.freeBodyDate": "Toutes les fonctionnalités payantes sont offertes jusqu'au {date}.",
    "common.sub.freeBody": "Toutes les fonctionnalités payantes sont actuellement offertes.",
    "common.sub.manage": "Gérer l'abonnement",
    "common.hide": "Masquer",

    /* The image picker — shared by the admin branding screen, the restaurant
       profile and the dish editor. */
    "common.img.notSaved": "Non enregistré",
    "common.img.choose": "Choisir un fichier",
    "common.img.replace": "Remplacer",
    "common.img.undo": "Annuler le choix",
    "common.img.remove": "Retirer",
    "common.img.working": "Optimisation…",
    "common.img.tooLarge": "Cette image fait {size} Mo et n'a pas pu être réduite sous {limit} Mo.",
    "common.img.shrunk": "Image réduite à {size} Mo pour l'envoi.",

    /*
     * Quoting someone's words — an order note, a review being replied to.
     *
     * The marks live IN the string, not around the interpolation in JSX.
     * `<span>« {text} »</span>` gives the span three DOM children (bare text,
     * the value, bare text), and that adjacency is precisely what browser
     * auto-translate rewrites out from under React before the next
     * insertBefore throws NotFoundError. One placeholder, one text node.
     *
     * It also stops French guillemets being shown to English readers.
     */
    "common.quoted": "« {text} »",
    "common.accountNav": "Navigation du compte",
  },
  en: {
    "common.search": "Search…",
    "common.clear": "Clear",
    "common.create": "Create",
    "common.back": "Back",
    "common.actions": "Actions",
    "common.none": "None",
    "common.never": "Never",
    "common.optional": "Optional",
    "common.required": "Required",
    "common.loading": "Loading…",
    "common.noResults": "No results",
    "common.noResultsBody": "Adjust your filters.",
    "common.retry": "Try again",
    "common.of": "of",
    "common.total": "Total",

    "common.countDishes": "{count} dish(es)",
    "common.countOrders": "{count} order(s)",

    "common.role.owner": "Owner",
    "common.role.manager": "Manager",
    "common.role.kitchen": "Kitchen",
    "common.role.cashier": "Cashier",
    "common.role.waiter": "Waiter",

    "common.roleDesc.owner": "Full access, including billing and staff.",
    "common.roleDesc.manager": "Runs the service, the menu and the team. Not billing.",
    "common.roleDesc.kitchen": "Kitchen display and moving orders along.",
    "common.roleDesc.cashier": "Orders, taking payment and customers.",
    "common.roleDesc.waiter": "Taking orders in the dining room, tables and bookings.",

    "common.cap.orders.view": "View orders",
    "common.cap.orders.advance": "Move orders along",
    "common.cap.kitchen.display": "Kitchen display",
    "common.cap.menu.view": "View the menu",
    "common.cap.menu.edit": "Edit the menu",
    "common.cap.tables.view": "View tables",
    "common.cap.tables.manage": "Manage tables",
    "common.cap.reservations.view": "View bookings",
    "common.cap.reservations.decide": "Accept or decline bookings",
    "common.cap.promotions.manage": "Manage promotions",
    "common.cap.customers.view": "View customers",
    "common.cap.reviews.reply": "Reply to reviews",
    "common.cap.reports.view": "View reports",
    "common.cap.staff.manage": "Manage staff",
    "common.cap.billing.manage": "Manage billing",
    "common.cap.profile.edit": "Edit the profile",
    "common.cap.settings.manage": "Manage settings",

    "common.branch.switch": "Switch location",
    "common.branch.switchHint": "Your role can differ from one location to the next.",
    "common.branch.primary": "Main",

    "common.subState.active": "Active",
    "common.subState.grace": "Grace period",
    "common.subState.locked": "Locked",
    "common.subState.free_mode": "Free",

    "common.sub.expiredTitle": "Your subscription has expired",
    "common.sub.expiredBodyDate": "Renew before the grace period ends. Due: {date}.",
    "common.sub.expiredBody": "Renew to keep your full access.",
    "common.sub.lockedTitle": "Account locked",
    "common.sub.lockedBody": "Your limits are back to Starter level. Settle your invoice to restore full access.",
    "common.sub.freeTitle": "Free mode is on",
    "common.sub.freeBodyDate": "All paid features are free until {date}.",
    "common.sub.freeBody": "All paid features are currently free.",
    "common.sub.manage": "Manage subscription",
    "common.hide": "Hide",

    "common.img.notSaved": "Not saved yet",
    "common.img.choose": "Choose file",
    "common.img.replace": "Replace",
    "common.img.undo": "Undo",
    "common.img.remove": "Remove",
    "common.img.working": "Optimising…",
    "common.img.tooLarge": "That image is {size} MB and could not be brought under {limit} MB.",
    "common.img.shrunk": "Image reduced to {size} MB for upload.",

    "common.quoted": "“{text}”",
    "common.accountNav": "Account navigation",
  },
});
