import { defineDict } from "../define";

/**
 * Legal pages — /terms and /privacy, and the shared LegalPage shell.
 *
 * OWNED BY THESE SCREENS. Add every string they need here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `leg.` so two modules can never collide.
 */
export const legalDict = defineDict({
  fr: {
    /* ── LegalPage shell ─────────────────────────────────────────────── */
    "leg.shell.updated": "Dernière mise à jour :",
    "leg.shell.toc": "Sommaire",
    "leg.shell.tocAria": "Sommaire",

    /* ── /terms ──────────────────────────────────────────────────────── */
    "leg.terms.title": "Conditions d'utilisation",
    "leg.terms.intro":
      "Les règles qui encadrent l'utilisation de la plateforme, côté client comme côté restaurant.",

    "leg.terms.objet": "Objet",
    "leg.terms.objet.p1":
      "RestoLink met en relation des clients et des restaurants au Cameroun. La plateforme permet de commander des repas en livraison ou à emporter, de réserver une table, et donne aux restaurants les outils de gestion de leur service.",
    "leg.terms.objet.p2": "L'utilisation de la plateforme implique l'acceptation pleine et entière des présentes conditions.",

    "leg.terms.comptes": "Comptes",
    "leg.terms.comptes.p1":
      "Vous êtes responsable de la confidentialité de vos identifiants et de toute activité effectuée depuis votre compte. Prévenez-nous immédiatement en cas d'utilisation non autorisée.",
    "leg.terms.comptes.p2":
      "Les comptes restaurant sont soumis à validation par notre équipe avant publication. Nous pouvons refuser ou suspendre un compte en cas de manquement aux présentes conditions.",

    "leg.terms.commandes": "Commandes et frais de livraison",
    "leg.terms.commandes.p1":
      "Les prix affichés sont ceux fixés par le restaurant et sont exprimés en francs CFA, toutes taxes comprises.",
    "leg.terms.commandes.p2":
      "Les frais de livraison ne sont pas calculés automatiquement : ils sont déterminés par le restaurant au moment où il confirme votre commande, en fonction de votre quartier. Ils vous sont communiqués à ce moment-là et s'ajoutent au total.",
    "leg.terms.commandes.p3":
      "Une commande peut être annulée tant qu'elle n'a pas été prise en charge par la cuisine. Passé ce stade, l'annulation relève de l'appréciation du restaurant.",

    "leg.terms.responsabilite": "Responsabilité",
    "leg.terms.responsabilite.p1":
      "La préparation des repas, leur qualité, leur conformité et le respect des règles d'hygiène relèvent de la seule responsabilité du restaurant.",
    "leg.terms.responsabilite.p2":
      "Les informations sur les allergènes sont fournies par les restaurants. En cas d'allergie sévère, contactez directement l'établissement avant de commander.",

    "leg.terms.abonnements": "Abonnements des restaurants",
    "leg.terms.abonnements.p1":
      "L'accès aux outils de gestion est soumis à un abonnement mensuel par établissement, ainsi qu'à une commission sur la valeur des commandes livrées. La commission ne s'applique ni aux commandes annulées ni aux frais de livraison.",
    "leg.terms.abonnements.p2":
      "En cas de retard de paiement, une période de grâce de trois jours est appliquée sans restriction d'accès. Au-delà, le compte revient aux limites de la formule Starter jusqu'au règlement. Aucune donnée n'est supprimée, et la page de facturation reste accessible en permanence.",
    "leg.terms.abonnements.p3":
      "Le taux de commission appliqué à un relevé est celui en vigueur au moment de sa génération. Un relevé déjà émis n'est jamais recalculé.",

    "leg.terms.avis": "Avis",
    "leg.terms.avis.p1":
      "Les avis ne peuvent être déposés qu'après une commande effectivement livrée. Ils doivent rester factuels et respectueux.",
    "leg.terms.avis.p2":
      "Nous pouvons retirer un avis signalé comme injurieux ou diffamatoire. Nous ne modifions jamais le contenu d'un avis : il est publié tel quel ou retiré.",

    "leg.terms.modification": "Modification des conditions",
    "leg.terms.modification.p1":
      "Ces conditions peuvent évoluer. Toute modification substantielle est notifiée par email et dans l'application au moins quinze jours avant son entrée en vigueur.",

    "leg.terms.droit": "Droit applicable",
    "leg.terms.droit.p1":
      "Les présentes conditions sont régies par le droit camerounais. Tout litige relève de la compétence des tribunaux de Douala.",

    /* ── /privacy ────────────────────────────────────────────────────── */
    "leg.privacy.title": "Politique de confidentialité",
    "leg.privacy.intro": "Ce que nous collectons, pourquoi, et ce que vous pouvez en faire.",

    "leg.privacy.donnees": "Données que nous collectons",
    "leg.privacy.donnees.p1":
      "Lorsque vous créez un compte, nous collectons votre nom, votre adresse email et votre numéro de téléphone. Ces informations sont nécessaires pour vous identifier et pour permettre au restaurant de vous joindre au sujet de votre commande.",
    "leg.privacy.donnees.p2":
      "Lorsque vous passez commande, nous enregistrons les articles commandés, le montant, votre adresse de livraison et vos éventuelles instructions. Ces éléments sont conservés avec la commande.",

    "leg.privacy.utilisation": "Utilisation de vos données",
    "leg.privacy.utilisation.p1":
      "Vos données servent à traiter vos commandes et vos réservations, à vous tenir informé de leur avancement, à gérer votre programme de fidélité et à répondre à vos demandes d'assistance.",
    "leg.privacy.utilisation.p2":
      "Nous ne vendons jamais vos données à des tiers. Les restaurants n'ont accès qu'aux informations nécessaires à l'exécution de vos commandes chez eux.",

    "leg.privacy.conservation": "Conservation et suppression",
    "leg.privacy.conservation.p1":
      "Vous pouvez demander la suppression de votre compte à tout moment depuis vos paramètres. Vos données personnelles — nom, email, téléphone — sont alors définitivement anonymisées.",
    "leg.privacy.conservation.p2":
      "L'historique des commandes est conservé sous forme anonymisée. Cette conservation est nécessaire : les commandes constituent l'historique comptable du restaurant et la base du calcul des commissions de la plateforme. Elles ne peuvent plus être reliées à votre identité.",

    "leg.privacy.securite": "Sécurité",
    "leg.privacy.securite.p1":
      "Les mots de passe sont stockés sous forme de condensats cryptographiques et ne sont jamais lisibles, y compris par nos équipes. Les échanges avec la plateforme sont chiffrés.",
    "leg.privacy.securite.p2":
      "Si vous suspendez ou modifiez votre mot de passe, toutes vos sessions ouvertes sont immédiatement invalidées sur l'ensemble de vos appareils.",

    "leg.privacy.paiement": "Paiements",
    "leg.privacy.paiement.p1":
      "Les commandes sont réglées en espèces à la livraison ou directement au restaurant. Nous ne stockons aucune coordonnée bancaire de client.",
    "leg.privacy.paiement.p2":
      "Les abonnements des restaurateurs sont réglés par Mobile Money via notre prestataire de paiement. Nous conservons la référence de la transaction et le montant, jamais les identifiants de votre compte mobile.",

    "leg.privacy.droits": "Vos droits",
    "leg.privacy.droits.p1":
      "Vous pouvez consulter, corriger ou faire supprimer vos données personnelles à tout moment depuis votre compte, ou en nous écrivant à contact@restolink.cm.",
    "leg.privacy.droits.p2":
      "Vous pouvez également refuser les emails non essentiels depuis vos paramètres de notification, sans perdre les messages liés à vos commandes en cours.",

    "leg.privacy.contact": "Nous contacter",
    "leg.privacy.contact.p1":
      "Pour toute question relative à cette politique, écrivez-nous à contact@restolink.cm ou utilisez le formulaire de contact.",
  },
  en: {
    /* ── LegalPage shell ─────────────────────────────────────────────── */
    "leg.shell.updated": "Last updated:",
    "leg.shell.toc": "Contents",
    "leg.shell.tocAria": "Contents",

    /* ── /terms ──────────────────────────────────────────────────────── */
    "leg.terms.title": "Terms of Use",
    "leg.terms.intro":
      "The rules that govern the use of the platform, on the customer side and the restaurant side.",

    "leg.terms.objet": "Purpose",
    "leg.terms.objet.p1":
      "RestoLink connects customers and restaurants in Cameroon. The platform allows ordering meals for delivery or pickup, booking a table, and gives restaurants the tools to manage their service.",
    "leg.terms.objet.p2":
      "Using the platform means fully accepting these terms.",

    "leg.terms.comptes": "Accounts",
    "leg.terms.comptes.p1":
      "You are responsible for keeping your credentials confidential and for any activity carried out from your account. Tell us immediately about any unauthorised use.",
    "leg.terms.comptes.p2":
      "Restaurant accounts are reviewed by our team before being published. We may refuse or suspend an account that breaches these terms.",

    "leg.terms.commandes": "Orders and delivery fees",
    "leg.terms.commandes.p1":
      "Displayed prices are set by the restaurant and are in CFA francs, all taxes included.",
    "leg.terms.commandes.p2":
      "Delivery fees are not calculated automatically: they are set by the restaurant when it confirms your order, based on your neighbourhood. You are told the amount then, and it is added to the total.",
    "leg.terms.commandes.p3":
      "An order can be cancelled as long as the kitchen has not started it. After that point, cancellation is at the restaurant's discretion.",

    "leg.terms.responsabilite": "Liability",
    "leg.terms.responsabilite.p1":
      "The preparation of meals, their quality, their compliance and respect for hygiene rules are the sole responsibility of the restaurant.",
    "leg.terms.responsabilite.p2":
      "Allergen information is provided by the restaurants. In case of a severe allergy, contact the establishment directly before ordering.",

    "leg.terms.abonnements": "Restaurant subscriptions",
    "leg.terms.abonnements.p1":
      "Access to the management tools requires a monthly subscription per establishment, plus a commission on the value of delivered orders. The commission applies neither to cancelled orders nor to delivery fees.",
    "leg.terms.abonnements.p2":
      "If payment is late, a three-day grace period applies without any restriction of access. Beyond that, the account reverts to Starter plan limits until payment. No data is deleted, and the billing page always remains accessible.",
    "leg.terms.abonnements.p3":
      "The commission rate applied to a statement is the one in force when it is generated. An already-issued statement is never recalculated.",

    "leg.terms.avis": "Reviews",
    "leg.terms.avis.p1":
      "Reviews can only be posted after an order has actually been delivered. They must stay factual and respectful.",
    "leg.terms.avis.p2":
      "We may remove a review reported as abusive or defamatory. We never modify the content of a review: it is published as-is or removed.",

    "leg.terms.modification": "Changes to the terms",
    "leg.terms.modification.p1":
      "These terms may evolve. Any substantial change is notified by email and in the app at least fifteen days before it takes effect.",

    "leg.terms.droit": "Applicable law",
    "leg.terms.droit.p1":
      "These terms are governed by Cameroonian law. Any dispute falls under the jurisdiction of the courts of Douala.",

    /* ── /privacy ────────────────────────────────────────────────────── */
    "leg.privacy.title": "Privacy Policy",
    "leg.privacy.intro": "What we collect, why, and what you can do about it.",

    "leg.privacy.donnees": "Data we collect",
    "leg.privacy.donnees.p1":
      "When you create an account, we collect your name, email address and phone number. This information is needed to identify you and to let the restaurant reach you about your order.",
    "leg.privacy.donnees.p2":
      "When you place an order, we record the items ordered, the amount, your delivery address and any instructions. These are kept with the order.",

    "leg.privacy.utilisation": "How we use your data",
    "leg.privacy.utilisation.p1":
      "Your data is used to process your orders and reservations, keep you informed of their progress, run your loyalty programme and answer your support requests.",
    "leg.privacy.utilisation.p2":
      "We never sell your data to third parties. Restaurants only see the information needed to fulfil your orders with them.",

    "leg.privacy.conservation": "Retention and deletion",
    "leg.privacy.conservation.p1":
      "You can ask to delete your account at any time from your settings. Your personal data — name, email, phone — is then permanently anonymised.",
    "leg.privacy.conservation.p2":
      "Order history is kept in anonymised form. This retention is necessary: orders are the restaurant's accounting history and the basis for the platform's commission calculations. They can no longer be linked to your identity.",

    "leg.privacy.securite": "Security",
    "leg.privacy.securite.p1":
      "Passwords are stored as cryptographic hashes and are never readable, including by our teams. Traffic with the platform is encrypted.",
    "leg.privacy.securite.p2":
      "If you suspend or change your password, all your open sessions are immediately invalidated on every device.",

    "leg.privacy.paiement": "Payments",
    "leg.privacy.paiement.p1":
      "Orders are paid in cash on delivery or directly at the restaurant. We do not store any customer bank details.",
    "leg.privacy.paiement.p2":
      "Restaurant subscriptions are paid by Mobile Money through our payment provider. We keep the transaction reference and the amount, never your mobile account credentials.",

    "leg.privacy.droits": "Your rights",
    "leg.privacy.droits.p1":
      "You can view, correct or delete your personal data at any time from your account, or by writing to contact@restolink.cm.",
    "leg.privacy.droits.p2":
      "You can also opt out of non-essential emails from your notification settings, without losing messages about your current orders.",

    "leg.privacy.contact": "Contact us",
    "leg.privacy.contact.p1":
      "For any question about this policy, write to contact@restolink.cm or use the contact form.",
  },
});
