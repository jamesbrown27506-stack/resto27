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
    "mk.pricing.title": "Un tarif clair, par établissement",
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
    "mk.pricing.row.dishes": "Plats au menu",
    "mk.pricing.row.tables": "Tables",
    "mk.pricing.row.promotions": "Promotions actives",
    "mk.pricing.row.commission": "Commission par commande",
    "mk.pricing.row.staff": "Gestion du personnel",
    "mk.pricing.row.analytics": "Rapports et analytique",
    "mk.pricing.row.kitchen": "Écran de cuisine",
    "mk.pricing.row.dineIn": "Commande en salle",
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
      "Oui : le tarif s'entend par établissement, car chaque succursale a son menu, son équipe et ses commandes. La formule Enterprise est conçue pour les groupes à plusieurs adresses.",
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
  },
  en: {
    /* ── /pricing ────────────────────────────────────────────────────── */
    "mk.pricing.tag": "Pricing",
    "mk.pricing.title": "One clear price, per restaurant",
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
    "mk.pricing.row.dishes": "Menu dishes",
    "mk.pricing.row.tables": "Tables",
    "mk.pricing.row.promotions": "Active promotions",
    "mk.pricing.row.commission": "Commission per order",
    "mk.pricing.row.staff": "Staff management",
    "mk.pricing.row.analytics": "Reports & analytics",
    "mk.pricing.row.kitchen": "Kitchen screen",
    "mk.pricing.row.dineIn": "Table ordering",
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
      "Yes: the price is per establishment, because each branch has its own menu, team and orders. The Enterprise plan is designed for groups with several locations.",
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
  },
});
