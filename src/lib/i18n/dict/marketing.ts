import { defineDict } from "../define";

/**
 * Public marketing pages — /pricing, /contact and the contact form.
 *
 * OWNED BY THESE SCREENS. Add every string they need here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `mk.` so two modules can never collide.
 */
export const marketingDict = defineDict({
  fr: {
    /* ── /pricing ────────────────────────────────────────────────────── */
    "mk.pricing.tag": "Tarifs",
    "mk.pricing.title": "Un tarif clair pour tout votre restaurant",
    "mk.pricing.subtitle":
      "Sans engagement, payable par Mobile Money. Changez ou arrêtez à tout moment.",
    "mk.pricing.compare": "Comparer les formules",
    "mk.pricing.feature": "Fonctionnalité",
    "mk.pricing.included": "Inclus",
    "mk.pricing.notIncluded": "Non inclus",
    "mk.pricing.need": "Besoin d'autre chose ?",
    "mk.pricing.talk": "Parlons-en",
    "mk.pricing.faqTitle": "Questions sur la facturation",

    "mk.pricing.row.monthly": "Prix mensuel",
    "mk.pricing.row.free": "Gratuit",
    "mk.pricing.row.trial": "Essai gratuit",
    "mk.pricing.row.trialDays": "{days} jours",
    "mk.pricing.row.locations": "Établissements inclus",
    "mk.pricing.row.extraBranch": "Succursale supplémentaire",
    "mk.pricing.row.perMonth": "{price} / mois",
    "mk.pricing.row.dishes": "Plats au menu",
    "mk.pricing.row.tables": "Tables",
    "mk.pricing.row.promotions": "Promotions actives",
    "mk.pricing.row.commission": "Commission par commande",
    "mk.pricing.row.staff": "Gestion du personnel",
    "mk.pricing.row.analytics": "Rapports et analytique",
    "mk.pricing.row.kitchen": "Écran de cuisine",
    "mk.pricing.row.dineIn": "Commandes sur place",
    "mk.pricing.row.reservations": "Réservations",
    "mk.pricing.row.momo": "Paiement Mobile Money",
    "mk.pricing.row.loyalty": "Programme de fidélité",

    "mk.pricing.faq.q1": "La commission s'ajoute-t-elle à l'abonnement ?",
    "mk.pricing.faq.a1":
      "Oui. L'abonnement mensuel donne accès à la plateforme ; la commission est un pourcentage de la valeur des commandes livrées. Elle ne s'applique jamais aux commandes annulées, ni aux frais de livraison — cet argent est votre coût, pas votre recette.",
    "mk.pricing.faq.q2": "Que se passe-t-il si je paie en retard ?",
    "mk.pricing.faq.a2":
      "Vous disposez de trois jours de grâce après l'échéance, pendant lesquels tout continue de fonctionner normalement avec un simple rappel affiché. Au-delà, le compte passe aux limites de la formule Starter jusqu'au règlement — vos données restent intactes et la page de facturation reste toujours accessible.",
    "mk.pricing.faq.q3": "Puis-je changer de formule en cours de mois ?",
    "mk.pricing.faq.a3":
      "Oui, à tout moment et dans les deux sens. Le changement prend effet dès la confirmation du paiement, et la période déjà réglée est prise en compte.",
    "mk.pricing.faq.q4": "Chaque succursale a-t-elle besoin de son propre abonnement ?",
    "mk.pricing.faq.a4":
      "Non. Une seule formule couvre votre restaurant et ses succursales. Enterprise inclut plusieurs établissements pour un seul prix, et chaque succursale en plus s'ajoute à la même facture ; avec Professional, chaque succursale est facturée à part ; Starter couvre un seul établissement. Chaque succursale garde son menu, son équipe et ses commandes.",
    "mk.pricing.faq.q5": "Comment se passe le paiement ?",
    "mk.pricing.faq.a5":
      "Vous saisissez votre numéro MTN MoMo ou Orange Money, puis validez la demande sur votre téléphone. Votre formule est activée dès la confirmation de l'opérateur.",

    "mk.pricing.cta.title": "Prêt à inscrire votre restaurant ?",
    "mk.pricing.cta.body": "La validation prend en général moins de 48 heures.",
    "mk.pricing.cta.primary": "Créer mon compte restaurant",
    "mk.pricing.cta.secondary": "Poser une question",

    /* ── /contact ────────────────────────────────────────────────────── */
    "mk.contact.tag": "Contact",
    "mk.contact.title": "Parlons-en",
    "mk.contact.subtitle":
      "Une question sur une commande, un abonnement ou l'inscription de votre établissement ? Notre équipe est à Douala.",
    "mk.contact.reach": "Nous joindre",
    "mk.contact.emailLabel": "Email",
    "mk.contact.phoneLabel": "Téléphone",
    "mk.contact.addressLabel": "Adresse",
    "mk.contact.hoursLabel": "Horaires",
    "mk.contact.hoursValue": "Lun–Sam, 08h–19h",
    "mk.contact.ownerTitle": "Vous êtes restaurateur ?",
    "mk.contact.ownerBody":
      "L'inscription est gratuite et la validation prend moins de 48 heures.",
    "mk.contact.ownerCta": "Inscrire mon restaurant →",

    /* ── Contact form ────────────────────────────────────────────────── */
    "mk.contact.form.name": "Nom complet",
    "mk.contact.form.namePh": "Marie Ngo",
    "mk.contact.form.email": "Email",
    "mk.contact.form.emailPh": "vous@exemple.cm",
    "mk.contact.form.subject": "Sujet",
    "mk.contact.form.subjectPh": "Comment pouvons-nous aider ?",
    "mk.contact.form.message": "Message",
    "mk.contact.form.messagePh": "Décrivez votre demande…",
    "mk.contact.form.honeypot": "Ne pas remplir",
    "mk.contact.form.send": "Envoyer le message",
    "mk.contact.form.sentTitle": "Message bien reçu",
    "mk.contact.form.sentBody":
      "Notre équipe vous répond par email sous 24 heures ouvrées.",
    "mk.contact.form.sendAnother": "Envoyer un autre message",
    "mk.contact.form.sentToast": "Message envoyé. Nous répondons sous 24 heures.",
    "mk.contact.form.failedToast": "Impossible d'envoyer le message.",

    /* ── /about ─────────────────────────────────────────────────────── */
    "mk.about.tag": "À propos",
    "mk.about.title": "Resto237, en clair",
    "mk.about.subtitle":
      "Une place de marché pour commander un repas et réserver une table auprès des restaurants de Douala.",
    "mk.about.what.title": "Ce que fait Resto237",
    "mk.about.what.p1":
      "Resto237 réunit sur un même site les menus, les prix et les horaires des restaurants de Douala. Vous cherchez par plat, par quartier ou par cuisine, vous comparez, puis vous commandez en livraison ou à emporter — ou vous réservez une table.",
    "mk.about.what.p2":
      "Nous ne sommes pas un restaurant. Nous ne cuisinons rien : chaque plat est préparé par l'établissement chez qui vous commandez, qui reste responsable de sa carte, de ses prix et de sa cuisine.",
    "mk.about.coverage.title": "Où nous opérons",
    "mk.about.coverage.p1":
      "Resto237 couvre aujourd'hui Douala. Les quartiers desservis dépendent des restaurants inscrits : chaque fiche indique le quartier de l'établissement et les modes de commande qu'il propose.",
    "mk.about.coverage.p2":
      "D'autres villes du Cameroun suivront à mesure que des restaurants s'y inscrivent. Nous préférons annoncer une couverture réelle plutôt qu'une ambition.",
    "mk.about.how.title": "Comment ça marche",
    "mk.about.how.s1": "Cherchez un plat, un quartier ou un restaurant. Aucun compte n'est nécessaire pour parcourir les menus et remplir votre panier.",
    "mk.about.how.s2": "Passez commande en livraison ou à emporter, ou réservez une table. Vous recevez une confirmation et suivez l'avancement en direct.",
    "mk.about.how.s3": "Le restaurant prépare, puis livre ou vous accueille. Les frais de livraison sont fixés par l'établissement selon le quartier et confirmés avant validation.",
    "mk.about.payment.title": "Paiement",
    "mk.about.payment.p1":
      "Les commandes se règlent à la livraison ou au restaurant. Les abonnements des restaurants partenaires se paient par MTN Mobile Money ou Orange Money.",
    "mk.about.trust.title": "Restaurants vérifiés",
    "mk.about.trust.p1":
      "Chaque restaurant est validé avant d'apparaître sur le site, et le badge vérifié signale les établissements dont nous avons confirmé l'identité et les coordonnées. Les notes et les avis proviennent de clients ayant réellement commandé.",
    "mk.about.owner.title": "Vous tenez un restaurant à Douala ?",
    "mk.about.owner.p1":
      "L'inscription est gratuite et la validation prend en général moins de 48 heures. Vous gérez votre carte, vos horaires et vos commandes depuis votre espace.",
    "mk.about.owner.cta": "Inscrire mon restaurant →",
    "mk.about.contact.cta": "Nous contacter",
  },
  en: {
    /* ── /pricing ────────────────────────────────────────────────────── */
    "mk.pricing.tag": "Pricing",
    "mk.pricing.title": "One clear price for your whole restaurant",
    "mk.pricing.subtitle":
      "No commitment, payable by Mobile Money. Change or stop at any time.",
    "mk.pricing.compare": "Compare the plans",
    "mk.pricing.feature": "Feature",
    "mk.pricing.included": "Included",
    "mk.pricing.notIncluded": "Not included",
    "mk.pricing.need": "Need something else?",
    "mk.pricing.talk": "Talk to us",
    "mk.pricing.faqTitle": "Billing questions",

    "mk.pricing.row.monthly": "Monthly price",
    "mk.pricing.row.free": "Free",
    "mk.pricing.row.trial": "Free trial",
    "mk.pricing.row.trialDays": "{days} days",
    "mk.pricing.row.locations": "Locations included",
    "mk.pricing.row.extraBranch": "Extra branch",
    "mk.pricing.row.perMonth": "{price} / month",
    "mk.pricing.row.dishes": "Menu dishes",
    "mk.pricing.row.tables": "Tables",
    "mk.pricing.row.promotions": "Active promotions",
    "mk.pricing.row.commission": "Commission per order",
    "mk.pricing.row.staff": "Staff management",
    "mk.pricing.row.analytics": "Reports & analytics",
    "mk.pricing.row.kitchen": "Kitchen screen",
    "mk.pricing.row.dineIn": "On-site orders",
    "mk.pricing.row.reservations": "Reservations",
    "mk.pricing.row.momo": "Mobile Money payment",
    "mk.pricing.row.loyalty": "Loyalty programme",

    "mk.pricing.faq.q1": "Is the commission on top of the subscription?",
    "mk.pricing.faq.a1":
      "Yes. The monthly subscription gives access to the platform; the commission is a percentage of the value of delivered orders. It never applies to cancelled orders or to delivery fees — that money is your cost, not your revenue.",
    "mk.pricing.faq.q2": "What happens if I pay late?",
    "mk.pricing.faq.a2":
      "You get a three-day grace period after the due date, during which everything keeps working normally with a simple reminder shown. Beyond that, the account drops to Starter plan limits until payment — your data stays intact and the billing page always remains accessible.",
    "mk.pricing.faq.q3": "Can I change plans mid-month?",
    "mk.pricing.faq.a3":
      "Yes, at any time and in either direction. The change takes effect as soon as payment is confirmed, and the period already paid for is taken into account.",
    "mk.pricing.faq.q4": "Does every branch need its own subscription?",
    "mk.pricing.faq.a4":
      "No. One plan covers your restaurant and its branches. Enterprise includes several locations for one price, and each extra branch is added to the same invoice; on Professional each branch is billed on its own; Starter covers a single location. Every branch keeps its own menu, team and orders.",
    "mk.pricing.faq.q5": "How does payment work?",
    "mk.pricing.faq.a5":
      "You enter your MTN MoMo or Orange Money number, then approve the request on your phone. Your plan is activated as soon as the operator confirms.",

    "mk.pricing.cta.title": "Ready to list your restaurant?",
    "mk.pricing.cta.body": "Validation usually takes under 48 hours.",
    "mk.pricing.cta.primary": "Create my restaurant account",
    "mk.pricing.cta.secondary": "Ask a question",

    /* ── /contact ────────────────────────────────────────────────────── */
    "mk.contact.tag": "Contact",
    "mk.contact.title": "Talk to us",
    "mk.contact.subtitle":
      "A question about an order, a subscription or listing your establishment? Our team is in Douala.",
    "mk.contact.reach": "Reach us",
    "mk.contact.emailLabel": "Email",
    "mk.contact.phoneLabel": "Phone",
    "mk.contact.addressLabel": "Address",
    "mk.contact.hoursLabel": "Hours",
    "mk.contact.hoursValue": "Mon–Sat, 8am–7pm",
    "mk.contact.ownerTitle": "Do you run a restaurant?",
    "mk.contact.ownerBody": "Listing is free and validation takes under 48 hours.",
    "mk.contact.ownerCta": "List my restaurant →",

    /* ── Contact form ────────────────────────────────────────────────── */
    "mk.contact.form.name": "Full name",
    "mk.contact.form.namePh": "Marie Ngo",
    "mk.contact.form.email": "Email",
    "mk.contact.form.emailPh": "you@example.cm",
    "mk.contact.form.subject": "Subject",
    "mk.contact.form.subjectPh": "How can we help?",
    "mk.contact.form.message": "Message",
    "mk.contact.form.messagePh": "Describe your request…",
    "mk.contact.form.honeypot": "Do not fill in",
    "mk.contact.form.send": "Send message",
    "mk.contact.form.sentTitle": "Message received",
    "mk.contact.form.sentBody": "Our team replies by email within 24 working hours.",
    "mk.contact.form.sendAnother": "Send another message",
    "mk.contact.form.sentToast": "Message sent. We reply within 24 hours.",
    "mk.contact.form.failedToast": "The message could not be sent.",

    /* ── /about ─────────────────────────────────────────────────────── */
    "mk.about.tag": "About",
    "mk.about.title": "Resto237, plainly",
    "mk.about.subtitle":
      "A marketplace for ordering food and booking a table with restaurants in Douala.",
    "mk.about.what.title": "What Resto237 does",
    "mk.about.what.p1":
      "Resto237 brings the menus, prices and opening hours of Douala's restaurants together in one place. Search by dish, by neighbourhood or by cuisine, compare, then order for delivery or pickup — or book a table.",
    "mk.about.what.p2":
      "We are not a restaurant. We cook nothing: every dish is prepared by the establishment you order from, which remains responsible for its menu, its prices and its kitchen.",
    "mk.about.coverage.title": "Where we operate",
    "mk.about.coverage.p1":
      "Resto237 currently covers Douala. Which neighbourhoods are served depends on the restaurants signed up: each listing states the establishment's quarter and the ordering options it offers.",
    "mk.about.coverage.p2":
      "Other Cameroonian cities will follow as restaurants there join. We would rather state the coverage we actually have than the one we intend.",
    "mk.about.how.title": "How it works",
    "mk.about.how.s1": "Search for a dish, a neighbourhood or a restaurant. No account is needed to browse menus and fill your basket.",
    "mk.about.how.s2": "Order for delivery or pickup, or book a table. You get a confirmation and follow progress live.",
    "mk.about.how.s3": "The restaurant prepares your order, then delivers it or welcomes you. Delivery fees are set by the establishment according to the neighbourhood and confirmed before you commit.",
    "mk.about.payment.title": "Payment",
    "mk.about.payment.p1":
      "Orders are paid on delivery or at the restaurant. Partner restaurants pay their subscription by MTN Mobile Money or Orange Money.",
    "mk.about.trust.title": "Verified restaurants",
    "mk.about.trust.p1":
      "Every restaurant is checked before it appears on the site, and the verified badge marks those whose identity and contact details we have confirmed. Ratings and reviews come from customers who actually ordered.",
    "mk.about.owner.title": "Do you run a restaurant in Douala?",
    "mk.about.owner.p1":
      "Listing is free and approval usually takes under 48 hours. You manage your menu, your hours and your orders from your own dashboard.",
    "mk.about.owner.cta": "List my restaurant →",
    "mk.about.contact.cta": "Contact us",
  },
});
