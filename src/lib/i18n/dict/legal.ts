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
      "Resto237 met en relation des clients et des restaurants au Cameroun. La plateforme permet de commander des repas en livraison ou à emporter, de réserver une table, et donne aux restaurants les outils de gestion de leur service.",
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
      "Lorsque vous créez un compte, nous collectons votre nom, votre adresse email et votre numéro de téléphone pour gérer votre compte et permettre aux restaurants de vous joindre au sujet de vos commandes ou réservations.",
    "leg.privacy.donnees.p2":
      "Nous enregistrons les détails de vos commandes et réservations, notamment les articles, montants, coordonnées de livraison ou de réservation et instructions fournies. Pour les paiements Mobile Money, nous enregistrons aussi le numéro utilisé et les informations de transaction.",

    "leg.privacy.utilisation": "Utilisation de vos données",
    "leg.privacy.utilisation.p1":
      "Vos données servent à traiter vos commandes et vos réservations, à vous tenir informé de leur avancement, à gérer votre programme de fidélité et à répondre à vos demandes d'assistance.",
    "leg.privacy.utilisation.p2":
      "Nous ne vendons pas vos données. Les restaurants concernés reçoivent les informations nécessaires pour traiter vos commandes et réservations; les prestataires de paiement reçoivent les données nécessaires pour traiter vos paiements.",
    "leg.privacy.utilisation.p3":
      "Le site utilise Firebase Analytics pour mesurer son utilisation lorsque cette fonction est prise en charge. Si vous activez les notifications push, des identifiants d'appareil ou de navigateur sont utilisés pour les acheminer.",

    "leg.privacy.conservation": "Conservation et suppression",
    "leg.privacy.conservation.p1":
      "Vous pouvez supprimer votre compte depuis vos paramètres. Cette action anonymise les champs nom, email et téléphone de votre profil et met fin à l'accès au compte.",
    "leg.privacy.conservation.p2":
      "Les commandes, réservations et paiements passés restent conservés pour le suivi des transactions, la comptabilité et le traitement des litiges. Ces dossiers peuvent encore contenir le nom, les coordonnées ou l'adresse saisis lors de la transaction; la suppression du compte ne les anonymise pas automatiquement. Contactez-nous pour toute demande concernant ces données.",

    "leg.privacy.securite": "Sécurité",
    "leg.privacy.securite.p1":
      "Les mots de passe sont stockés sous forme de condensats cryptographiques et ne sont jamais lisibles, y compris par nos équipes. Les échanges avec la plateforme sont chiffrés.",
    "leg.privacy.securite.p2":
      "La suspension d'un compte bloque son accès à l'application. Après une modification de votre mot de passe, vous devez vous reconnecter.",

    "leg.privacy.paiement": "Paiements",
    "leg.privacy.paiement.p1":
      "Selon le service et les options proposées, les commandes peuvent être réglées en espèces, par Mobile Money ou avec le solde du portefeuille Resto237. Le Mobile Money sert également aux réservations, aux paiements à table, aux recharges du portefeuille et aux abonnements des restaurants.",
    "leg.privacy.paiement.p2":
      "Pour un paiement Mobile Money, nous transmettons au prestataire les informations nécessaires, notamment le numéro de téléphone et le montant. Nous conservons le numéro, le prestataire, la référence, le montant et le statut de la transaction. Nous ne demandons pas votre code PIN Mobile Money.",

    "leg.privacy.droits": "Vos droits",
    "leg.privacy.droits.p1":
      "Vous pouvez consulter ou corriger les informations de votre compte dans l'application, supprimer votre compte depuis les paramètres ou nous écrire à contact@resto237.online pour une demande concernant vos données personnelles conservées dans les dossiers de transaction.",
    "leg.privacy.droits.p2":
      "Vous pouvez également refuser les emails non essentiels depuis vos paramètres de notification, sans perdre les messages liés à vos commandes en cours.",

    "leg.privacy.contact": "Nous contacter",
    "leg.privacy.contact.p1":
      "Pour toute question relative à cette politique, écrivez-nous à contact@resto237.online ou utilisez le formulaire de contact.",
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
      "Resto237 connects customers and restaurants in Cameroon. The platform allows ordering meals for delivery or pickup, booking a table, and gives restaurants the tools to manage their service.",
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
      "When you create an account, we collect your name, email address and phone number to manage your account and let restaurants contact you about your orders or reservations.",
    "leg.privacy.donnees.p2":
      "We record details of your orders and reservations, including items, amounts, delivery or booking contact details and instructions you provide. For Mobile Money payments, we also record the number used and transaction information.",

    "leg.privacy.utilisation": "How we use your data",
    "leg.privacy.utilisation.p1":
      "Your data is used to process your orders and reservations, keep you informed of their progress, run your loyalty programme and answer your support requests.",
    "leg.privacy.utilisation.p2":
      "We do not sell your data. The relevant restaurants receive the information needed to handle your orders and reservations; payment providers receive the data needed to process your payments.",
    "leg.privacy.utilisation.p3":
      "The website uses Firebase Analytics to measure usage when supported. If you enable push notifications, device or browser identifiers are used to deliver them.",

    "leg.privacy.conservation": "Retention and deletion",
    "leg.privacy.conservation.p1":
      "You can delete your account from your settings. This anonymises the name, email and phone fields in your profile and ends access to the account.",
    "leg.privacy.conservation.p2":
      "Past orders, reservations and payments remain on record for transaction tracking, accounting and dispute handling. These records may still contain the name, contact details or address entered for the transaction; deleting your account does not automatically anonymise them. Contact us about data held in these records.",

    "leg.privacy.securite": "Security",
    "leg.privacy.securite.p1":
      "Passwords are stored as cryptographic hashes and are never readable, including by our teams. Traffic with the platform is encrypted.",
    "leg.privacy.securite.p2":
      "Suspending an account blocks access to the application. After changing your password, you must sign in again.",

    "leg.privacy.paiement": "Payments",
    "leg.privacy.paiement.p1":
      "Depending on the service and available options, orders may be paid in cash, by Mobile Money or with your Resto237 wallet balance. Mobile Money is also used for reservations, table payments, wallet top-ups and restaurant subscriptions.",
    "leg.privacy.paiement.p2":
      "For a Mobile Money payment, we send the provider the information needed to process it, including the phone number and amount. We keep the number, provider, reference, amount and transaction status. We do not ask for your Mobile Money PIN.",

    "leg.privacy.droits": "Your rights",
    "leg.privacy.droits.p1":
      "You can view or correct your account details in the app, delete your account from settings, or write to contact@resto237.online about personal data retained in transaction records.",
    "leg.privacy.droits.p2":
      "You can also opt out of non-essential emails from your notification settings, without losing messages about your current orders.",

    "leg.privacy.contact": "Contact us",
    "leg.privacy.contact.p1":
      "For any question about this policy, write to contact@resto237.online or use the contact form.",
  },
});
