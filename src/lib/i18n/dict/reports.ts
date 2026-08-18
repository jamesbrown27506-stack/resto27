import { defineDict } from "../define";

/**
 * Sales analytics (/m/reports).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `mrp.` so two modules can never collide.
 */
export const reportsDict = defineDict({
  fr: {
    "mrp.title": "Rapports",
    "mrp.subtitle": "Ce qui se vend, quand, et à qui.",

    /* ── Période ─────────────────────────────────────────────────────── */
    "mrp.range.legend": "Période analysée",
    "mrp.range.7d": "7 jours",
    "mrp.range.30d": "30 jours",
    "mrp.range.90d": "90 jours",
    "mrp.range.12m": "12 mois",
    "mrp.period": "Du {from} au {to}",
    "mrp.basis": "Chiffre d'affaires hors frais de livraison, commandes annulées exclues.",

    /* ── Chiffres d'en-tête ──────────────────────────────────────────── */
    "mrp.stat.revenue": "Chiffre d'affaires",
    "mrp.stat.revenueHint": "Hors frais de livraison.",
    "mrp.stat.orders": "Commandes",
    "mrp.stat.ordersHint": "{count} client(s) sur la période.",
    "mrp.stat.cancelled": "{count} annulée(s), non comptée(s).",
    "mrp.stat.basket": "Panier moyen",
    "mrp.stat.basketHint": "Chiffre d'affaires divisé par le nombre de commandes.",
    "mrp.stat.bestDay": "Meilleur jour",

    /* ── Graphiques ──────────────────────────────────────────────────── */
    "mrp.chart.sales": "Ventes dans le temps",
    "mrp.chart.sales.day": "Chiffre d'affaires par jour.",
    "mrp.chart.sales.week": "Chiffre d'affaires par semaine.",
    "mrp.chart.sales.month": "Chiffre d'affaires par mois.",
    "mrp.chart.revenueLabel": "Recette",
    "mrp.chart.weekday": "Ventes par jour de la semaine",
    "mrp.chart.weekdayDesc": "Toutes les semaines de la période additionnées.",
    "mrp.chart.hours": "Heures de pointe",
    "mrp.chart.hoursDesc": "Commandes par tranche horaire, heure de Douala.",
    "mrp.chart.ordersLabel": "Commandes",
    "mrp.chart.mix": "Répartition des commandes",
    "mrp.chart.mixDesc": "Part du chiffre d'affaires par canal.",
    "mrp.chart.dishes": "Plats les plus commandés",
    "mrp.chart.dishesDesc": "Les dix premiers, par quantité vendue.",
    "mrp.chart.empty": "Aucune donnée sur cette période.",

    /* ── Plats ───────────────────────────────────────────────────────── */
    "mrp.dish.sold": "{count} vendu(s)",
    "mrp.dish.orders": "dans {count} commande(s)",

    /* ── État vide ───────────────────────────────────────────────────── */
    "mrp.empty.title": "Pas encore assez de données",
    "mrp.empty.body":
      "Les rapports se construisent à partir de vos commandes. Dès la première commande encaissée, les ventes, les heures de pointe et les plats vedettes apparaissent ici.",
    "mrp.empty.hint": "Essayez une période plus longue si vous avez déjà vendu.",
  },
  en: {
    "mrp.title": "Reports",
    "mrp.subtitle": "What sells, when, and to whom.",

    /* ── Period ──────────────────────────────────────────────────────── */
    "mrp.range.legend": "Period covered",
    "mrp.range.7d": "7 days",
    "mrp.range.30d": "30 days",
    "mrp.range.90d": "90 days",
    "mrp.range.12m": "12 months",
    "mrp.period": "{from} to {to}",
    "mrp.basis": "Revenue excludes delivery fees; cancelled orders are left out.",

    /* ── Headline figures ────────────────────────────────────────────── */
    "mrp.stat.revenue": "Revenue",
    "mrp.stat.revenueHint": "Delivery fees excluded.",
    "mrp.stat.orders": "Orders",
    "mrp.stat.ordersHint": "{count} customer(s) over the period.",
    "mrp.stat.cancelled": "{count} cancelled, not counted.",
    "mrp.stat.basket": "Average basket",
    "mrp.stat.basketHint": "Revenue divided by the number of orders.",
    "mrp.stat.bestDay": "Best day",

    /* ── Charts ──────────────────────────────────────────────────────── */
    "mrp.chart.sales": "Sales over time",
    "mrp.chart.sales.day": "Revenue per day.",
    "mrp.chart.sales.week": "Revenue per week.",
    "mrp.chart.sales.month": "Revenue per month.",
    "mrp.chart.revenueLabel": "Revenue",
    "mrp.chart.weekday": "Sales by day of the week",
    "mrp.chart.weekdayDesc": "Every week in the period, added together.",
    "mrp.chart.hours": "Peak hours",
    "mrp.chart.hoursDesc": "Orders per hour, Douala time.",
    "mrp.chart.ordersLabel": "Orders",
    "mrp.chart.mix": "Order mix",
    "mrp.chart.mixDesc": "Share of revenue by channel.",
    "mrp.chart.dishes": "Best-selling dishes",
    "mrp.chart.dishesDesc": "Top ten, by quantity sold.",
    "mrp.chart.empty": "No data for this period.",

    /* ── Dishes ──────────────────────────────────────────────────────── */
    "mrp.dish.sold": "{count} sold",
    "mrp.dish.orders": "in {count} order(s)",

    /* ── Empty state ─────────────────────────────────────────────────── */
    "mrp.empty.title": "Not enough data yet",
    "mrp.empty.body":
      "Reports are built from your orders. As soon as the first one is taken, sales, peak hours and best sellers appear here.",
    "mrp.empty.hint": "Try a longer period if you have already been selling.",
  },
});
