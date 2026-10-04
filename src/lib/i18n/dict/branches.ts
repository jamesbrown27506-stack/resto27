import { defineDict } from "../define";

/**
 * Branches (0072) — the owner's screen, the paused-branch banner, the
 * branch's billing notice and the invoice lines for extra branches.
 *
 * Prefix `mbr.`. "Établissement" is a location, the main restaurant
 * included; "succursale" is any location other than the main — the copy
 * keeps the two apart because the plan counts the first and bills the second.
 */
export const branchesDict = defineDict({
  fr: {
    "mbr.title": "Succursales",
    "mbr.subtitle": "Ouvrez et gérez les autres adresses de votre restaurant.",

    "mbr.plan.title": "Votre formule : {plan}",
    "mbr.plan.included": "{count} établissements inclus : le principal et {branches} succursale(s), pour un seul prix.",
    "mbr.plan.mainOnly": "Seul l'établissement principal est inclus.",
    "mbr.plan.extraPrice": "Succursale supplémentaire : {price} par mois, sur la même facture.",
    "mbr.plan.noExtra": "Pas de succursale au-delà de celles incluses.",
    "mbr.plan.usage": "{open} succursale(s) ouverte(s) · {covered} en service",
    "mbr.plan.paidExtra": "{count} supplémentaire(s) payée(s) pour cette période",

    "mbr.upsell.title": "Les succursales commencent avec Professional",
    "mbr.upsell.body":
      "Starter couvre un seul établissement. Avec Professional, chaque succursale est facturée à part ; Enterprise en inclut plusieurs pour un seul prix.",
    "mbr.upsell.pausedCount": "{count} succursale(s) en pause tant que votre formule ne les couvre pas.",
    "mbr.upsell.cta": "Voir les formules",

    "mbr.lapsed": "Votre abonnement a expiré : vos succursales sont en pause jusqu'au paiement.",
    "mbr.lapsedCta": "Régler l'abonnement",

    "mbr.unpaid.body": "{count} succursale(s) en pause en attendant le paiement des succursales supplémentaires.",
    "mbr.unpaid.bodyAmount": "{count} succursale(s) en pause jusqu'au paiement de {amount}.",
    "mbr.unpaid.pay": "Payer pour les ouvrir",
    "mbr.unpaid.payAmount": "Payer {amount}",

    "mbr.list.title": "Vos établissements",
    "mbr.list.main": "Établissement principal — porte l'abonnement",
    "mbr.list.empty": "Aucune succursale pour l'instant.",

    "mbr.status.active": "En service",
    "mbr.status.paused": "En pause",
    "mbr.status.closed": "Fermée",
    "mbr.status.suspended": "Suspendue",
    "mbr.status.pending": "En attente",
    "mbr.status.pausedHint": "Non couverte par la formule pour l'instant.",

    "mbr.action.open": "Ouvrir",
    "mbr.action.current": "Vous y êtes",
    "mbr.action.close": "Fermer",
    "mbr.action.reopen": "Rouvrir",

    "mbr.close.title": "Fermer la succursale {label} ?",
    "mbr.close.body":
      "Elle disparaît du site et ne prend plus de commandes ni de réservations. Son menu, son équipe, son historique et son portefeuille sont conservés, et elle n'est plus facturée à partir de la prochaine facture. Ce qui a déjà été payé pour cette période n'est pas remboursé.",
    "mbr.close.confirm": "Fermer la succursale",

    "mbr.add.title": "Ouvrir une succursale",
    "mbr.add.body":
      "Une succursale a son propre menu, son équipe, ses tables, ses commandes et son portefeuille. Elle reprend le nom, le logo et la cuisine de {name}.",
    "mbr.add.label": "Nom de la succursale",
    "mbr.add.labelHint": "Souvent le quartier : « Akwa », « Bonapriso »…",
    "mbr.add.quartier": "Quartier",
    "mbr.add.address": "Adresse",
    "mbr.add.phone": "Téléphone (facultatif)",
    "mbr.add.phoneHint": "Par défaut, celui de l'établissement principal.",
    "mbr.add.costCovered": "Incluse dans votre formule : rien de plus à payer.",
    "mbr.add.costExtra":
      "Succursale supplémentaire : {monthly} par mois. Aujourd'hui : {now} pour les {days} jour(s) restant(s) de la période. Elle ouvre dès le paiement.",
    "mbr.add.costExtraFree": "Succursale supplémentaire : {monthly} par mois, offerte tant que la plateforme est gratuite.",
    "mbr.add.costExtraRenewal":
      "Succursale supplémentaire : {monthly} par mois, facturée avec votre renouvellement. Elle ouvre à son paiement.",
    "mbr.add.unavailable":
      "Votre formule n'inclut pas d'autre succursale. Passez à une formule supérieure pour en ouvrir plus.",
    "mbr.add.submit": "Ouvrir la succursale",
    "mbr.add.submitPay": "Ouvrir et payer",

    "mbr.rules":
      "Vos succursales fonctionnent avec la formule de l'établissement principal. Si la formule ne les couvre plus (passage à Starter, abonnement expiré, supplément non payé), elles se mettent en pause automatiquement — les plus récentes d'abord — et reprennent dès que c'est réglé. Rien n'est supprimé.",

    "mbr.note.opened": "La succursale {label} est ouverte. Ouvrez-la pour composer son menu.",
    "mbr.note.payToOpen": "Succursale créée. Elle ouvrira dès le paiement.",
    "mbr.note.onRenewal": "Succursale enregistrée : elle est facturée avec votre renouvellement et ouvrira à son paiement.",
    "mbr.note.closed": "La succursale {label} est fermée.",
    "mbr.note.reopened": "La succursale {label} est rouverte.",
    "mbr.note.allCovered": "Toutes vos succursales sont couvertes.",
    "mbr.note.menuCopied": "Menu copié : {count} plat(s).",
    "mbr.note.synced": "Menu mis à jour : {updated} plat(s) modifié(s), {added} ajouté(s).",
    "mbr.err.syncMigration": "La mise à jour du menu n'est pas encore activée sur la plateforme (migration 0074).",
    "mbr.err.syncFailed": "Impossible de mettre à jour le menu.",
    "mbr.action.syncMenu": "Mettre à jour le menu",
    "mbr.sync.title": "Mettre à jour le menu de {label} ?",
    "mbr.sync.body":
      "Les plats que {label} a en commun avec l'établissement principal reprennent ses prix, descriptions et photos ; les plats qui lui manquent sont ajoutés avec leurs options. Les plats propres à la succursale, ses disponibilités et ses stocks ne changent pas.",
    "mbr.ov.title": "Vue d'ensemble",
    "mbr.ov.subtitle": "Chaque établissement, en un coup d'œil. Revenus : les 7 derniers jours.",
    "mbr.ov.location": "Établissement",
    "mbr.ov.balance": "Solde",
    "mbr.ov.ordersToday": "Commandes aujourd'hui",
    "mbr.ov.orders7d": "Commandes (7 j)",
    "mbr.ov.income7d": "Revenus (7 j)",
    "mbr.ov.total": "Total",
    "mbr.note.menuNotCopied": "Le menu n'a pas pu être copié — réessayez depuis la page Succursales.",
    "mbr.err.menuNotEmpty": "Cette succursale a déjà des plats : la copie ne se fait que dans un menu vide.",
    "mbr.err.menuMigration": "La copie du menu n'est pas encore activée sur la plateforme (migration 0073).",
    "mbr.err.menuCopyFailed": "Impossible de copier le menu.",
    "mbr.action.copyMenu": "Copier le menu du principal",
    "mbr.list.dishes": "{count} plat(s) au menu",
    "mbr.add.copyMenu": "Copier le menu du principal ({count} plats)",
    "mbr.add.copyMenuHint":
      "Catégories, plats, prix, photos et options. Chaque succursale le modifie ensuite à sa guise ; les stocks partent de zéro.",

    "mbr.err.notOwner": "Seul le propriétaire du restaurant peut gérer les succursales.",
    "mbr.err.notFound": "Succursale introuvable.",
    "mbr.err.migration": "Les succursales ne sont pas encore activées sur la plateforme (migration 0072).",
    "mbr.err.tooMany": "Trop de succursales créées en peu de temps. Réessayez plus tard.",
    "mbr.err.mainInactive": "L'établissement principal doit être actif pour ouvrir une succursale.",
    "mbr.err.planNoBranches": "Votre formule ne permet pas de succursale. Passez à Professional ou Enterprise.",
    "mbr.err.subscriptionLapsed": "Votre abonnement a expiré. Réglez-le avant d'ouvrir une succursale.",
    "mbr.err.planBranchLimit":
      "Votre formule inclut {count} établissement(s) et ne permet pas d'en ajouter. Passez à une formule supérieure.",
    "mbr.err.label": "Donnez à la succursale un nom de 2 à 60 caractères.",
    "mbr.err.labelTaken": "Vous avez déjà un établissement avec ce nom.",
    "mbr.err.address": "Indiquez l'adresse de la succursale.",
    "mbr.err.phone": "Ce numéro n'est pas un numéro camerounais valide.",
    "mbr.err.quartier": "Indiquez le quartier de la succursale.",
    "mbr.err.createFailed": "Impossible de créer la succursale.",
    "mbr.err.saveFailed": "Impossible d'enregistrer le changement.",

    "mbr.banner.paused":
      "Cette succursale est en pause : la formule de l'établissement principal ne la couvre pas. Elle n'apparaît plus aux clients et ne prend ni commande ni réservation.",
    "mbr.banner.closed": "Cette succursale est fermée par le propriétaire. Elle n'apparaît plus aux clients.",
    "mbr.banner.manage": "Gérer les succursales",

    "mbr.billing.title": "Facturation gérée par l'établissement principal",
    "mbr.billing.body":
      "{label} fonctionne avec la formule {plan} de l'établissement principal. Les factures, les paiements et les changements de formule se font depuis l'établissement principal.",
    "mbr.billing.cta": "Ouvrir l'établissement principal",

    "mbr.billingCard.title": "Succursales",
    "mbr.billingCard.body": "{open} succursale(s) ouverte(s) · {included} incluse(s) dans {plan}",
    "mbr.billingCard.extra": "{price} par succursale supplémentaire et par mois",
    "mbr.billingCard.cta": "Gérer",

    "mbr.invoice.extraLine": "{count} succursale(s) supplémentaire(s)",
    "mbr.invoice.extraMeta": "{price} par succursale et par mois",
    "mbr.invoice.topUpLine": "Succursales supplémentaires — au prorata",
    "mbr.invoice.topUpMeta": "{from} – {to} · {count} succursale(s) supplémentaire(s) au total",
    "mbr.invoice.topUpName": "Succursales supplémentaires",

    "mbr.impact.title": "Ce changement touche vos succursales",
    "mbr.impact.paused":
      "Sur {plan}, {paused} de vos {count} succursale(s) seront mises en pause — les plus récentes. Elles disparaîtront pour les clients jusqu'à ce que votre formule les couvre de nouveau. Rien n'est supprimé.",
    "mbr.impact.pausedAll":
      "{plan} ne permet pas de succursale : vos {count} succursale(s) seront mises en pause. Rien n'est supprimé ; elles reprendront dès que vous reviendrez à une formule qui les couvre.",
    "mbr.impact.billed":
      "Sur {plan}, vos {count} succursale(s) : {included} incluse(s) et {extra} facturée(s) {price} chacune, soit {total} par mois au total.",
    "mbr.impact.trialPaused":
      "L'essai de {plan} ne facture rien : {extra} succursale(s) resteront en pause tant que leur supplément n'est pas payé (page Succursales).",
    "mbr.impact.freeNote": "Tant que la plateforme est gratuite, rien n'est facturé.",
    "mbr.impact.confirm": "Passer à {plan}",
    "mbr.impact.card.billed": "Avec vos {count} succursale(s) : {total} / mois",
    "mbr.impact.card.paused": "{paused} succursale(s) mise(s) en pause",
    "mbr.impact.card.fits": "Vos {count} succursale(s) sont incluses",
  },
  en: {
    "mbr.title": "Branches",
    "mbr.subtitle": "Open and manage your restaurant's other locations.",

    "mbr.plan.title": "Your plan: {plan}",
    "mbr.plan.included": "{count} locations included: your main restaurant and {branches} branch(es), for one price.",
    "mbr.plan.mainOnly": "Only your main restaurant is included.",
    "mbr.plan.extraPrice": "Extra branch: {price} a month, on the same invoice.",
    "mbr.plan.noExtra": "No branches beyond the included ones.",
    "mbr.plan.usage": "{open} open branch(es) · {covered} in service",
    "mbr.plan.paidExtra": "{count} extra paid for this period",

    "mbr.upsell.title": "Branches start with Professional",
    "mbr.upsell.body":
      "Starter covers one location. With Professional each branch is billed on its own; Enterprise includes several for one price.",
    "mbr.upsell.pausedCount": "{count} branch(es) paused until your plan covers them.",
    "mbr.upsell.cta": "See the plans",

    "mbr.lapsed": "Your subscription has expired: your branches are paused until it is paid.",
    "mbr.lapsedCta": "Pay the subscription",

    "mbr.unpaid.body": "{count} branch(es) paused until the extra branches are paid for.",
    "mbr.unpaid.bodyAmount": "{count} branch(es) paused until {amount} is paid.",
    "mbr.unpaid.pay": "Pay to open them",
    "mbr.unpaid.payAmount": "Pay {amount}",

    "mbr.list.title": "Your locations",
    "mbr.list.main": "Main restaurant — holds the subscription",
    "mbr.list.empty": "No branches yet.",

    "mbr.status.active": "In service",
    "mbr.status.paused": "Paused",
    "mbr.status.closed": "Closed",
    "mbr.status.suspended": "Suspended",
    "mbr.status.pending": "Pending",
    "mbr.status.pausedHint": "Not covered by the plan for now.",

    "mbr.action.open": "Open",
    "mbr.action.current": "You are here",
    "mbr.action.close": "Close",
    "mbr.action.reopen": "Reopen",

    "mbr.close.title": "Close the {label} branch?",
    "mbr.close.body":
      "It leaves the site and stops taking orders and bookings. Its menu, team, history and wallet are kept, and it is no longer billed from the next invoice. What was already paid for this period is not refunded.",
    "mbr.close.confirm": "Close the branch",

    "mbr.add.title": "Open a branch",
    "mbr.add.body":
      "A branch has its own menu, team, tables, orders and wallet. It takes the name, logo and cuisine of {name}.",
    "mbr.add.label": "Branch name",
    "mbr.add.labelHint": "Usually the neighbourhood: “Akwa”, “Bonapriso”…",
    "mbr.add.quartier": "Neighbourhood",
    "mbr.add.address": "Address",
    "mbr.add.phone": "Phone (optional)",
    "mbr.add.phoneHint": "Defaults to the main restaurant's.",
    "mbr.add.costCovered": "Included in your plan: nothing more to pay.",
    "mbr.add.costExtra":
      "Extra branch: {monthly} a month. Today: {now} for the {days} day(s) left in the period. It opens once paid.",
    "mbr.add.costExtraFree": "Extra branch: {monthly} a month, free while the platform is free.",
    "mbr.add.costExtraRenewal": "Extra branch: {monthly} a month, billed with your renewal. It opens once that is paid.",
    "mbr.add.unavailable": "Your plan includes no further branch. Move to a higher plan to open more.",
    "mbr.add.submit": "Open the branch",
    "mbr.add.submitPay": "Open and pay",

    "mbr.rules":
      "Your branches run on the main restaurant's plan. If the plan stops covering them (a move to Starter, an expired subscription, an unpaid extra), they pause automatically — newest first — and resume as soon as it is settled. Nothing is deleted.",

    "mbr.note.opened": "The {label} branch is open. Open it to build its menu.",
    "mbr.note.payToOpen": "Branch created. It opens as soon as it is paid for.",
    "mbr.note.onRenewal": "Branch saved: it is billed with your renewal and opens once that is paid.",
    "mbr.note.closed": "The {label} branch is closed.",
    "mbr.note.reopened": "The {label} branch is reopened.",
    "mbr.note.allCovered": "All your branches are covered.",
    "mbr.note.menuCopied": "Menu copied: {count} dish(es).",
    "mbr.note.synced": "Menu updated: {updated} dish(es) changed, {added} added.",
    "mbr.err.syncMigration": "Menu updates are not enabled on the platform yet (migration 0074).",
    "mbr.err.syncFailed": "Could not update the menu.",
    "mbr.action.syncMenu": "Update the menu",
    "mbr.sync.title": "Update {label}'s menu?",
    "mbr.sync.body":
      "Dishes {label} shares with the main restaurant take its prices, descriptions and photos; dishes it lacks are added with their options. The branch's own dishes, availability and stock do not change.",
    "mbr.ov.title": "Overview",
    "mbr.ov.subtitle": "Every location at a glance. Income: the last 7 days.",
    "mbr.ov.location": "Location",
    "mbr.ov.balance": "Balance",
    "mbr.ov.ordersToday": "Orders today",
    "mbr.ov.orders7d": "Orders (7 d)",
    "mbr.ov.income7d": "Income (7 d)",
    "mbr.ov.total": "Total",
    "mbr.note.menuNotCopied": "The menu could not be copied — try again from the Branches page.",
    "mbr.err.menuNotEmpty": "This branch already has dishes: the copy only goes into an empty menu.",
    "mbr.err.menuMigration": "Menu copying is not enabled on the platform yet (migration 0073).",
    "mbr.err.menuCopyFailed": "Could not copy the menu.",
    "mbr.action.copyMenu": "Copy the main menu",
    "mbr.list.dishes": "{count} dish(es) on the menu",
    "mbr.add.copyMenu": "Copy the main menu ({count} dishes)",
    "mbr.add.copyMenuHint":
      "Categories, dishes, prices, photos and options. Each branch then edits its own; stock starts at zero.",

    "mbr.err.notOwner": "Only the restaurant's owner can manage branches.",
    "mbr.err.notFound": "Branch not found.",
    "mbr.err.migration": "Branches are not enabled on the platform yet (migration 0072).",
    "mbr.err.tooMany": "Too many branches created in a short time. Try again later.",
    "mbr.err.mainInactive": "The main restaurant must be active to open a branch.",
    "mbr.err.planNoBranches": "Your plan has no branches. Move to Professional or Enterprise.",
    "mbr.err.subscriptionLapsed": "Your subscription has expired. Pay it before opening a branch.",
    "mbr.err.planBranchLimit":
      "Your plan includes {count} location(s) and cannot add more. Move to a higher plan.",
    "mbr.err.label": "Give the branch a name of 2 to 60 characters.",
    "mbr.err.labelTaken": "You already have a location with that name.",
    "mbr.err.address": "Enter the branch's address.",
    "mbr.err.phone": "That is not a valid Cameroonian number.",
    "mbr.err.quartier": "Enter the branch's neighbourhood.",
    "mbr.err.createFailed": "Could not create the branch.",
    "mbr.err.saveFailed": "Could not save the change.",

    "mbr.banner.paused":
      "This branch is paused: the main restaurant's plan does not cover it. Customers no longer see it, and it takes no orders or bookings.",
    "mbr.banner.closed": "The owner closed this branch. Customers no longer see it.",
    "mbr.banner.manage": "Manage branches",

    "mbr.billing.title": "Billed through the main restaurant",
    "mbr.billing.body":
      "{label} runs on the main restaurant's {plan} plan. Invoices, payments and plan changes are made from the main restaurant.",
    "mbr.billing.cta": "Open the main restaurant",

    "mbr.billingCard.title": "Branches",
    "mbr.billingCard.body": "{open} open branch(es) · {included} included in {plan}",
    "mbr.billingCard.extra": "{price} per extra branch, per month",
    "mbr.billingCard.cta": "Manage",

    "mbr.invoice.extraLine": "{count} extra branch(es)",
    "mbr.invoice.extraMeta": "{price} per branch, per month",
    "mbr.invoice.topUpLine": "Extra branches — prorated",
    "mbr.invoice.topUpMeta": "{from} – {to} · {count} extra branch(es) in total",
    "mbr.invoice.topUpName": "Extra branches",

    "mbr.impact.title": "This change affects your branches",
    "mbr.impact.paused":
      "On {plan}, {paused} of your {count} branch(es) will be paused — the newest ones. Customers will not see them until your plan covers them again. Nothing is deleted.",
    "mbr.impact.pausedAll":
      "{plan} has no branches: your {count} branch(es) will be paused. Nothing is deleted; they resume as soon as you return to a plan that covers them.",
    "mbr.impact.billed":
      "On {plan}, your {count} branch(es): {included} included and {extra} billed at {price} each — {total} a month in total.",
    "mbr.impact.trialPaused":
      "The {plan} trial bills nothing: {extra} branch(es) stay paused until their extra is paid (Branches page).",
    "mbr.impact.freeNote": "Nothing is billed while the platform is free.",
    "mbr.impact.confirm": "Move to {plan}",
    "mbr.impact.card.billed": "With your {count} branch(es): {total} / month",
    "mbr.impact.card.paused": "{paused} branch(es) paused",
    "mbr.impact.card.fits": "Your {count} branch(es) are included",
  },
});
