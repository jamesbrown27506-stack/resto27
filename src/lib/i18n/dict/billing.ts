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

    /* ── Mode gratuit (plateforme gratuite pour tous) ────────────────── */
    "mbl.freeMode.title": "Mode gratuit actif",
    "mbl.freeMode.bodyDate": "Toutes les formules sont offertes gratuitement jusqu'au {date}.",
    "mbl.freeMode.body": "Toutes les formules sont actuellement offertes gratuitement.",

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

    /* ── Paiement par Mobile Money ────────────────────────────────────── */
    "mbl.handled.title": "Paiement par Mobile Money",
    "mbl.handled.body":
      "Vous serez guidé sur la page de paiement : saisissez votre numéro MTN MoMo ou Orange Money, puis validez la demande sur votre téléphone. Votre formule est activée dès la confirmation de l'opérateur.",
    "mbl.handled.cta": "Ouvrir la page de paiement",

    /* ── Page de paiement ─────────────────────────────────────────────── */
    "mbl.payPage.title": "Régler la facture",
    "mbl.payPage.subtitle": "Payez par MTN Mobile Money ou Orange Money.",
    "mbl.payPage.amountDue": "Montant à régler",
    "mbl.payPage.invoiceLabel": "Facture",
    "mbl.payPage.planLabel": "Formule",
    "mbl.payPage.periodLabel": "Période",
    "mbl.payPage.already.title": "Cette facture est déjà réglée",
    "mbl.payPage.already.body": "Il n'y a rien à payer. Aucun second prélèvement n'est possible.",
    "mbl.payPage.void.title": "Cette facture a été annulée",
    "mbl.payPage.void.body":
      "Elle ne peut plus être réglée. Choisissez une formule depuis la page d'abonnement pour en émettre une nouvelle.",

    /* ── Règlement Mobile Money ───────────────────────────────────────── */
    "mbl.checkout.phoneLabel": "Numéro Mobile Money",
    "mbl.checkout.phoneHint": "MTN MoMo ou Orange Money — 9 chiffres, ex. 6XXXXXXXX.",
    "mbl.checkout.phonePlaceholder": "6XXXXXXXX",
    "mbl.checkout.phoneRequired": "Saisissez votre numéro Mobile Money.",
    "mbl.checkout.pay": "Payer {amount}",
    "mbl.checkout.sandboxNote": "Mode de démonstration — aucun argent n'est débité.",
    "mbl.checkout.failedGeneric": "Le paiement a échoué. Réessayez.",
    "mbl.checkout.pending.title": "Confirmez sur votre téléphone",
    "mbl.checkout.pending.body":
      "Une demande de {amount} a été envoyée au numéro {phone}. Ouvrez votre appli Mobile Money et validez.",
    "mbl.checkout.pending.hint":
      "La page suit automatiquement la confirmation. Vous pouvez la fermer : le paiement sera pris en compte de toute façon.",
    "mbl.checkout.pending.amount": "Montant",
    "mbl.checkout.pending.reference": "Facture",
    "mbl.checkout.pending.phone": "Téléphone",
    "mbl.checkout.pending.gateway": "Passerelle sécurisée",
    "mbl.checkout.pending.stillTracking":
      "La confirmation prend plus de temps que prévu. Le paiement n'a pas échoué : il reste suivi en arrière-plan.",
    "mbl.checkout.pending.checkAgain": "Vérifier à nouveau",
    "mbl.checkout.done.title": "Paiement confirmé",
    "mbl.checkout.done.body":
      "Votre règlement de {amount} a été appliqué. Votre formule est active pour 30 jours.",
    "mbl.checkout.failed.title": "Paiement non confirmé",
    "mbl.checkout.failed.body":
      "La demande n'a pas été confirmée par l'opérateur. Si vous avez validé le paiement sur votre téléphone, il sera pris en compte automatiquement.",
    "mbl.checkout.retry": "Réessayer",

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

    /* ── Free mode (platform free for everyone) ───────────────────────── */
    "mbl.freeMode.title": "Free mode is on",
    "mbl.freeMode.bodyDate": "Every plan is free until {date}.",
    "mbl.freeMode.body": "Every plan is currently free.",

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

    /* ── Payment by Mobile Money ───────────────────────────────────────── */
    "mbl.handled.title": "Payment by Mobile Money",
    "mbl.handled.body":
      "You will be guided on the payment page: enter your MTN MoMo or Orange Money number, then approve the request on your phone. Your plan is activated the moment the operator confirms.",
    "mbl.handled.cta": "Open the payment page",

    /* ── Payment page ─────────────────────────────────────────────────── */
    "mbl.payPage.title": "Settle the invoice",
    "mbl.payPage.subtitle": "Pay by MTN Mobile Money or Orange Money.",
    "mbl.payPage.amountDue": "Amount due",
    "mbl.payPage.invoiceLabel": "Invoice",
    "mbl.payPage.planLabel": "Plan",
    "mbl.payPage.periodLabel": "Period",
    "mbl.payPage.already.title": "This invoice is already settled",
    "mbl.payPage.already.body": "There is nothing to pay. A second charge is not possible.",
    "mbl.payPage.void.title": "This invoice was cancelled",
    "mbl.payPage.void.body":
      "It can no longer be settled. Choose a plan from the subscription page to raise a new one.",

    /* ── Mobile Money settlement ──────────────────────────────────────── */
    "mbl.checkout.phoneLabel": "Mobile Money number",
    "mbl.checkout.phoneHint": "MTN MoMo or Orange Money — 9 digits, e.g. 6XXXXXXXX.",
    "mbl.checkout.phonePlaceholder": "6XXXXXXXX",
    "mbl.checkout.phoneRequired": "Enter your Mobile Money number.",
    "mbl.checkout.pay": "Pay {amount}",
    "mbl.checkout.sandboxNote": "Demonstration mode — no money is charged.",
    "mbl.checkout.failedGeneric": "The payment failed. Please try again.",
    "mbl.checkout.pending.title": "Confirm on your phone",
    "mbl.checkout.pending.body":
      "A request for {amount} was sent to {phone}. Open your Mobile Money app and approve it.",
    "mbl.checkout.pending.hint":
      "This page follows the confirmation automatically. You may close it — the payment is picked up either way.",
    "mbl.checkout.pending.amount": "Amount",
    "mbl.checkout.pending.reference": "Invoice",
    "mbl.checkout.pending.phone": "Phone",
    "mbl.checkout.pending.gateway": "Secure gateway",
    "mbl.checkout.pending.stillTracking":
      "Confirmation is taking longer than expected. The payment has not failed: it is still tracked in the background.",
    "mbl.checkout.pending.checkAgain": "Check again",
    "mbl.checkout.done.title": "Payment confirmed",
    "mbl.checkout.done.body":
      "Your payment of {amount} has been applied. Your plan is active for 30 days.",
    "mbl.checkout.failed.title": "Payment not confirmed",
    "mbl.checkout.failed.body":
      "The request was not confirmed by the operator. If you approved the payment on your phone, it will be applied automatically.",
    "mbl.checkout.retry": "Try again",

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
    "mbl.toast.planChanged": "Plan updated.",
    "mbl.toast.invoiceReady": "Invoice created. All that is left is to settle it.",
  },
});
