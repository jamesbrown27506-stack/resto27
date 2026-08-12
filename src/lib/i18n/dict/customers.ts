import { defineDict } from "../define";

/**
 * The customer list (/m/customers).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `mcu.` so two modules can never collide.
 */
export const customersDict = defineDict({
  fr: {
    "mcu.title": "Clients",
    "mcu.subtitle": "Qui commande chez vous, à quelle fréquence et pour quel montant.",

    /* ── Chiffres d'en-tête ──────────────────────────────────────────── */
    "mcu.stat.customers": "Clients",
    "mcu.stat.orders": "Commandes cumulées",
    "mcu.stat.revenue": "Chiffre d'affaires client",
    "mcu.stat.revenueHint": "Livraison et commandes annulées exclues.",

    /* ── Recherche et tri ────────────────────────────────────────────── */
    "mcu.search": "Nom, email ou téléphone…",
    "mcu.sort": "Trier",
    "mcu.sort.spent": "Dépense totale",
    "mcu.sort.orders": "Nombre de commandes",
    "mcu.sort.recent": "Commande la plus récente",
    "mcu.sort.name": "Nom (A–Z)",
    "mcu.showing": "{shown} client(s) sur {total}",

    /* ── Colonnes ────────────────────────────────────────────────────── */
    "mcu.col.customer": "Client",
    "mcu.col.orders": "Commandes",
    "mcu.col.spent": "Total dépensé",
    "mcu.col.average": "Panier moyen",
    "mcu.col.last": "Dernière commande",

    /* ── Inscrit ou invité ───────────────────────────────────────────── */
    "mcu.registered": "Inscrit",
    "mcu.registeredHint": "A un compte RestoLink — ses commandes sont regroupées automatiquement.",
    "mcu.guest": "Invité",
    "mcu.guestHint": "A commandé sans compte. Ses commandes sont regroupées par numéro de téléphone.",

    /* ── Détails d'une ligne ─────────────────────────────────────────── */
    "mcu.unnamed": "Client sans nom",
    "mcu.call": "Appeler {name}",
    "mcu.firstOrder": "Première commande : {date}",

    /* ── États vides ─────────────────────────────────────────────────── */
    "mcu.empty.title": "Aucun client pour l'instant",
    "mcu.empty.body":
      "Vos clients apparaissent ici après leur première commande — ceux qui ont un compte comme ceux qui commandent en invité.",
    "mcu.noResults.title": "Aucun client ne correspond",
    "mcu.noResults.body": "Essayez un autre nom, un autre email ou un autre numéro.",
  },
  en: {
    "mcu.title": "Customers",
    "mcu.subtitle": "Who orders from you, how often, and for how much.",

    /* ── Headline figures ────────────────────────────────────────────── */
    "mcu.stat.customers": "Customers",
    "mcu.stat.orders": "Orders in total",
    "mcu.stat.revenue": "Customer revenue",
    "mcu.stat.revenueHint": "Delivery fees and cancelled orders excluded.",

    /* ── Search and sort ─────────────────────────────────────────────── */
    "mcu.search": "Name, email or phone…",
    "mcu.sort": "Sort",
    "mcu.sort.spent": "Total spent",
    "mcu.sort.orders": "Number of orders",
    "mcu.sort.recent": "Most recent order",
    "mcu.sort.name": "Name (A–Z)",
    "mcu.showing": "{shown} of {total} customers",

    /* ── Columns ─────────────────────────────────────────────────────── */
    "mcu.col.customer": "Customer",
    "mcu.col.orders": "Orders",
    "mcu.col.spent": "Total spent",
    "mcu.col.average": "Average basket",
    "mcu.col.last": "Last order",

    /* ── Registered or guest ─────────────────────────────────────────── */
    "mcu.registered": "Registered",
    "mcu.registeredHint": "Has a RestoLink account — their orders are grouped automatically.",
    "mcu.guest": "Guest",
    "mcu.guestHint": "Ordered without an account. Their orders are grouped by phone number.",

    /* ── Row details ─────────────────────────────────────────────────── */
    "mcu.unnamed": "Unnamed customer",
    "mcu.call": "Call {name}",
    "mcu.firstOrder": "First order: {date}",

    /* ── Empty states ────────────────────────────────────────────────── */
    "mcu.empty.title": "No customers yet",
    "mcu.empty.body":
      "Your customers appear here after their first order — those with an account and those who check out as guests alike.",
    "mcu.noResults.title": "No customer matches",
    "mcu.noResults.body": "Try another name, another email or another number.",
  },
});
