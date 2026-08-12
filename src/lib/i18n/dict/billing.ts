import { defineDict } from "../define";

/**
 * Subscription, invoices and payment (/m/billing, /m/billing/invoices/[id],
 * /m/billing/pay/[id]).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `mbl.` so two modules can never collide.
 *
 * Two families deserve a note:
 *
 *  · `mbl.status.*` is keyed on the RAW `invoices.status` column, plus one
 *    derived `overdue`. Mapping the database value to a key means a status
 *    added in a migration shows up as a missing key in review rather than as
 *    a French word in an English page.
 *
 *  · `mbl.feat.*` describes what a plan includes. The NUMBERS are interpolated
 *    from the plan row, never written into the sentence — the limits and the
 *    prices are the admin's to change without a deploy.
 */
export const billingDict = defineDict({
  fr: {
    "mbl.title": "Abonnement",
    "mbl.subtitle": "Votre formule, vos factures et vos paiements.",
    "mbl.backToBilling": "Retour à l'abonnement",

    /* ── Formule en cours ─────────────────────────────────────────────── */
    "mbl.current.label": "Formule actuelle",
    "mbl.current.free": "Gratuit, sans date d'expiration.",
    "mbl.current.price": "{amount} par mois",
    "mbl.current.commission": "{rate} de commission par commande livrée",
    "mbl.current.due": "Échéance : {date}",
    "mbl.current.noExpiry": "N'expire pas",
    "mbl.current.unknown": "Formule inconnue",

    /* ── Essai gratuit ────────────────────────────────────────────────── */
    "mbl.trial.left": "Essai gratuit — {days} jour(s) restant(s).",
    "mbl.trial.body":
      "Aucun paiement n'est prélevé automatiquement. Le {date}, vous repassez simplement aux limites Starter si vous n'avez rien réglé.",
    "mbl.trial.payNow": "Régler maintenant",
    "mbl.trial.badge": "{days} jours d'essai gratuit",
    "mbl.trial.start": "Essayer {days} jours gratuitement",
    "mbl.trial.used": "Essai gratuit déjà utilisé",
    "mbl.trial.started": "Essai gratuit démarré. Aucun paiement n'est requis.",

    /* ── Factures en attente ──────────────────────────────────────────── */
    "mbl.unpaid.summary": "{count} facture(s) à régler — {amount}",
    "mbl.unpaid.pay": "Payer maintenant",

    /* ── Utilisation ──────────────────────────────────────────────────── */
    "mbl.usage.title": "Votre utilisation",
    "mbl.usage.subtitle": "Les limites de votre formule actuelle.",
    "mbl.usage.menuItems": "Plats au menu",
    "mbl.usage.tables": "Tables",
    "mbl.usage.promotions": "Promotions actives",

    /* ── Comparatif des formules ──────────────────────────────────────── */
    "mbl.plans.title": "Changer de formule",
    "mbl.plans.subtitle": "Sans engagement. Les tarifs sont mensuels, par établissement.",
    "mbl.plans.none": "Aucune formule disponible",
    "mbl.plans.noneBody":
      "Aucune formule n'est proposée pour le moment. Votre accès actuel n'est pas affecté.",
    /* `plan.mostChosen` et `plan.perMonth` existent déjà pour la page /pricing
       et disent exactement la même chose — ils sont réutilisés tels quels. */
    "mbl.plan.badgeCurrent": "Actuelle",
    "mbl.plan.free": "Gratuit",
    "mbl.plan.isCurrent": "Votre formule",
    "mbl.plan.choose": "Choisir cette formule",
    "mbl.plan.chooseFree": "Passer au gratuit",
    "mbl.plan.payDirect": "Payer directement",

    /* ──
       Ce que contient une formule.

       Le cas « illimité » a sa propre phrase plutôt qu'un mot injecté dans
       {count} : « Illimité plats au menu » n'est pas du français.
       ────────────────────────────────────────────────────────────────── */
    "mbl.feat.menuItems": "{count} plats au menu",
    "mbl.feat.menuItemsUnlimited": "Plats au menu illimités",
    "mbl.feat.tables": "{count} tables",
    "mbl.feat.tablesUnlimited": "Tables illimitées",
    "mbl.feat.promotions": "{count} promotion(s) active(s)",
    "mbl.feat.promotionsUnlimited": "Promotions actives illimitées",
    "mbl.feat.commission": "{rate} de commission par commande livrée",
    "mbl.feat.staff": "Gestion du personnel",
    "mbl.feat.analytics": "Rapports et analytique",

    /* ── Liste des factures ───────────────────────────────────────────── */
    "mbl.inv.title": "Factures",
    "mbl.inv.none": "Aucune facture",
    "mbl.inv.noneBody": "Vos factures apparaissent ici dès votre première formule payante.",
    "mbl.inv.col.number": "Facture",
    "mbl.inv.col.period": "Période",
    "mbl.inv.col.amount": "Montant",
    "mbl.inv.col.status": "Statut",
    "mbl.inv.period": "{from} → {to}",
    "mbl.inv.view": "Voir",
    "mbl.inv.pay": "Payer",
    "mbl.inv.paidOn": "Réglée le {date}",

    /* ── Statuts, à partir de la valeur brute en base ─────────────────── */
    "mbl.status.unpaid": "À payer",
    "mbl.status.paid": "Payée",
    "mbl.status.void": "Annulée",
    "mbl.status.overdue": "En retard",

    /* ── Confirmation de paiement ─────────────────────────────────────── */
    "mbl.pay.title": "Régler {plan}",
    "mbl.pay.body":
      "Votre facture de {amount} est prête. Votre formule devient active dès le règlement, pour 30 jours.",
    "mbl.pay.later": "Plus tard",
    "mbl.pay.open": "Ouvrir la page de paiement",

    /* ── Ce que le paiement fait vraiment ─────────────────────────────── */
    "mbl.sim.title": "Paiement simulé",
    "mbl.sim.body":
      "Aucune demande n'est envoyée sur votre téléphone et aucun argent ne change de main. Le paiement mobile n'est pas encore branché : ce bouton enregistre un paiement de test et active votre abonnement par le chemin définitif, celui qu'empruntera le paiement réel.",
    "mbl.sim.off.title": "Les paiements réels sont activés",
    "mbl.sim.off.body":
      "La simulation est donc désactivée, et aucun fournisseur de paiement mobile n'est encore branché ici. Contactez l'assistance pour régler cette facture.",

    /* ── Page de paiement ─────────────────────────────────────────────── */
    "mbl.payPage.title": "Régler la facture",
    "mbl.payPage.subtitle": "Paiement simulé — le paiement mobile n'est pas encore branché.",
    "mbl.payPage.amountDue": "Montant à régler",
    "mbl.payPage.invoiceLabel": "Facture",
    "mbl.payPage.planLabel": "Formule",
    "mbl.payPage.periodLabel": "Période",
    "mbl.payPage.cta": "Valider le paiement simulé",
    "mbl.payPage.done.title": "Facture réglée",
    "mbl.payPage.done.body": "Votre formule est active pour 30 jours.",
    "mbl.payPage.already.title": "Cette facture est déjà réglée",
    "mbl.payPage.already.body": "Il n'y a rien à payer. Aucun second prélèvement n'est possible.",
    "mbl.payPage.void.title": "Cette facture a été annulée",
    "mbl.payPage.void.body":
      "Elle ne peut plus être réglée. Choisissez une formule depuis la page d'abonnement pour en émettre une nouvelle.",

    /* ── Le document ──────────────────────────────────────────────────── */
    "mbl.doc.heading": "Facture",
    "mbl.doc.period": "Période du {from} au {to}",
    "mbl.doc.issuedOn": "Émise le {date}",
    "mbl.doc.billedTo": "Facturé à",
    "mbl.doc.caption": "Détail de la facture",
    "mbl.doc.description": "Description",
    "mbl.doc.amount": "Montant",
    "mbl.doc.line": "Abonnement {plan}",
    "mbl.doc.lineMeta": "{from} – {to} · {rate} de commission sur les commandes livrées",
    "mbl.doc.lineMetaNoRate": "{from} – {to}",
    "mbl.doc.paidOn": "Réglée le {date}.",
    "mbl.doc.payCta": "Payer cette facture",
    "mbl.doc.footnote":
      "Les commissions sur les commandes livrées font l'objet d'un relevé distinct. Les frais de livraison en sont exclus.",

    /* ── Retours d'action ─────────────────────────────────────────────── */
    "mbl.toast.paid": "Facture réglée. Votre abonnement est actif pour 30 jours.",
    "mbl.toast.planChanged": "Formule mise à jour.",
    "mbl.toast.invoiceReady": "Facture créée. Il ne reste qu'à la régler.",
  },
  en: {
    "mbl.title": "Subscription",
    "mbl.subtitle": "Your plan, your invoices and your payments.",
    "mbl.backToBilling": "Back to subscription",

    /* ── Current plan ─────────────────────────────────────────────────── */
    "mbl.current.label": "Current plan",
    "mbl.current.free": "Free, with no expiry date.",
    "mbl.current.price": "{amount} per month",
    "mbl.current.commission": "{rate} commission on each delivered order",
    "mbl.current.due": "Due: {date}",
    "mbl.current.noExpiry": "Never expires",
    "mbl.current.unknown": "Unknown plan",

    /* ── Free trial ───────────────────────────────────────────────────── */
    "mbl.trial.left": "Free trial — {days} day(s) left.",
    "mbl.trial.body":
      "Nothing is charged automatically. On {date} you simply go back to Starter limits if you have not paid.",
    "mbl.trial.payNow": "Pay now",
    "mbl.trial.badge": "{days}-day free trial",
    "mbl.trial.start": "Try {days} days free",
    "mbl.trial.used": "Free trial already used",
    "mbl.trial.started": "Free trial started. No payment is required.",

    /* ── Outstanding invoices ─────────────────────────────────────────── */
    "mbl.unpaid.summary": "{count} invoice(s) to settle — {amount}",
    "mbl.unpaid.pay": "Pay now",

    /* ── Usage ────────────────────────────────────────────────────────── */
    "mbl.usage.title": "Your usage",
    "mbl.usage.subtitle": "The limits of your current plan.",
    "mbl.usage.menuItems": "Menu items",
    "mbl.usage.tables": "Tables",
    "mbl.usage.promotions": "Active promotions",

    /* ── Plan comparison ──────────────────────────────────────────────── */
    "mbl.plans.title": "Change plan",
    "mbl.plans.subtitle": "No commitment. Prices are monthly, per location.",
    "mbl.plans.none": "No plans available",
    "mbl.plans.noneBody": "No plan is on offer right now. Your current access is unaffected.",
    "mbl.plan.badgeCurrent": "Current",
    "mbl.plan.free": "Free",
    "mbl.plan.isCurrent": "Your plan",
    "mbl.plan.choose": "Choose this plan",
    "mbl.plan.chooseFree": "Switch to free",
    "mbl.plan.payDirect": "Pay for it instead",

    /* ── What a plan includes ─────────────────────────────────────────── */
    "mbl.feat.menuItems": "{count} menu items",
    "mbl.feat.menuItemsUnlimited": "Unlimited menu items",
    "mbl.feat.tables": "{count} tables",
    "mbl.feat.tablesUnlimited": "Unlimited tables",
    "mbl.feat.promotions": "{count} active promotion(s)",
    "mbl.feat.promotionsUnlimited": "Unlimited active promotions",
    "mbl.feat.commission": "{rate} commission on each delivered order",
    "mbl.feat.staff": "Staff management",
    "mbl.feat.analytics": "Reports and analytics",

    /* ── Invoice list ─────────────────────────────────────────────────── */
    "mbl.inv.title": "Invoices",
    "mbl.inv.none": "No invoices",
    "mbl.inv.noneBody": "Your invoices appear here from your first paid plan onwards.",
    "mbl.inv.col.number": "Invoice",
    "mbl.inv.col.period": "Period",
    "mbl.inv.col.amount": "Amount",
    "mbl.inv.col.status": "Status",
    "mbl.inv.period": "{from} → {to}",
    "mbl.inv.view": "View",
    "mbl.inv.pay": "Pay",
    "mbl.inv.paidOn": "Paid on {date}",

    /* ── Statuses, from the raw database value ────────────────────────── */
    "mbl.status.unpaid": "Unpaid",
    "mbl.status.paid": "Paid",
    "mbl.status.void": "Cancelled",
    "mbl.status.overdue": "Overdue",

    /* ── Payment confirmation ─────────────────────────────────────────── */
    "mbl.pay.title": "Pay for {plan}",
    "mbl.pay.body":
      "Your invoice for {amount} is ready. Your plan becomes active the moment it is settled, for 30 days.",
    "mbl.pay.later": "Later",
    "mbl.pay.open": "Open the payment page",

    /* ── What paying actually does ────────────────────────────────────── */
    "mbl.sim.title": "Simulated payment",
    "mbl.sim.body":
      "No request is sent to your phone and no money changes hands. Mobile payment is not connected yet: this button records a test payment and activates your subscription through the final code path — the one the real payment will use.",
    "mbl.sim.off.title": "Real payments are switched on",
    "mbl.sim.off.body":
      "Simulation is therefore disabled, and no mobile payment provider is connected here yet. Contact support to settle this invoice.",

    /* ── Payment page ─────────────────────────────────────────────────── */
    "mbl.payPage.title": "Settle the invoice",
    "mbl.payPage.subtitle": "Simulated payment — mobile payment is not connected yet.",
    "mbl.payPage.amountDue": "Amount due",
    "mbl.payPage.invoiceLabel": "Invoice",
    "mbl.payPage.planLabel": "Plan",
    "mbl.payPage.periodLabel": "Period",
    "mbl.payPage.cta": "Confirm the simulated payment",
    "mbl.payPage.done.title": "Invoice settled",
    "mbl.payPage.done.body": "Your plan is active for 30 days.",
    "mbl.payPage.already.title": "This invoice is already settled",
    "mbl.payPage.already.body": "There is nothing to pay. A second charge is not possible.",
    "mbl.payPage.void.title": "This invoice was cancelled",
    "mbl.payPage.void.body":
      "It can no longer be settled. Choose a plan from the subscription page to raise a new one.",

    /* ── The document ─────────────────────────────────────────────────── */
    "mbl.doc.heading": "Invoice",
    "mbl.doc.period": "Period from {from} to {to}",
    "mbl.doc.issuedOn": "Issued on {date}",
    "mbl.doc.billedTo": "Billed to",
    "mbl.doc.caption": "Invoice breakdown",
    "mbl.doc.description": "Description",
    "mbl.doc.amount": "Amount",
    "mbl.doc.line": "{plan} subscription",
    "mbl.doc.lineMeta": "{from} – {to} · {rate} commission on delivered orders",
    "mbl.doc.lineMetaNoRate": "{from} – {to}",
    "mbl.doc.paidOn": "Settled on {date}.",
    "mbl.doc.payCta": "Pay this invoice",
    "mbl.doc.footnote":
      "Commission on delivered orders is billed on a separate statement. Delivery fees are excluded from it.",

    /* ── Action feedback ──────────────────────────────────────────────── */
    "mbl.toast.paid": "Invoice settled. Your subscription is active for 30 days.",
    "mbl.toast.planChanged": "Plan updated.",
    "mbl.toast.invoiceReady": "Invoice created. All that is left is to settle it.",
  },
});
