/**
 * Translation dictionaries.
 *
 * Cameroon is officially bilingual — francophone-majority, with a large
 * anglophone population in the North-West and South-West. Shipping one
 * language excludes real customers, so both are first-class here.
 *
 * `fr` is the source of truth for keys; `en` is typed against it, so a missing
 * English string is a compile error rather than a French word appearing in an
 * English page.
 */

import { billingDict } from "./dict/billing";
import { categoriesDict } from "./dict/categories";
import { chatDict } from "./dict/chat";
import { commonDict } from "./dict/common";
import { custAccountDict } from "./dict/cust-account";
import { custAddressesDict } from "./dict/cust-addresses";
import { custBrowseDict } from "./dict/cust-browse";
import { custCartDict } from "./dict/cust-cart";
import { custFavoritesDict } from "./dict/cust-favorites";
import { custLoyaltyDict } from "./dict/cust-loyalty";
import { custOrdersDict } from "./dict/cust-orders";
import { custProfileDict } from "./dict/cust-profile";
import { custReservationsDict } from "./dict/cust-reservations";
import { custReviewsDict } from "./dict/cust-reviews";
import { custSettingsDict } from "./dict/cust-settings";
import { customersDict } from "./dict/customers";
import { legalDict } from "./dict/legal";
import { marketingDict } from "./dict/marketing";
import { menuDict } from "./dict/menu";
import { mgateDict } from "./dict/mgate";
import { modifiersDict } from "./dict/modifiers";
import { notificationsDict } from "./dict/notifications";
import { profileDict } from "./dict/profile";
import { promotionsDict } from "./dict/promotions";
import { reportsDict } from "./dict/reports";
import { reviewsDict } from "./dict/reviews";
import { settingsDict } from "./dict/settings";
import { setupDict } from "./dict/setup";
import { staffDict } from "./dict/staff";

export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABEL: Record<Locale, string> = {
  fr: "Français",
  en: "English",
};

/** Short label for the toggle. */
export const LOCALE_SHORT: Record<Locale, string> = {
  fr: "FR",
  en: "EN",
};

/**
 * The original single-file dictionary — chrome, marketing, auth, and the
 * screens that predate the split. New screens add a MODULE under ./dict
 * instead of growing this object; see ./define.ts for why.
 */
const baseFr = {
  /* ── Chrome ────────────────────────────────────────────────────────── */
  "nav.home": "Accueil",
  "nav.site": "Site",
  "nav.restaurants": "Restaurants",
  "nav.pricing": "Tarifs",
  "nav.contact": "Contact",
  "nav.login": "Connexion",
  "nav.logout": "Déconnexion",
  "nav.register": "Créer un compte",
  "nav.registerRestaurant": "Inscrire mon restaurant",
  "nav.menu": "Menu",
  "nav.more": "Plus",
  "nav.myArea": "Mon espace",
  "nav.moreTitle": "Mon compte",
  "nav.moreBody": "Toutes vos pages, au même endroit.",
  "nav.cart": "Panier",
  "nav.cartEmpty": "Panier (vide)",
  "nav.openMenu": "Ouvrir le menu",
  "nav.managerNav": "Navigation gérant",
  "nav.viewSite": "Voir",
  "nav.lockedHint": "Indisponible tant que l'abonnement n'est pas réglé",
  "nav.gatedHint": "Disponible à partir de la formule Professional",

  "nav.g.service": "Service",
  "nav.g.menu": "Carte",
  "nav.g.customers": "Clientèle",
  "nav.g.business": "Établissement",

  "nav.m.dashboard": "Tableau de bord",
  "nav.m.orders": "Commandes",
  "nav.m.kitchen": "Cuisine",
  "nav.m.tableOrder": "Commande en salle",
  "nav.m.reservations": "Réservations",
  "nav.m.tables": "Tables",
  "nav.m.messages": "Messages",
  "nav.m.wallet": "Portefeuille",
  "nav.m.menu": "Menu",
  "nav.m.categories": "Catégories",
  "nav.m.promotions": "Promotions",
  "nav.m.customers": "Clients",
  "nav.m.reviews": "Avis",
  "nav.m.reports": "Rapports",
  "nav.m.staff": "Personnel",
  "nav.m.billing": "Abonnement",
  "nav.m.profile": "Profil du restaurant",
  "nav.m.settings": "Paramètres",
  "nav.theme": "Thème",
  "nav.language": "Langue",
  "nav.skipToContent": "Aller au contenu",

  /* ── Footer ────────────────────────────────────────────────────────── */
  "footer.tagline":
    "Commandez vos plats préférés et réservez votre table dans les meilleurs restaurants du Cameroun.",
  "footer.discover": "Découvrir",
  "footer.allRestaurants": "Tous les restaurants",
  "footer.douala": "Douala",
  "footer.topRated": "Les mieux notés",
  "footer.forRestaurants": "Restaurateurs",
  "footer.pricing": "Tarifs",
  "footer.managerArea": "Espace gérant",
  "footer.support": "Assistance",
  "footer.contactUs": "Nous contacter",
  "footer.privacy": "Confidentialité",
  "footer.terms": "Conditions",
  "footer.rights": "Tous droits réservés.",
  "footer.madeIn": "Fait à Douala",

  /* ── Hero ──────────────────────────────────────────────────────────── */
  "hero.order.tag": "Livraison & à emporter",
  "hero.order.titleLead": "Le meilleur de Douala,",
  "hero.order.titleAccent": "livré chez vous",
  "hero.order.subtitle":
    "Poulet DG, ndolé, poisson braisé — commandez auprès des restaurants de votre quartier et suivez votre commande en direct.",
  "hero.book.tag": "Réservation de table",
  "hero.book.titleLead": "Votre table vous",
  "hero.book.titleAccent": "attend",
  "hero.book.subtitle":
    "Choisissez le jour, l'heure et le nombre de convives. Le restaurant confirme, vous n'avez plus qu'à venir.",
  "hero.explore.tag": "Découvrir",
  "hero.explore.titleLead": "Trouvez votre",
  "hero.explore.titleAccent": "prochaine adresse",
  "hero.explore.subtitle":
    "Parcourez les restaurants par quartier, par cuisine et par note. Les avis viennent de vraies commandes.",

  "hero.cta.browse": "Voir les restaurants",
  "hero.cta.register": "Inscrire mon restaurant",
  "hero.trust.rating": "sur 1 240 avis",
  "hero.trust.restaurants": "restaurants",
  "hero.trust.area": "Douala et environs",

  "hero.order.alt": "Un plat coloré servi dans un restaurant de Douala",
  "hero.book.alt": "Une table dressée pour un dîner à deux",
  "hero.explore.alt": "Vue nocturne d'une ville animée",
  "home.alt.dishes": "Assortiment de plats typiques camerounais",
  "home.alt.kitchen": "Cuisine de restaurant en activité",
  "home.alt.branches": "Salle de restaurant avec plusieurs tables",
  "home.alt.payment": "Paiement par téléphone mobile",

  "hero.popular": "Envie de :",
  "hero.mode.order": "Commander",
  "hero.mode.book": "Réserver",
  "hero.mode.explore": "Explorer",
  "hero.modeGroup": "Que voulez-vous faire ?",

  "hero.search.query": "Plat, restaurant ou cuisine",
  "hero.search.queryPlaceholder": "Poulet DG, ndolé, pizza…",
  "hero.search.queryPlaceholderBook": "Nom du restaurant…",
  "hero.search.quartier": "Quartier",
  "hero.search.allDouala": "Tout Douala",
  "hero.search.cuisine": "Cuisine",
  "hero.search.allCuisines": "Toutes",
  "hero.search.guests": "Convives",
  "hero.search.date": "Date",
  "hero.search.submit": "Rechercher",
  "hero.search.submitBook": "Chercher une table",
  "hero.search.noAccount": "Pas besoin de compte pour parcourir et remplir votre panier.",

  "hero.slider.previous": "Diapositive précédente",
  "hero.slider.next": "Diapositive suivante",
  "hero.slider.goTo": "Aller à la diapositive",
  "hero.slider.pause": "Mettre en pause le défilement",
  "hero.slider.play": "Reprendre le défilement",
  "hero.slider.label": "Présentation",

  /* ── Homepage sections ─────────────────────────────────────────────── */
  "home.stats.restaurants": "Restaurants",
  "home.stats.orders": "Commandes livrées",
  "home.stats.rating": "Note moyenne",
  "home.stats.delivery": "Livraison moyenne",

  "home.featured.tag": "À la une",
  "home.featured.title": "Les restaurants du moment",
  "home.featured.subtitle": "Sélectionnés pour leur régularité et leurs avis clients.",
  "home.featured.all": "Voir tout",

  "home.popular.tag": "Populaire",
  "home.popular.title": "Les plats que Douala commande",
  "home.popular.subtitle": "Les valeurs sûres, chez les restaurants qui les font le mieux.",

  "home.how.tag": "Comment ça marche",
  "home.how.title": "Trois étapes, c'est tout",
  "home.how.subtitle": "De la recherche à la livraison, sans appel téléphonique.",
  "home.how.step1.title": "Trouvez",
  "home.how.step1.body":
    "Cherchez par plat, par quartier ou par cuisine. Filtrez par note et par temps de livraison.",
  "home.how.step2.title": "Commandez",
  "home.how.step2.body":
    "Composez votre plat avec les options du restaurant, appliquez un code promo et validez.",
  "home.how.step3.title": "Suivez",
  "home.how.step3.body":
    "Confirmée, en préparation, en route, livrée — le statut avance en direct sur votre écran.",
  "home.how.step": "Étape",

  "home.owners.tag": "Pour les restaurateurs",
  "home.owners.title": "Bien plus qu'une page de commande",
  "home.owners.subtitle":
    "La partie que les autres plateformes ne vous donnent pas : la gestion réelle de votre service.",

  "home.kitchen.title": "Un écran de cuisine qui suit le rythme",
  "home.kitchen.body":
    "Les commandes confirmées apparaissent sans rafraîchir, la plus ancienne en premier, en gros caractères lisibles depuis l'autre bout de la cuisine.",
  "home.kitchen.b1": "Avancement en un seul geste",
  "home.kitchen.b2": "Minuteur par ticket pour repérer les retards",
  "home.kitchen.b3": "Tickets thermiques 80 mm imprimables",
  "home.kitchen.cta": "Essayer",

  "home.branches.title": "Plusieurs établissements, une seule équipe",
  "home.branches.body":
    "Chaque succursale a son menu, son personnel et ses commandes. La même personne peut être propriétaire ici et gérante là-bas, sans deux comptes.",
  "home.branches.b1": "Menu et tarifs propres à chaque adresse",
  "home.branches.b2": "Rôles par succursale : cuisine, caisse, salle",
  "home.branches.b3": "Bascule d'un établissement à l'autre en un clic",
  "home.branches.cta": "Voir les formules",

  "home.payment.title": "Abonnement par Mobile Money",
  "home.payment.body":
    "Réglez votre abonnement depuis votre téléphone avec MTN MoMo ou Orange Money. En cas de retard, une période de grâce vous laisse le temps de payer sans interrompre le service.",
  "home.payment.b1": "MTN Mobile Money et Orange Money",
  "home.payment.b2": "Trois jours de grâce après l'échéance",
  "home.payment.b3": "Factures téléchargeables en PDF",
  "home.payment.cta": "Tarifs et commissions",

  "home.testimonials.tag": "Témoignages",
  "home.testimonials.title": "Ce qu'on en dit",
  "home.testimonials.t1":
    "Je commande au moins deux fois par semaine. Le suivi en direct change tout — je sais quand descendre chercher le livreur.",
  "home.testimonials.t1meta": "Cliente · Bonapriso",
  "home.testimonials.t2":
    "L'écran de cuisine nous a fait gagner un temps fou le vendredi soir. Plus de tickets papier perdus entre la salle et le fourneau.",
  "home.testimonials.t2meta": "Chez Marcel · Akwa",
  "home.testimonials.t3":
    "Pouvoir gérer mes deux adresses depuis le même compte, avec des menus différents, c'est exactement ce qu'il me fallait.",
  "home.testimonials.t3meta": "Le Ndolé d'Or · Bonanjo",

  "home.pricing.tag": "Tarifs",
  "home.pricing.title": "Une formule par taille d'établissement",
  "home.pricing.subtitle": "Sans engagement. Changez ou arrêtez à tout moment.",
  "home.pricing.question": "Une question sur les commissions ?",
  "home.pricing.detail": "Voir le détail des formules",

  "home.faq.tag": "Questions fréquentes",
  "home.faq.title": "Vous vous demandez peut-être…",
  "home.faq.q1": "Faut-il créer un compte pour commander ?",
  "home.faq.a1":
    "Non. Vous pouvez parcourir les restaurants et remplir votre panier sans compte. Il n'est demandé qu'au moment de valider la commande, et votre panier est conservé lors de la connexion.",
  "home.faq.q2": "Comment sont calculés les frais de livraison ?",
  "home.faq.a2":
    "Les frais sont fixés par le restaurant au moment où il confirme votre commande, en fonction de votre quartier. C'est pour cela qu'ils apparaissent comme « à confirmer » lors de la commande plutôt que comme un montant provisoire.",
  "home.faq.q3": "Quels moyens de paiement acceptez-vous ?",
  "home.faq.a3":
    "Pour les commandes : paiement en espèces à la livraison ou directement au restaurant. Pour les abonnements des restaurateurs : MTN Mobile Money et Orange Money.",
  "home.faq.q4": "Je suis restaurateur — combien de temps prend la validation ?",
  "home.faq.a4":
    "Votre inscription est examinée par notre équipe, généralement sous 48 heures. Vous recevez un email dès que votre établissement est validé et visible sur la plateforme.",
  "home.faq.q5": "Puis-je gérer plusieurs établissements ?",
  "home.faq.a5":
    "Oui. Chaque succursale a son propre menu, son équipe et ses commandes, et vous basculez de l'une à l'autre depuis le tableau de bord. Vos collaborateurs peuvent avoir un rôle différent selon l'établissement.",
  "home.faq.q6": "Comment fonctionne le programme de fidélité ?",
  "home.faq.a6":
    "Chaque commande livrée vous rapporte des points, convertibles en réduction sur vos commandes suivantes. Le détail complet de vos points est consultable à tout moment depuis votre compte.",

  "home.cta.title": "Prêt à commander ?",
  "home.cta.body":
    "Parcourez les restaurants de votre quartier. Aucun compte nécessaire pour commencer.",

  /* ── Free-mode banner (home) — the ONLY announcement of the platform
        being free; gated on the flag, with the admin-chosen countdown. ── */
  "home.freeBanner.title": "La plateforme est gratuite pour les restaurants",
  "home.freeBanner.bodyDate":
    "Pendant {days} jour(s) — aucun abonnement requis jusqu'au {date}.",
  "home.freeBanner.bodyDays": "Pendant {days} jour(s) — aucun abonnement requis.",
  "home.freeBanner.body": "Aucun abonnement requis pendant cette période.",

  /* ── Shared UI ─────────────────────────────────────────────────────── */
  "ui.search": "Rechercher…",
  "ui.clear": "Effacer",
  "ui.cancel": "Annuler",
  "ui.confirm": "Confirmer",
  "ui.save": "Enregistrer",
  "ui.close": "Fermer",
  "ui.loading": "Chargement…",
  "ui.noResults": "Aucun résultat",
  "ui.adjustFilters": "Ajustez vos filtres.",
  "ui.viewAll": "Tout voir",
  "ui.open": "Ouvert",
  "ui.closed": "Fermé",
  "ui.min": "min",
  "ui.from": "dès",
  "ui.takeaway": "À emporter",
  "ui.toBeConfirmed": "à confirmer",

  /* ── Restaurants directory ─────────────────────────────────────────── */
  "restaurants.title": "Restaurants",
  "restaurants.subtitle": "Tous les établissements actifs sur RestoLink, à Douala et environs.",
  "restaurants.searchPlaceholder": "Restaurant, plat ou cuisine…",
  "restaurants.sort": "Trier",
  "restaurants.sortRating": "Mieux notés",
  "restaurants.sortDelivery": "Plus rapides",
  "restaurants.sortName": "Nom (A–Z)",
  "restaurants.sortNearMe": "Près de moi",
  "restaurants.nearMeNote": "{quartier} en premier",
  "restaurants.allCuisines": "Toutes cuisines",
  "restaurants.allQuartiers": "Tout Douala",
  "restaurants.allRatings": "Toutes notes",
  "restaurants.rating4": "4 étoiles et +",
  "restaurants.rating3": "3 étoiles et +",
  "restaurants.allBudgets": "Tous budgets",
  "restaurants.budget2000": "Commande min. ≤ 2 000 FCFA",
  "restaurants.budget5000": "Commande min. ≤ 5 000 FCFA",
  "restaurants.allDelays": "Tous délais",
  "restaurants.delay15": "≤ 15 min",
  "restaurants.delay30": "≤ 30 min",
  "restaurants.delay45": "≤ 45 min",
  "restaurants.count_one": "restaurant",
  "restaurants.count_other": "restaurants",
  "restaurants.emptyTitle": "Aucun restaurant ne correspond",
  "restaurants.emptyBody":
    "Essayez un autre quartier, ou élargissez la recherche à toutes les cuisines.",
  "restaurants.reset": "Réinitialiser les filtres",

  /* ── Auth ──────────────────────────────────────────────────────────── */
  "auth.login.title": "Connexion",
  "auth.login.subtitle":
    "Accédez à vos commandes, vos réservations et votre espace restaurant.",
  "auth.email": "Adresse email",
  "auth.password": "Mot de passe",
  "auth.remember": "Rester connecté",
  "auth.forgot": "Mot de passe oublié ?",
  "auth.signIn": "Se connecter",
  "auth.noAccount": "Pas encore de compte ?",
  "auth.createAccount": "Créer un compte",
  "auth.areYouOwner": "Vous êtes restaurateur ?",
  "auth.registerRestaurant": "Inscrire mon établissement",
  "auth.showPassword": "Afficher le mot de passe",
  "auth.hidePassword": "Masquer le mot de passe",
  "auth.name": "Nom complet",
  "auth.phone": "Téléphone",
  "auth.phoneHint": "Le restaurant vous joint sur ce numéro pour la livraison.",
  "auth.createAccountBtn": "Créer mon compte",
  "auth.alreadyHave": "Déjà inscrit ?",
  "auth.signInLink": "Se connecter",
  "auth.checkEmail": "Vérifiez vos emails",
  "auth.accountCreated": "Compte créé",
  "auth.checkEmailBody":
    "Un lien de confirmation vient de vous être envoyé. Cliquez dessus pour activer votre compte, puis connectez-vous.",
  "auth.checkSpam": "Rien reçu au bout de quelques minutes ? Regardez dans vos indésirables.",
  "auth.goToLogin": "Aller à la connexion",
  "auth.register.subtitle":
    "Commandez, réservez et cumulez des points de fidélité. Votre panier en cours est conservé.",
  "auth.acceptTerms1": "J'accepte les",
  "auth.termsLink": "conditions d'utilisation",
  "auth.andPrivacy": "et la",
  "auth.privacyLink": "politique de confidentialité",
  "auth.forgot.title": "Mot de passe oublié",
  "auth.forgot.subtitle":
    "Saisissez votre adresse email. Nous vous envoyons un lien pour en définir un nouveau.",
  "auth.forgot.requested": "Demande enregistrée",
  "auth.forgot.requestedBody":
    "Si un compte existe pour {email}, un lien de réinitialisation vient d'y être envoyé. Il est valable une heure et ne peut servir qu'une fois.",
  "auth.forgot.thisAddress": "cette adresse",
  "auth.forgot.spam": "Rien reçu au bout de quelques minutes ? Regardez dans les indésirables.",
  "auth.forgot.send": "Envoyer le lien",
  "auth.backToLogin": "Retour à la connexion",
  "auth.reset.title": "Nouveau mot de passe",
  "auth.reset.subtitle": "Choisissez un mot de passe que vous n'utilisez nulle part ailleurs.",
  "auth.reset.newPassword": "Nouveau mot de passe",
  "auth.reset.confirm": "Confirmer le mot de passe",
  "auth.reset.mismatch": "Les deux mots de passe ne correspondent pas.",
  "auth.reset.sessionNote":
    "La validation déconnectera toutes vos sessions ouvertes, sur tous vos appareils.",
  "auth.reset.save": "Enregistrer le mot de passe",
  "auth.reset.expired": "Lien expiré",
  "auth.reset.expiredTitle": "Ce lien n'est plus valable",
  "auth.reset.expiredBody":
    "Les liens de réinitialisation expirent au bout d'une heure et ne peuvent servir qu'une seule fois. Demandez-en un nouveau.",
  "auth.reset.requestNew": "Demander un nouveau lien",
  "auth.reset.done": "Mot de passe modifié",
  "auth.reset.doneTitle": "C'est fait",
  "auth.reset.doneBody":
    "Votre mot de passe a été mis à jour. Par sécurité, toutes vos sessions ouvertes ont été déconnectées — y compris sur vos autres appareils.",
  "auth.reason.invalid.title": "Identifiants incorrects",
  "auth.reason.invalid.body":
    "L'adresse email ou le mot de passe ne correspond pas. Vérifiez et réessayez.",
  "auth.reason.pending.title": "Compte en attente de validation",
  "auth.reason.pending.body":
    "Votre compte n'est pas encore activé. Vous recevrez un email dès qu'il le sera.",
  "auth.reason.pending-manager.title": "Restaurant en cours de validation",
  "auth.reason.pending-manager.body":
    "Votre établissement est examiné par notre équipe — généralement sous 48 heures. Nous vous écrivons dès qu'il est validé. Rien à faire de votre côté.",
  "auth.reason.suspended.title": "Compte suspendu",
  "auth.reason.suspended.body":
    "Votre accès a été suspendu. Contactez notre équipe pour en connaître la raison.",
  "auth.pw.min": "8 caractères minimum",
  "auth.pw.upper": "Une majuscule",
  "auth.pw.digit": "Un chiffre",
  "auth.pw.special": "Un caractère spécial",
  "auth.pw.sr": "{met} critère(s) sur {total} respecté(s).",
  "auth.invite.expired": "Invitation expirée",
  "auth.invite.expiredTitle": "Ce lien n'est plus valable",
  "auth.invite.expiredBody":
    "Les invitations expirent au bout de sept jours. Demandez à votre responsable de vous en envoyer une nouvelle.",
  "auth.invite.welcome": "Bienvenue dans l'équipe",
  "auth.invite.accepted": "Invitation acceptée",
  "auth.invite.acceptedBody":
    "Vous faites maintenant partie de l'équipe de {restaurant} — {branch}, avec le rôle {role}.",
  "auth.invite.join": "Rejoindre l'équipe",
  "auth.invite.invitedBy": "Invitation envoyée par {name}",
  "auth.invite.expires": "Cette invitation expire le {date}.",
  "auth.invite.existing": "Un compte existe déjà pour cette adresse",
  "auth.invite.existingBody":
    "Connectez-vous avec {email} pour accepter cette invitation. Nous ne rattachons jamais un compte existant à un établissement sans votre accord explicite.",
  "auth.invite.acceptSignIn": "Se connecter pour accepter",
  "auth.invite.emailHint": "Définie par l'invitation.",
  "auth.invite.namePh": "Nadège Tchoumi",
  "auth.invite.password": "Choisissez votre mot de passe",
  "auth.invite.passwordHint":
    "Vous seul le connaîtrez — il n'est jamais communiqué au restaurant.",
  "auth.invite.accept": "Accepter et rejoindre",
  "auth.panel.eyebrow": "Restaurants · Cameroun",
  "auth.panel.title": "Toute votre activité, d'une seule application.",
  "auth.panel.body":
    "Commandes, cuisine, tables, personnel, abonnement et paiement mobile — au même endroit.",
  "auth.panel.f1": "Multi-établissements",
  "auth.panel.f1body": "Une équipe et un menu par succursale.",
  "auth.panel.f2": "Écran de cuisine",
  "auth.panel.f2body": "Les commandes arrivent sans rafraîchir.",
  "auth.panel.f3": "Paiement mobile",
  "auth.panel.f3body": "MTN MoMo et Orange Money.",

  /* ── Inscription restaurant ────────────────────────────────────────── */
  "reg.title": "Inscrire mon restaurant",
  "reg.subtitle": "Quatre étapes courtes. La validation prend moins de 48 heures.",
  "reg.step.you": "Vous",
  "reg.step.place": "Établissement",
  "reg.step.location": "Emplacement",
  "reg.step.review": "Vérification",
  "reg.back": "Retour",
  "reg.continue": "Continuer",
  "reg.submit": "Envoyer ma demande",
  "reg.haveAccount": "Vous avez déjà un compte ?",
  "reg.signIn": "Se connecter",

  "reg.ownerName": "Votre nom",
  "reg.ownerNamePh": "Paul Mbarga",
  "reg.yourEmail": "Votre email",
  "reg.yourEmailPh": "vous@restaurant.cm",
  "reg.yourPhone": "Votre téléphone",
  "reg.password": "Mot de passe",

  "reg.restaurantName": "Nom du restaurant",
  "reg.restaurantNamePh": "Chez Marcel",
  "reg.description": "Description",
  "reg.descriptionHint": "Deux phrases suffisent. C'est ce que les clients lisent en premier.",
  "reg.descriptionPh": "La cuisine camerounaise de tous les jours, préparée au feu de bois…",
  "reg.laterNote":
    "Le type de cuisine, votre logo et vos horaires se règlent depuis votre tableau de bord une fois le compte validé.",

  "reg.city": "Ville",
  "reg.choose": "Choisir…",
  "reg.quartier": "Quartier",
  "reg.quartierHint": "Choisissez dans la liste, ou saisissez votre quartier s'il n'y figure pas.",
  "reg.quartierPickCity": "Choisissez d'abord votre ville.",
  "reg.address": "Adresse complète",
  "reg.addressPh": "Boulevard de la Liberté, face BICEC",
  "reg.restaurantPhone": "Téléphone du restaurant",
  "reg.restaurantPhoneHint": "Le numéro affiché aux clients.",

  "reg.review.owner": "Responsable",
  "reg.review.email": "Email",
  "reg.review.phone": "Téléphone",
  "reg.review.restaurant": "Restaurant",
  "reg.terms1": "J'accepte les",
  "reg.termsLink": "conditions d'utilisation",
  "reg.terms2": "et je certifie être autorisé à inscrire cet établissement.",
  "reg.fixErrors": "Corrigez ces champs avant d'envoyer :",
  "reg.goToStep": "Corriger",

  "reg.done.title": "Demande envoyée",
  "reg.done.heading": "Nous avons bien reçu votre inscription",
  "reg.done.body": "Votre établissement {name} est en cours d'examen par notre équipe.",
  "reg.done.s1": "Demande enregistrée",
  "reg.done.s1body": "Votre dossier est enregistré au nom de {email}.",
  "reg.done.s2": "Validation par notre équipe",
  "reg.done.s2body": "Généralement sous 48 heures ouvrées. Vous n'avez rien à faire.",
  "reg.done.s3": "Mise en ligne",
  "reg.done.s3body": "Dès validation, vous pouvez vous connecter et composer votre menu.",
  "reg.done.home": "Retour à l'accueil",
  "reg.done.question": "Une question sur ma demande ?",

  "reg.closed.title": "Les inscriptions sont fermées",
  "reg.closed.body":
    "Aucune ville n'accepte de nouvelles inscriptions pour le moment. Écrivez-nous et nous vous préviendrons dès l'ouverture de la vôtre.",

  /* ── Pricing cards ─────────────────────────────────────────────────── */
  "plan.mostChosen": "Le plus choisi",

  /* -- Commun ------------------------------------------------------- */
  "common.cancel": "Annuler",
  "common.add": "Ajouter",
  "common.edit": "Modifier",
  "common.error": "Une erreur est survenue.",

  /* -- Reservations -------------------------------------------------- */
  "m.reservations.title": "Réservations",
  "m.reservations.subtitle": "Les demandes à confirmer d'abord, puis le service à venir.",
  "res.status.pending": "À confirmer",
  "res.status.awaiting_payment": "Acompte en attente",
  "res.status.confirmed": "Confirmée",
  "res.status.seated": "Installée",
  "res.status.completed": "Terminée",
  "res.status.cancelled": "Refusée",
  "res.status.no_show": "Non présentée",
  "res.table": "Table",
  "res.declined": "Refusée :",
  "res.decline": "Refuser",
  "res.seat": "Installer",
  "res.noShow": "Absent",
  "res.complete": "Terminer",
  "res.seatedDone": "Client installé.",
  "res.noShowDone": "Marquée non présentée.",
  "res.completedDone": "Réservation terminée.",
  "res.confirmedDone": "Réservation confirmée.",
  "res.declinedDone": "Réservation refusée.",
  "res.awaiting": "À confirmer ({count})",
  "res.upcoming": "Service à venir",
  "res.nothingPlanned": "Rien de prévu",
  "res.nothingPlannedBody": "Les réservations confirmées apparaissent ici, dans l'ordre du service.",
  "res.confirmTitle": "Confirmer la réservation",
  "res.declineTitle": "Refuser la réservation",
  "res.tableHint": "Facultatif — vous pourrez l'attribuer à l'arrivée.",
  "res.noTableYet": "Pas encore attribuée",
  "res.reason": "Motif",
  "res.deposit": "Acompte {amount} FCFA",
  "res.depositPercent": "Acompte {pct}% de l'addition",
  "res.depositPaid": "Acompte encaissé",
  "res.release": "Libérer la table",
  "res.collectDeposit": "Encaisser l'acompte",
  "res.depositCollected": "Acompte crédité au portefeuille.",
  "res.depositTitle": "Acompte de réservation",
  "res.depositBody": "Montant demandé pour réserver une table (0 = aucun). L'encaissement crédite le portefeuille.",
  "res.depositSaved": "Acompte enregistré.",
  "res.percentTitle": "Acompte en pourcentage",
  "res.percentBody": "Pourcentage de l'addition finale encaissé au restaurant (0 = aucun). Le client ne paie rien en ligne.",
  "res.perSeatTitle": "Acompte par convive",
  "res.perSeatBody": "Montant par convive, multiplié par le nombre de personnes (0 = aucun). Le client le paie en ligne au moment de réserver.",
  "res.depositKind": "Type d'acompte",
  "res.kindFixed": "Montant fixe",
  "res.kindPerSeat": "Par convive",
  "res.kindPercent": "% de l'addition",
  "res.billTotal": "Montant de l'addition",
  "res.billTotalHint": "L'acompte sera calculé à partir de ce montant.",
  "res.billTotalPh": "Ex. 15 000",
  "res.collectPercent": "Encaisser {amount}",
  "res.percentCollected": "Acompte {pct}% crédité au portefeuille.",
  "res.reasonHint": "Le client le lit. Une phrase suffit — un refus sans explication est ce dont les clients se plaignent.",
  "res.reasonPh": "Complet à cette heure. Nous avons de la place à 20h30 si cela vous convient.",

  /* -- Tables -------------------------------------------------------- */
  "tbl.new": "Nouvelle table",
  "tbl.number": "Numéro",
  "tbl.numberHint": "Ce que le personnel lit sur le ticket. « 12 », « T4 », « Terrasse 2 »…",
  "tbl.capacity": "Nombre de places",
  "tbl.status.available": "Libre",
  "tbl.status.occupied": "Occupée",
  "tbl.status.reserved": "Réservée",
  "tbl.status.out_of_service": "Hors service",
  "tbl.statusOf": "Statut de la table",
  "tbl.updated": "mise à jour",
  "tbl.saved": "Table enregistrée.",
  "tbl.added": "Table ajoutée.",
  "tbl.emptyBody": "Ajoutez vos tables pour prendre des commandes en salle et gérer les réservations.",
  "tbl.limitReached": "Limite atteinte : {used} / {limit} tables.",
  "tbl.limitBody": "Vos tables existantes restent utilisables.",
  "tbl.changePlan": "Changer de formule",
  "tbl.planLimit": "Limite de la formule atteinte",
  "common.save": "Enregistrer",
  "common.confirm": "Confirmer",
  "common.delete": "Supprimer",
  "common.close": "Fermer",
  "common.all": "Tous",
  "common.myProfile": "Mon profil",

  "logout.title": "Se déconnecter ?",
  "logout.message": "Vous devrez saisir à nouveau votre mot de passe pour revenir. Si un service est en cours, gardez la session ouverte.",

  /* -- Espace restaurant -------------------------------------------- */
  "m.dashboard": "Tableau de bord",
  "m.greeting": "Bonjour, {name}",
  "m.pending.title": "Votre établissement est en cours de validation.",
  "m.pending.body": "Préparez votre carte dès maintenant : elle sera publiée dès l'approbation.",
  "m.paused.body": "Vous n'acceptez pas de commandes en ce moment. Les clients voient votre page mais ne peuvent pas commander.",

  "m.stat.ordersToday": "Commandes aujourd'hui",
  "m.stat.revenueToday": "Recettes aujourd'hui",
  "m.stat.revenueHint": "Commandes confirmées uniquement.",
  "m.stat.revenuePending": "{count} commande(s) en attente de votre confirmation, non comptée(s).",
  "m.stat.inProgress": "En cours",
  "m.stat.inProgressHint": "À confirmer, en préparation ou en route.",
  "m.stat.rating": "Note moyenne",
  "m.stat.reviews": "{count} avis",
  "m.stat.noReviews": "Aucun avis pour le moment.",

  "m.reservations.toConfirm": "Réservations à confirmer",
  "m.reservations.none": "Rien à décider",
  "m.reservations.noneBody": "Les demandes de réservation arrivent ici.",
  "m.viewAll": "Tout voir",
  "m.people": "{count} personne(s)",

  "m.menu.yours": "Votre carte",
  "m.menu.manage": "Gérer",
  "m.menu.empty": "Votre carte est vide",
  "m.menu.emptyBody": "Ajoutez vos plats — c'est la première chose que vos clients cherchent.",
  "m.menu.addDish": "Ajouter un plat",
  "m.menu.dishes": "Plats",
  "m.menu.unavailable": "Indisponibles",
  "m.menu.lowStock": "Stock bas",
  "m.menu.lowStockAlert": "{count} plat(s) sous le seuil d'alerte.",

  "m.team.count": "{count} membre(s) dans l'équipe",
  "m.team.body": "Chacun n'accède qu'à ce que son rôle autorise, succursale par succursale.",
  "m.team.manage": "Gérer l'équipe",

  "m.attention.title": "Autres points à traiter",
  "m.attention.urgentTitle": "Des clients attendent votre réponse",

  /* -- Terminer la configuration ---------------------------------------- */
  "m.welcome.title": "Bienvenue !",
  "m.welcome.body":
    "Votre restaurant est configuré. Il reste quelques éléments pour que votre page donne vraiment envie — nous vous y emmenons.",
  "m.welcome.dismiss": "Plus tard",
  "m.setup.title": "Terminez la configuration de votre page",
  "m.setup.body":
    "Rien d'obligatoire ici : votre restaurant fonctionne déjà. Mais chaque élément ajouté rend votre page plus attirante pour les clients.",
  "m.setup.doneTitle": "Votre page est complète",
  "m.setup.doneBody": "Tout y est. Vous pouvez modifier ces éléments à tout moment depuis votre profil.",
  "m.setup.logo": "Ajouter votre logo",
  "m.setup.logoBody": "C'est l'image qui vous représente dans les listes. Sans elle, votre carte reste grise.",
  "m.setup.cover": "Ajouter une photo de couverture",
  "m.setup.coverBody": "La grande image en haut de votre page. Une photo de votre salle ou de vos plats.",
  "m.setup.description": "Décrire votre restaurant",
  "m.setup.descriptionBody": "Deux phrases sur ce que vous servez et ce qui vous distingue.",
  "m.setup.cuisine": "Choisir votre type de cuisine",
  "m.setup.cuisineBody": "C'est ainsi que les clients vous trouvent dans les filtres.",
  "m.setup.menu": "Ajouter des plats",
  "m.setup.menuBody": "Une carte vide ne reçoit aucune commande.",
  "m.setup.tables": "Ajouter vos tables",
  "m.setup.tablesBody": "Nécessaire pour les réservations et le service sur place.",
  "m.setup.hours": "Définir vos horaires",
  "m.setup.hoursBody": "Sans horaires, votre page affiche « fermé » en permanence.",
  "m.setup.later": "Vous pouvez revenir ici quand vous voulez.",
  "m.setup.go": "Ouvrir mon profil",
  "m.setup.deliveryLabel": "Nous proposons la livraison",
  "m.setup.deliveryOwnHint": "Vos propres livreurs. Vous fixez les frais à la confirmation de chaque commande.",
  "m.setup.deliveryPlatformHint": "La plateforme gère la livraison et les frais sont fixés par l'administrateur.",
  "m.setup.deliveryOffHint": "Vente à emporter et sur place uniquement. Aucun client ne verra d'option de livraison.",
  "m.setup.deliveryOn": "Livraison activée.",
  "m.setup.deliveryOff": "Livraison désactivée.",
  "m.setup.deliverySettings": "Frais et zone de livraison",
  "m.attention.orders": "{count} commande(s) à traiter",
  "m.attention.reservations": "{count} réservation(s) à confirmer",
  "m.attention.lowStock": "{count} plat(s) en stock bas",
  "m.attention.reviews": "{count} avis sans réponse",
  "m.attention.empty": "Tout est à jour",
  "m.attention.emptyBody": "Aucune action requise pour le moment.",

  /* -- Commandes ----------------------------------------------------- */
  "m.orders.title": "Commandes",
  "m.orders.subtitle": "La file du service, la plus urgente en premier.",
  "m.orders.none": "Aucune commande",
  "m.orders.noneBody": "Les commandes de vos clients arrivent ici, en direct.",
  "m.orders.search": "Référence, client ou téléphone…",
  "m.orders.type": "Type",
  "m.orders.status": "Statut",
  "m.orders.confirm": "Confirmer",
  "m.orders.prepare": "En préparation",
  "m.orders.ship": "Envoyer",
  "m.orders.deliver": "Livrée",
  "m.orders.cancel": "Annuler",
  "m.orders.setFee": "Frais de livraison",
  "m.orders.feePrompt": "Indiquez le montant réel de la livraison. Le client le voit avant de confirmer.",
  "m.orders.cancelReason": "Motif de l'annulation",
  "m.orders.cancelHint": "Le client le lit. Une annulation sans motif est ce dont les clients se plaignent.",
  "m.orders.items": "Articles",
  "m.orders.customer": "Client",
  "m.orders.total": "Total",
  "m.orders.print": "Imprimer le ticket",

  /* -- Cuisine ------------------------------------------------------- */
  "m.kitchen.title": "Écran de cuisine",
  "m.kitchen.none": "Rien à préparer",
  "m.kitchen.noneBody": "Les commandes confirmées apparaissent ici automatiquement.",
  "m.kitchen.new": "Nouvelles",
  "m.kitchen.cooking": "En cuisson",
  "m.kitchen.ready": "Prêtes",
  "m.kitchen.start": "Commencer",
  "m.kitchen.done": "Terminé",

  /* -- Commande en salle --------------------------------------------- */
  "m.tableOrder.title": "Commande en salle",
  "m.tableOrder.subtitle": "Prenez la commande à la table, encaissez ensuite.",
  "m.tableOrder.pickTable": "Choisir une table",
  "m.tableOrder.noTables": "Aucune table",
  "m.tableOrder.noTablesBody": "Créez vos tables pour prendre des commandes en salle.",
  "m.tableOrder.cart": "Commande",
  "m.tableOrder.empty": "Aucun article",
  "m.tableOrder.send": "Envoyer en cuisine",

  "m.tables.title": "Tables",
  "m.tables.seats": "{count} place(s)",
  "m.tables.occupied": "{seated} sur {capacity} places",

  "m.wallet.title": "Portefeuille",

  "m.noBranch.title": "Aucun établissement associé",
  "m.noBranch.body":
    "Bonjour {name}. Votre compte est bien actif, mais il n'est rattaché à aucun restaurant pour le moment.",
  "m.noBranch.admin":
    "Vous êtes administrateur : passez par /a/impersonate pour ouvrir le tableau de bord d'un restaurant.",
  "m.noBranch.pending": "Votre demande d'inscription est peut-être encore en cours de validation.",
  "m.noBranch.removed": "Ou le propriétaire vous a retiré de l'équipe. Demandez-lui de vous inviter à nouveau.",
  "m.noBranch.choose": "Choisir un restaurant",
  "m.noBranch.support": "Contacter le support",
  "m.noBranch.home": "Retour à l'accueil",

  /* -- Statuts de commande ------------------------------------------- */
  "order.status.pending": "En attente",
  "order.status.confirmed": "Confirmée",
  "order.status.preparing": "En préparation",
  "order.status.shipped": "En livraison",
  "order.status.delivered": "Livrée",
  "order.status.cancelled": "Annulée",
  "order.statusDesc.pending": "Le restaurant n'a pas encore confirmé votre commande.",
  "order.statusDesc.confirmed": "Le restaurant a accepté votre commande.",
  "order.statusDesc.preparing": "Votre commande est en cuisine.",
  "order.statusDesc.shipped": "Votre commande est en route.",
  "order.statusDesc.delivered": "Commande livrée. Bon appétit !",
  "order.statusDesc.cancelled": "Cette commande a été annulée.",
  "order.next.confirmed": "Confirmer",
  "order.next.preparing": "Commencer",
  "order.next.shipped": "Envoyer",
  "order.next.delivered": "Marquer livrée",
  "order.type.delivery": "Livraison",
  "order.type.pickup": "À emporter",
  "order.type.dine_in": "Sur place",
  "order.pay.cash_on_delivery": "Espèces à la livraison",
  "order.pay.pay_at_restaurant": "Paiement au restaurant",
  "order.pay.mobile_money": "Mobile Money",
  "order.paid": "Payée",
  "order.unpaid": "Non payée",

  /* -- File des commandes -------------------------------------------- */
  "mo.filter.active": "En cours",
  "mo.filter.pending": "À confirmer",
  "mo.filter.preparing": "En préparation",
  "mo.filter.shipped": "En livraison",
  "mo.filter.all": "Toutes",
  "mo.ago": "il y a {elapsed}",
  "mo.scheduled": "Programmée",
  "mo.scheduledFor": "Prévue pour {time}",
  "mo.feeMissing": "+ livraison à saisir",
  "mo.detail": "Détail",
  "mo.ticket": "Ticket",
  "mo.updated": "Commande mise à jour.",
  "mo.cancelled": "Commande annulée.",
  "mo.cancelTitle": "Annuler la commande",
  "mo.table": "Table",
  "mo.notes": "Note",
  "mo.history": "Historique",
  "mo.by": "par {name}",
  "mo.subtotal": "Sous-total",
  "mo.serviceCharge": "Frais de service",
  "mo.deliveryFee": "Livraison",
  "mo.discount": "Remise",
  "mo.feeTBD": "à confirmer",
  "mo.notFound": "Commande introuvable",
  "mo.notFoundBody": "Elle n'existe pas ou appartient à une autre succursale.",
  "mo.backToOrders": "Retour aux commandes",
  "mo.placedAt": "Passée le",
  "mo.cancelledReason": "Motif d'annulation :",

  /* -- Frais de livraison --------------------------------------------- */
  "fee.title": "Frais de livraison",
  "fee.order": "Commande {ref}",
  "fee.amount": "Montant (FCFA)",
  "fee.newTotal": "Nouveau total client",
  "fee.confirm": "Confirmer la commande",
  "fee.hint": "Le client voit ce total avant que la commande soit acceptée.",
  "fee.band":
    "Vous annoncez des frais entre {min} et {max}. Le client a vu ces montants avant de commander.",
  "fee.bandFrom": "Vous annoncez des frais à partir de {min}. Le client a vu ce montant avant de commander.",
  "fee.overMax": "Au-dessus de votre maximum annoncé ({max}). Modifiez-le dans votre profil ou baissez ce montant.",

  /* -- Cuisine --------------------------------------------------------- */
  "mk.back": "Retour au tableau de bord",
  "mk.tickets": "ticket(s)",
  "mk.allServed": "Tout est servi",
  "mk.allServedBody": "Les nouvelles commandes apparaîtront ici automatiquement.",
  "mk.inProgress": "En cours",
  "mk.toStart": "À commencer",

  /* -- Commande en salle ---------------------------------------------- */
  "mt.table": "Table",
  "mt.pickFirst": "Choisissez d'abord une table",
  "mt.search": "Rechercher un plat…",
  "mt.ticket": "Ticket",
  "mt.emptyTicket": "Ticket vide",
  "mt.emptyTicketBody": "Touchez un plat pour l'ajouter.",
  "mt.pickTableBody": "Sélectionnez la table qui commande.",
  "mt.clear": "Vider le ticket",
  "mt.notesPh": "Note pour la cuisine…",
  "mt.sent": "Commande {ref} envoyée en cuisine — table {table}.",
  "mt.soldOut": "Épuisé",
  "mt.seatsShort": "{count} pl.",
  "mt.guests": "Convives",
  "mt.guestsHint": "Combien de personnes à cette table ?",

  "plan.freeForever": "gratuit, pour toujours",
  "plan.trial": "{days} jours d'essai gratuit",
  "plan.desc.starter": "Pour démarrer et mettre votre carte en ligne, sans rien payer.",
  "plan.desc.professional": "Pour un restaurant qui tourne : plus de plats, plus de tables, moins de commission.",
  "plan.desc.enterprise": "Sans limites, et la commission la plus basse. Pour plusieurs établissements.",
  "plan.perMonth": "par mois et par établissement",
  "plan.start": "Commencer",
  "plan.menuItems": "plats au menu",
  "plan.tables": "tables",
  "plan.promotions": "promotion(s) active(s)",
  "plan.staff": "Gestion du personnel",
  "plan.analytics": "Rapports et analytique",
  "plan.commission": "Commission de",
  "plan.kitchen": "Écran de cuisine",
  "plan.mobileMoney": "Paiement mobile (MoMo, OM)",
} as const;

const baseEn: Record<keyof typeof baseFr, string> = {
  /* ── Chrome ────────────────────────────────────────────────────────── */
  "nav.home": "Home",
  "nav.site": "Site",
  "nav.restaurants": "Restaurants",
  "nav.pricing": "Pricing",
  "nav.contact": "Contact",
  "nav.login": "Sign in",
  "nav.logout": "Sign out",
  "nav.register": "Create account",
  "nav.registerRestaurant": "List my restaurant",
  "nav.menu": "Menu",
  "nav.more": "More",
  "nav.myArea": "My area",
  "nav.moreTitle": "My account",
  "nav.moreBody": "All your pages, in one place.",
  "nav.cart": "Cart",
  "nav.cartEmpty": "Cart (empty)",
  "nav.openMenu": "Open the menu",
  "nav.managerNav": "Restaurant navigation",
  "nav.viewSite": "View",
  "nav.lockedHint": "Unavailable until the subscription is settled",
  "nav.gatedHint": "Available from the Professional plan",

  "nav.g.service": "Service",
  "nav.g.menu": "Menu",
  "nav.g.customers": "Customers",
  "nav.g.business": "Business",

  "nav.m.dashboard": "Dashboard",
  "nav.m.orders": "Orders",
  "nav.m.kitchen": "Kitchen",
  "nav.m.tableOrder": "Table order",
  "nav.m.reservations": "Reservations",
  "nav.m.tables": "Tables",
  "nav.m.messages": "Messages",
  "nav.m.wallet": "Wallet",
  "nav.m.menu": "Menu",
  "nav.m.categories": "Categories",
  "nav.m.promotions": "Promotions",
  "nav.m.customers": "Customers",
  "nav.m.reviews": "Reviews",
  "nav.m.reports": "Reports",
  "nav.m.staff": "Staff",
  "nav.m.billing": "Subscription",
  "nav.m.profile": "Restaurant profile",
  "nav.m.settings": "Settings",
  "nav.theme": "Theme",
  "nav.language": "Language",
  "nav.skipToContent": "Skip to content",

  /* ── Footer ────────────────────────────────────────────────────────── */
  "footer.tagline":
    "Order your favourite dishes and book a table at the best restaurants in Cameroon.",
  "footer.discover": "Discover",
  "footer.allRestaurants": "All restaurants",
  "footer.douala": "Douala",
  "footer.topRated": "Top rated",
  "footer.forRestaurants": "For restaurants",
  "footer.pricing": "Pricing",
  "footer.managerArea": "Manager sign-in",
  "footer.support": "Support",
  "footer.contactUs": "Contact us",
  "footer.privacy": "Privacy",
  "footer.terms": "Terms",
  "footer.rights": "All rights reserved.",
  "footer.madeIn": "Made in Douala",

  /* ── Hero ──────────────────────────────────────────────────────────── */
  "hero.order.tag": "Delivery & takeaway",
  "hero.order.titleLead": "The best of Douala,",
  "hero.order.titleAccent": "delivered to you",
  "hero.order.subtitle":
    "Poulet DG, ndolé, grilled fish — order from restaurants in your neighbourhood and follow your order live.",
  "hero.book.tag": "Table booking",
  "hero.book.titleLead": "Your table is",
  "hero.book.titleAccent": "waiting",
  "hero.book.subtitle":
    "Pick the day, the time and how many of you. The restaurant confirms — all you have to do is turn up.",
  "hero.explore.tag": "Discover",
  "hero.explore.titleLead": "Find your",
  "hero.explore.titleAccent": "next favourite",
  "hero.explore.subtitle":
    "Browse restaurants by neighbourhood, cuisine and rating. Every review comes from a real order.",

  "hero.cta.browse": "Browse restaurants",
  "hero.cta.register": "List my restaurant",
  "hero.trust.rating": "from 1,240 reviews",
  "hero.trust.restaurants": "restaurants",
  "hero.trust.area": "Douala and around",

  "hero.order.alt": "A colourful dish served in a Douala restaurant",
  "hero.book.alt": "A table laid for dinner for two",
  "hero.explore.alt": "A night view of a busy city",
  "home.alt.dishes": "An assortment of classic Cameroonian dishes",
  "home.alt.kitchen": "A restaurant kitchen in service",
  "home.alt.branches": "A restaurant dining room with several tables",
  "home.alt.payment": "Paying by mobile phone",

  "hero.popular": "Craving:",
  "hero.mode.order": "Order",
  "hero.mode.book": "Book",
  "hero.mode.explore": "Explore",
  "hero.modeGroup": "What would you like to do?",

  "hero.search.query": "Dish, restaurant or cuisine",
  "hero.search.queryPlaceholder": "Poulet DG, ndolé, pizza…",
  "hero.search.queryPlaceholderBook": "Restaurant name…",
  "hero.search.quartier": "Neighbourhood",
  "hero.search.allDouala": "All of Douala",
  "hero.search.cuisine": "Cuisine",
  "hero.search.allCuisines": "All",
  "hero.search.guests": "Guests",
  "hero.search.date": "Date",
  "hero.search.submit": "Search",
  "hero.search.submitBook": "Find a table",
  "hero.search.noAccount": "No account needed to browse and fill your cart.",

  "hero.slider.previous": "Previous slide",
  "hero.slider.next": "Next slide",
  "hero.slider.goTo": "Go to slide",
  "hero.slider.pause": "Pause the slideshow",
  "hero.slider.play": "Resume the slideshow",
  "hero.slider.label": "Highlights",

  /* ── Homepage sections ─────────────────────────────────────────────── */
  "home.stats.restaurants": "Restaurants",
  "home.stats.orders": "Orders delivered",
  "home.stats.rating": "Average rating",
  "home.stats.delivery": "Average delivery",

  "home.featured.tag": "Featured",
  "home.featured.title": "Restaurants of the moment",
  "home.featured.subtitle": "Picked for their consistency and their customer reviews.",
  "home.featured.all": "View all",

  "home.popular.tag": "Popular",
  "home.popular.title": "What Douala is ordering",
  "home.popular.subtitle": "The reliable favourites, from the places that do them best.",

  "home.how.tag": "How it works",
  "home.how.title": "Three steps, that's it",
  "home.how.subtitle": "From search to delivery, without a single phone call.",
  "home.how.step1.title": "Find",
  "home.how.step1.body":
    "Search by dish, neighbourhood or cuisine. Filter by rating and delivery time.",
  "home.how.step2.title": "Order",
  "home.how.step2.body":
    "Build your dish with the restaurant's own options, apply a promo code and confirm.",
  "home.how.step3.title": "Track",
  "home.how.step3.body":
    "Confirmed, preparing, on the way, delivered — the status advances live on your screen.",
  "home.how.step": "Step",

  "home.owners.tag": "For restaurant owners",
  "home.owners.title": "Far more than an order page",
  "home.owners.subtitle":
    "The part other platforms don't give you: actually running your service.",

  "home.kitchen.title": "A kitchen display that keeps up",
  "home.kitchen.body":
    "Confirmed orders appear without a refresh, oldest first, in large type you can read from across the kitchen.",
  "home.kitchen.b1": "Advance an order in one tap",
  "home.kitchen.b2": "Per-ticket timer so you spot the late ones",
  "home.kitchen.b3": "Printable 80 mm thermal tickets",
  "home.kitchen.cta": "Try it",

  "home.branches.title": "Several locations, one team",
  "home.branches.body":
    "Each branch has its own menu, staff and orders. The same person can be owner here and manager there, without two accounts.",
  "home.branches.b1": "Menu and prices per location",
  "home.branches.b2": "Roles per branch: kitchen, till, floor",
  "home.branches.b3": "Switch between locations in one click",
  "home.branches.cta": "See the plans",

  "home.payment.title": "Pay your subscription with Mobile Money",
  "home.payment.body":
    "Settle your subscription from your phone with MTN MoMo or Orange Money. If you're late, a grace period gives you time to pay without interrupting service.",
  "home.payment.b1": "MTN Mobile Money and Orange Money",
  "home.payment.b2": "Three days of grace after the due date",
  "home.payment.b3": "Invoices downloadable as PDF",
  "home.payment.cta": "Pricing and commission",

  "home.testimonials.tag": "Testimonials",
  "home.testimonials.title": "What people say",
  "home.testimonials.t1":
    "I order at least twice a week. Live tracking changes everything — I know exactly when to go down and meet the rider.",
  "home.testimonials.t1meta": "Customer · Bonapriso",
  "home.testimonials.t2":
    "The kitchen display saved us so much time on Friday nights. No more paper tickets lost between the floor and the stove.",
  "home.testimonials.t2meta": "Chez Marcel · Akwa",
  "home.testimonials.t3":
    "Running both of my locations from one account, with different menus, is exactly what I needed.",
  "home.testimonials.t3meta": "Le Ndolé d'Or · Bonanjo",

  "home.pricing.tag": "Pricing",
  "home.pricing.title": "A plan for every size of restaurant",
  "home.pricing.subtitle": "No commitment. Change or cancel at any time.",
  "home.pricing.question": "A question about commission?",
  "home.pricing.detail": "See the full plan comparison",

  "home.faq.tag": "Frequently asked",
  "home.faq.title": "You might be wondering…",
  "home.faq.q1": "Do I need an account to order?",
  "home.faq.a1":
    "No. You can browse restaurants and fill your cart without an account. It's only asked for at checkout, and your cart is kept when you sign in.",
  "home.faq.q2": "How is the delivery fee calculated?",
  "home.faq.a2":
    "The fee is set by the restaurant when it confirms your order, based on your neighbourhood. That's why it shows as \"to be confirmed\" while ordering rather than as a provisional amount.",
  "home.faq.q3": "Which payment methods do you accept?",
  "home.faq.a3":
    "For orders: cash on delivery, or payment at the restaurant. For restaurant subscriptions: MTN Mobile Money and Orange Money.",
  "home.faq.q4": "I run a restaurant — how long does approval take?",
  "home.faq.a4":
    "Your application is reviewed by our team, usually within 48 hours. You'll get an email as soon as your restaurant is approved and visible on the platform.",
  "home.faq.q5": "Can I manage several locations?",
  "home.faq.a5":
    "Yes. Each branch has its own menu, staff and orders, and you switch between them from the dashboard. Your colleagues can hold a different role at each location.",
  "home.faq.q6": "How does the loyalty programme work?",
  "home.faq.a6":
    "Every delivered order earns you points, redeemable as a discount on later orders. The full breakdown of your points is available in your account at any time.",

  "home.cta.title": "Ready to order?",
  "home.cta.body": "Browse the restaurants in your neighbourhood. No account needed to start.",

  /* ── Free-mode banner (home) — the ONLY announcement of the platform
        being free; gated on the flag, with the admin-chosen countdown. ── */
  "home.freeBanner.title": "The platform is free for restaurants",
  "home.freeBanner.bodyDate":
    "For {days} day(s) — no subscription required until {date}.",
  "home.freeBanner.bodyDays": "For {days} day(s) — no subscription required.",
  "home.freeBanner.body": "No subscription is required during this period.",

  /* ── Shared UI ─────────────────────────────────────────────────────── */
  "ui.search": "Search…",
  "ui.clear": "Clear",
  "ui.cancel": "Cancel",
  "ui.confirm": "Confirm",
  "ui.save": "Save",
  "ui.close": "Close",
  "ui.loading": "Loading…",
  "ui.noResults": "No results",
  "ui.adjustFilters": "Adjust your filters.",
  "ui.viewAll": "View all",
  "ui.open": "Open",
  "ui.closed": "Closed",
  "ui.min": "min",
  "ui.from": "from",
  "ui.takeaway": "Takeaway",
  "ui.toBeConfirmed": "to be confirmed",

  /* ── Restaurants directory ─────────────────────────────────────────── */
  "restaurants.title": "Restaurants",
  "restaurants.subtitle": "Every active restaurant on RestoLink, in Douala and around.",
  "restaurants.searchPlaceholder": "Restaurant, dish or cuisine…",
  "restaurants.sort": "Sort",
  "restaurants.sortRating": "Top rated",
  "restaurants.sortDelivery": "Fastest",
  "restaurants.sortName": "Name (A–Z)",
  "restaurants.sortNearMe": "Near me",
  "restaurants.nearMeNote": "{quartier} first",
  "restaurants.allCuisines": "All cuisines",
  "restaurants.allQuartiers": "All of Douala",
  "restaurants.allRatings": "Any rating",
  "restaurants.rating4": "4 stars and up",
  "restaurants.rating3": "3 stars and up",
  "restaurants.allBudgets": "Any budget",
  "restaurants.budget2000": "Min. order ≤ 2,000 FCFA",
  "restaurants.budget5000": "Min. order ≤ 5,000 FCFA",
  "restaurants.allDelays": "Any time",
  "restaurants.delay15": "≤ 15 min",
  "restaurants.delay30": "≤ 30 min",
  "restaurants.delay45": "≤ 45 min",
  "restaurants.count_one": "restaurant",
  "restaurants.count_other": "restaurants",
  "restaurants.emptyTitle": "No restaurant matches",
  "restaurants.emptyBody": "Try another neighbourhood, or widen the search to all cuisines.",
  "restaurants.reset": "Reset filters",

  /* ── Auth ──────────────────────────────────────────────────────────── */
  "auth.login.title": "Sign in",
  "auth.login.subtitle": "Access your orders, your bookings and your restaurant dashboard.",
  "auth.email": "Email address",
  "auth.password": "Password",
  "auth.remember": "Stay signed in",
  "auth.forgot": "Forgot your password?",
  "auth.signIn": "Sign in",
  "auth.noAccount": "No account yet?",
  "auth.createAccount": "Create an account",
  "auth.areYouOwner": "Do you run a restaurant?",
  "auth.registerRestaurant": "List my restaurant",
  "auth.showPassword": "Show password",
  "auth.hidePassword": "Hide password",
  "auth.name": "Full name",
  "auth.phone": "Phone",
  "auth.phoneHint": "The restaurant calls you on this number for delivery.",
  "auth.createAccountBtn": "Create my account",
  "auth.alreadyHave": "Already registered?",
  "auth.signInLink": "Sign in",
  "auth.checkEmail": "Check your emails",
  "auth.accountCreated": "Account created",
  "auth.checkEmailBody":
    "A confirmation link was just sent to you. Click it to activate your account, then sign in.",
  "auth.checkSpam": "Nothing received after a few minutes? Check your spam folder.",
  "auth.goToLogin": "Go to sign in",
  "auth.register.subtitle":
    "Order, book tables and earn loyalty points. Your current basket is kept.",
  "auth.acceptTerms1": "I accept the",
  "auth.termsLink": "terms of use",
  "auth.andPrivacy": "and the",
  "auth.privacyLink": "privacy policy",
  "auth.forgot.title": "Forgot your password",
  "auth.forgot.subtitle":
    "Enter your email address. We'll send you a link to set a new one.",
  "auth.forgot.requested": "Request recorded",
  "auth.forgot.requestedBody":
    "If an account exists for {email}, a reset link was just sent to it. It is valid for one hour and can only be used once.",
  "auth.forgot.thisAddress": "this address",
  "auth.forgot.spam": "Nothing received after a few minutes? Check the spam folder.",
  "auth.forgot.send": "Send the link",
  "auth.backToLogin": "Back to sign in",
  "auth.reset.title": "New password",
  "auth.reset.subtitle": "Choose a password you use nowhere else.",
  "auth.reset.newPassword": "New password",
  "auth.reset.confirm": "Confirm the password",
  "auth.reset.mismatch": "The two passwords do not match.",
  "auth.reset.sessionNote":
    "Saving will sign out all your open sessions, on every device.",
  "auth.reset.save": "Save password",
  "auth.reset.expired": "Link expired",
  "auth.reset.expiredTitle": "This link is no longer valid",
  "auth.reset.expiredBody":
    "Reset links expire after one hour and can only be used once. Request a new one.",
  "auth.reset.requestNew": "Request a new link",
  "auth.reset.done": "Password changed",
  "auth.reset.doneTitle": "Done",
  "auth.reset.doneBody":
    "Your password has been updated. For security, all your open sessions have been signed out — including on your other devices.",
  "auth.reason.invalid.title": "Incorrect credentials",
  "auth.reason.invalid.body": "The email or password does not match. Check and try again.",
  "auth.reason.pending.title": "Account awaiting validation",
  "auth.reason.pending.body":
    "Your account is not activated yet. You will receive an email as soon as it is.",
  "auth.reason.pending-manager.title": "Restaurant under review",
  "auth.reason.pending-manager.body":
    "Our team is reviewing your establishment — usually within 48 hours. We will write to you as soon as it is validated. Nothing to do on your side.",
  "auth.reason.suspended.title": "Account suspended",
  "auth.reason.suspended.body":
    "Your access has been suspended. Contact our team to find out why.",
  "auth.pw.min": "At least 8 characters",
  "auth.pw.upper": "An uppercase letter",
  "auth.pw.digit": "A number",
  "auth.pw.special": "A special character",
  "auth.pw.sr": "{met} of {total} criteria met.",
  "auth.invite.expired": "Invitation expired",
  "auth.invite.expiredTitle": "This link is no longer valid",
  "auth.invite.expiredBody":
    "Invitations expire after seven days. Ask your manager to send you a new one.",
  "auth.invite.welcome": "Welcome to the team",
  "auth.invite.accepted": "Invitation accepted",
  "auth.invite.acceptedBody":
    "You are now part of the {restaurant} team — {branch}, as {role}.",
  "auth.invite.join": "Join the team",
  "auth.invite.invitedBy": "Invitation sent by {name}",
  "auth.invite.expires": "This invitation expires on {date}.",
  "auth.invite.existing": "An account already exists for this address",
  "auth.invite.existingBody":
    "Sign in with {email} to accept this invitation. We never attach an existing account to an establishment without your explicit consent.",
  "auth.invite.acceptSignIn": "Sign in to accept",
  "auth.invite.emailHint": "Set by the invitation.",
  "auth.invite.namePh": "Nadège Tchoumi",
  "auth.invite.password": "Choose your password",
  "auth.invite.passwordHint":
    "Only you will know it — it is never shared with the restaurant.",
  "auth.invite.accept": "Accept and join",
  "auth.panel.eyebrow": "Restaurants · Cameroon",
  "auth.panel.title": "Your whole operation, in one app.",
  "auth.panel.body":
    "Orders, kitchen, tables, staff, subscription and mobile payment — all in one place.",
  "auth.panel.f1": "Multi-location",
  "auth.panel.f1body": "A team and a menu per branch.",
  "auth.panel.f2": "Kitchen display",
  "auth.panel.f2body": "Orders arrive without a refresh.",
  "auth.panel.f3": "Mobile payment",
  "auth.panel.f3body": "MTN MoMo and Orange Money.",

  /* ── Restaurant sign-up ────────────────────────────────────────────── */
  "reg.title": "Register my restaurant",
  "reg.subtitle": "Four short steps. Approval takes under 48 hours.",
  "reg.step.you": "You",
  "reg.step.place": "Restaurant",
  "reg.step.location": "Location",
  "reg.step.review": "Review",
  "reg.back": "Back",
  "reg.continue": "Continue",
  "reg.submit": "Send my application",
  "reg.haveAccount": "Already have an account?",
  "reg.signIn": "Sign in",

  "reg.ownerName": "Your name",
  "reg.ownerNamePh": "Paul Mbarga",
  "reg.yourEmail": "Your email",
  "reg.yourEmailPh": "you@restaurant.cm",
  "reg.yourPhone": "Your phone",
  "reg.password": "Password",

  "reg.restaurantName": "Restaurant name",
  "reg.restaurantNamePh": "Chez Marcel",
  "reg.description": "Description",
  "reg.descriptionHint": "Two sentences is plenty. It is the first thing customers read.",
  "reg.descriptionPh": "Everyday Cameroonian cooking, over a wood fire…",
  "reg.laterNote":
    "Cuisine type, your logo and your opening hours are set from your dashboard once the account is approved.",

  "reg.city": "Town",
  "reg.choose": "Choose…",
  "reg.quartier": "Neighbourhood",
  "reg.quartierHint": "Pick one from the list, or type yours if it is not there.",
  "reg.quartierPickCity": "Choose your town first.",
  "reg.address": "Full address",
  "reg.addressPh": "Boulevard de la Liberté, opposite BICEC",
  "reg.restaurantPhone": "Restaurant phone",
  "reg.restaurantPhoneHint": "The number shown to customers.",

  "reg.review.owner": "Owner",
  "reg.review.email": "Email",
  "reg.review.phone": "Phone",
  "reg.review.restaurant": "Restaurant",
  "reg.terms1": "I accept the",
  "reg.termsLink": "terms of use",
  "reg.terms2": "and confirm I am authorised to register this establishment.",
  "reg.fixErrors": "Fix these fields before sending:",
  "reg.goToStep": "Fix",

  "reg.done.title": "Application sent",
  "reg.done.heading": "We have received your application",
  "reg.done.body": "Your restaurant {name} is being reviewed by our team.",
  "reg.done.s1": "Application recorded",
  "reg.done.s1body": "Your file is registered under {email}.",
  "reg.done.s2": "Reviewed by our team",
  "reg.done.s2body": "Usually within 48 working hours. Nothing is needed from you.",
  "reg.done.s3": "Going live",
  "reg.done.s3body": "Once approved you can sign in and build your menu.",
  "reg.done.home": "Back to home",
  "reg.done.question": "A question about my application?",

  "reg.closed.title": "Sign-ups are closed",
  "reg.closed.body":
    "No town is accepting new registrations right now. Write to us and we will let you know as soon as yours opens.",

  /* ── Pricing cards ─────────────────────────────────────────────────── */
  "plan.mostChosen": "Most popular",

  /* -- Common ------------------------------------------------------- */
  "common.cancel": "Cancel",
  "common.add": "Add",
  "common.edit": "Edit",
  "common.error": "Something went wrong.",

  /* -- Reservations -------------------------------------------------- */
  "m.reservations.title": "Reservations",
  "m.reservations.subtitle": "Requests to decide first, then the service ahead.",
  "res.status.pending": "To confirm",
  "res.status.awaiting_payment": "Awaiting deposit",
  "res.status.confirmed": "Confirmed",
  "res.status.seated": "Seated",
  "res.status.completed": "Completed",
  "res.status.cancelled": "Declined",
  "res.status.no_show": "No show",
  "res.table": "Table",
  "res.declined": "Declined:",
  "res.decline": "Decline",
  "res.seat": "Seat",
  "res.noShow": "No show",
  "res.complete": "Complete",
  "res.seatedDone": "Guest seated.",
  "res.noShowDone": "Marked as a no show.",
  "res.completedDone": "Reservation completed.",
  "res.confirmedDone": "Reservation confirmed.",
  "res.declinedDone": "Reservation declined.",
  "res.awaiting": "To confirm ({count})",
  "res.upcoming": "Service ahead",
  "res.nothingPlanned": "Nothing booked",
  "res.nothingPlannedBody": "Confirmed reservations appear here, in service order.",
  "res.confirmTitle": "Confirm the reservation",
  "res.declineTitle": "Decline the reservation",
  "res.tableHint": "Optional — you can assign one on arrival.",
  "res.noTableYet": "Not assigned yet",
  "res.reason": "Reason",
  "res.deposit": "Deposit {amount} FCFA",
  "res.depositPercent": "Deposit {pct}% of the bill",
  "res.depositPaid": "Deposit collected",
  "res.release": "Release the table",
  "res.collectDeposit": "Collect deposit",
  "res.depositCollected": "Deposit credited to the wallet.",
  "res.depositTitle": "Reservation deposit",
  "res.depositBody": "Amount required to hold a table (0 = none). Collecting it credits the wallet.",
  "res.depositSaved": "Deposit saved.",
  "res.percentTitle": "Percentage deposit",
  "res.percentBody": "Percentage of the final bill collected at the restaurant (0 = none). The customer pays nothing online.",
  "res.perSeatTitle": "Deposit per guest",
  "res.perSeatBody": "Amount per guest, multiplied by the party size (0 = none). The customer pays it online when booking.",
  "res.depositKind": "Deposit type",
  "res.kindFixed": "Fixed amount",
  "res.kindPerSeat": "Per guest",
  "res.kindPercent": "% of the bill",
  "res.billTotal": "Bill total",
  "res.billTotalHint": "The deposit is computed from this amount.",
  "res.billTotalPh": "e.g. 15,000",
  "res.collectPercent": "Collect {amount}",
  "res.percentCollected": "{pct}% deposit credited to the wallet.",
  "res.reasonHint": "The guest reads this. One sentence is enough — a refusal with no explanation is what people complain about.",
  "res.reasonPh": "Fully booked at that time. We have space at 8.30pm if that suits you.",

  /* -- Tables -------------------------------------------------------- */
  "tbl.new": "New table",
  "tbl.number": "Number",
  "tbl.numberHint": "What staff read on the ticket. “12”, “T4”, “Terrace 2”…",
  "tbl.capacity": "Number of seats",
  "tbl.status.available": "Free",
  "tbl.status.occupied": "Occupied",
  "tbl.status.reserved": "Reserved",
  "tbl.status.out_of_service": "Out of service",
  "tbl.statusOf": "Status of table",
  "tbl.updated": "updated",
  "tbl.saved": "Table saved.",
  "tbl.added": "Table added.",
  "tbl.emptyBody": "Add your tables to take orders in the dining room and manage reservations.",
  "tbl.limitReached": "Limit reached: {used} / {limit} tables.",
  "tbl.limitBody": "Your existing tables keep working.",
  "tbl.changePlan": "Change plan",
  "tbl.planLimit": "Plan limit reached",
  "common.save": "Save",
  "common.confirm": "Confirm",
  "common.delete": "Delete",
  "common.close": "Close",
  "common.all": "All",
  "common.myProfile": "My profile",

  "logout.title": "Sign out?",
  "logout.message": "You will need your password to get back in. If a service is running, keep the session open.",

  /* -- Restaurant area ----------------------------------------------- */
  "m.dashboard": "Dashboard",
  "m.greeting": "Hello, {name}",
  "m.pending.title": "Your restaurant is being reviewed.",
  "m.pending.body": "Build your menu now, it goes live the moment you are approved.",
  "m.paused.body": "You are not accepting orders right now. Customers can see your page but cannot order.",

  "m.stat.ordersToday": "Orders today",
  "m.stat.revenueToday": "Revenue today",
  "m.stat.revenueHint": "Confirmed orders only.",
  "m.stat.revenuePending": "{count} order(s) awaiting your confirmation, not counted.",
  "m.stat.inProgress": "In progress",
  "m.stat.inProgressHint": "To confirm, preparing, or on the way.",
  "m.stat.rating": "Average rating",
  "m.stat.reviews": "{count} reviews",
  "m.stat.noReviews": "No reviews yet.",

  "m.reservations.toConfirm": "Reservations to confirm",
  "m.reservations.none": "Nothing to decide",
  "m.reservations.noneBody": "Booking requests arrive here.",
  "m.viewAll": "See all",
  "m.people": "{count} guest(s)",

  "m.menu.yours": "Your menu",
  "m.menu.manage": "Manage",
  "m.menu.empty": "Your menu is empty",
  "m.menu.emptyBody": "Add your dishes, it is the first thing customers look for.",
  "m.menu.addDish": "Add a dish",
  "m.menu.dishes": "Dishes",
  "m.menu.unavailable": "Unavailable",
  "m.menu.lowStock": "Low stock",
  "m.menu.lowStockAlert": "{count} dish(es) below the alert threshold.",

  "m.team.count": "{count} team member(s)",
  "m.team.body": "Each person only reaches what their role allows, branch by branch.",
  "m.team.manage": "Manage the team",

  "m.attention.title": "Also worth doing",
  "m.attention.urgentTitle": "Customers are waiting on you",

  /* -- Finish your setup ------------------------------------------------ */
  "m.welcome.title": "Welcome!",
  "m.welcome.body":
    "Your restaurant is set up. A few things are left to make your page genuinely appealing — we are taking you there.",
  "m.welcome.dismiss": "Later",
  "m.setup.title": "Finish setting up your page",
  "m.setup.body":
    "None of this is required — your restaurant already works. But every item you add makes your page more appealing to customers.",
  "m.setup.doneTitle": "Your page is complete",
  "m.setup.doneBody": "Everything is there. You can change any of it any time from your profile.",
  "m.setup.logo": "Add your logo",
  "m.setup.logoBody": "The image that represents you in listings. Without it, your card stays grey.",
  "m.setup.cover": "Add a cover photo",
  "m.setup.coverBody": "The wide image at the top of your page. Your dining room, or your food.",
  "m.setup.description": "Describe your restaurant",
  "m.setup.descriptionBody": "Two sentences on what you serve and what makes you different.",
  "m.setup.cuisine": "Choose your cuisine",
  "m.setup.cuisineBody": "This is how customers find you in the filters.",
  "m.setup.menu": "Add dishes",
  "m.setup.menuBody": "An empty menu takes no orders.",
  "m.setup.tables": "Add your tables",
  "m.setup.tablesBody": "Needed for bookings and dine-in service.",
  "m.setup.hours": "Set your opening hours",
  "m.setup.hoursBody": "With no hours, your page reads “closed” permanently.",
  "m.setup.later": "You can come back to this whenever you like.",
  "m.setup.go": "Open my profile",
  "m.setup.deliveryLabel": "We offer delivery",
  "m.setup.deliveryOwnHint": "Your own riders. You set the fee when you confirm each order.",
  "m.setup.deliveryPlatformHint": "The platform handles delivery and the admin sets the fee.",
  "m.setup.deliveryOffHint": "Pickup and dine-in only. No customer will see a delivery option.",
  "m.setup.deliveryOn": "Delivery is on.",
  "m.setup.deliveryOff": "Delivery is off.",
  "m.setup.deliverySettings": "Delivery fees and area",
  "m.attention.orders": "{count} order(s) to handle",
  "m.attention.reservations": "{count} booking(s) to confirm",
  "m.attention.lowStock": "{count} dish(es) low in stock",
  "m.attention.reviews": "{count} review(s) awaiting a reply",
  "m.attention.empty": "Everything is up to date",
  "m.attention.emptyBody": "Nothing needs your attention right now.",

  /* -- Orders --------------------------------------------------------- */
  "m.orders.title": "Orders",
  "m.orders.subtitle": "The service queue, most urgent first.",
  "m.orders.none": "No orders",
  "m.orders.noneBody": "Your customers' orders arrive here, live.",
  "m.orders.search": "Reference, customer or phone...",
  "m.orders.type": "Type",
  "m.orders.status": "Status",
  "m.orders.confirm": "Confirm",
  "m.orders.prepare": "Preparing",
  "m.orders.ship": "Send out",
  "m.orders.deliver": "Delivered",
  "m.orders.cancel": "Cancel",
  "m.orders.setFee": "Delivery fee",
  "m.orders.feePrompt": "Enter the real delivery cost. The customer sees it before confirming.",
  "m.orders.cancelReason": "Reason for cancelling",
  "m.orders.cancelHint": "The customer reads this. A cancellation with no reason is what people complain about.",
  "m.orders.items": "Items",
  "m.orders.customer": "Customer",
  "m.orders.total": "Total",
  "m.orders.print": "Print ticket",

  /* -- Kitchen -------------------------------------------------------- */
  "m.kitchen.title": "Kitchen display",
  "m.kitchen.none": "Nothing to prepare",
  "m.kitchen.noneBody": "Confirmed orders appear here automatically.",
  "m.kitchen.new": "New",
  "m.kitchen.cooking": "Cooking",
  "m.kitchen.ready": "Ready",
  "m.kitchen.start": "Start",
  "m.kitchen.done": "Done",

  /* -- Table service -------------------------------------------------- */
  "m.tableOrder.title": "Table order",
  "m.tableOrder.subtitle": "Take the order at the table, settle afterwards.",
  "m.tableOrder.pickTable": "Choose a table",
  "m.tableOrder.noTables": "No tables",
  "m.tableOrder.noTablesBody": "Create your tables to take orders in the dining room.",
  "m.tableOrder.cart": "Order",
  "m.tableOrder.empty": "No items",
  "m.tableOrder.send": "Send to kitchen",

  "m.tables.title": "Tables",
  "m.tables.seats": "{count} seat(s)",
  "m.tables.occupied": "{seated} of {capacity} seats",

  "m.wallet.title": "Wallet",

  "m.noBranch.title": "No restaurant linked",
  "m.noBranch.body":
    "Hi {name}. Your account is active, but it is not linked to any restaurant right now.",
  "m.noBranch.admin":
    "You are an admin: go to /a/impersonate to open a restaurant's dashboard.",
  "m.noBranch.pending": "Your listing request may still be awaiting validation.",
  "m.noBranch.removed": "Or the owner removed you from the team. Ask them to invite you again.",
  "m.noBranch.choose": "Choose a restaurant",
  "m.noBranch.support": "Contact support",
  "m.noBranch.home": "Back to home",

  /* -- Order statuses ------------------------------------------------- */
  "order.status.pending": "Pending",
  "order.status.confirmed": "Confirmed",
  "order.status.preparing": "Preparing",
  "order.status.shipped": "Out for delivery",
  "order.status.delivered": "Delivered",
  "order.status.cancelled": "Cancelled",
  "order.statusDesc.pending": "The restaurant has not confirmed your order yet.",
  "order.statusDesc.confirmed": "The restaurant accepted your order.",
  "order.statusDesc.preparing": "Your order is being prepared in the kitchen.",
  "order.statusDesc.shipped": "Your order is on its way.",
  "order.statusDesc.delivered": "Order delivered. Enjoy!",
  "order.statusDesc.cancelled": "This order was cancelled.",
  "order.next.confirmed": "Confirm",
  "order.next.preparing": "Start",
  "order.next.shipped": "Send out",
  "order.next.delivered": "Mark delivered",
  "order.type.delivery": "Delivery",
  "order.type.pickup": "Pickup",
  "order.type.dine_in": "Dine-in",
  "order.pay.cash_on_delivery": "Cash on delivery",
  "order.pay.pay_at_restaurant": "Pay at the restaurant",
  "order.pay.mobile_money": "Mobile Money",
  "order.paid": "Paid",
  "order.unpaid": "Unpaid",

  /* -- Order queue ----------------------------------------------------- */
  "mo.filter.active": "Active",
  "mo.filter.pending": "To confirm",
  "mo.filter.preparing": "Preparing",
  "mo.filter.shipped": "Out for delivery",
  "mo.filter.all": "All",
  "mo.ago": "{elapsed} ago",
  "mo.scheduled": "Scheduled",
  "mo.scheduledFor": "Due {time}",
  "mo.feeMissing": "+ delivery fee to quote",
  "mo.detail": "Details",
  "mo.ticket": "Ticket",
  "mo.updated": "Order updated.",
  "mo.cancelled": "Order cancelled.",
  "mo.cancelTitle": "Cancel the order",
  "mo.table": "Table",
  "mo.notes": "Note",
  "mo.history": "History",
  "mo.by": "by {name}",
  "mo.subtotal": "Subtotal",
  "mo.serviceCharge": "Service charge",
  "mo.deliveryFee": "Delivery",
  "mo.discount": "Discount",
  "mo.feeTBD": "to be quoted",
  "mo.notFound": "Order not found",
  "mo.notFoundBody": "It does not exist, or belongs to another branch.",
  "mo.backToOrders": "Back to orders",
  "mo.placedAt": "Placed on",
  "mo.cancelledReason": "Cancellation reason:",

  /* -- Delivery fee ----------------------------------------------------- */
  "fee.title": "Delivery fee",
  "fee.order": "Order {ref}",
  "fee.amount": "Amount (FCFA)",
  "fee.newTotal": "New customer total",
  "fee.confirm": "Confirm the order",
  "fee.hint": "The customer sees this total before the order is accepted.",
  "fee.band": "You advertise a fee between {min} and {max}. The customer saw that before ordering.",
  "fee.bandFrom": "You advertise a fee from {min}. The customer saw that before ordering.",
  "fee.overMax": "Above your advertised maximum ({max}). Change it in your profile, or lower this amount.",

  /* -- Kitchen ---------------------------------------------------------- */
  "mk.back": "Back to the dashboard",
  "mk.tickets": "ticket(s)",
  "mk.allServed": "All served",
  "mk.allServedBody": "New orders will appear here automatically.",
  "mk.inProgress": "Cooking",
  "mk.toStart": "To start",

  /* -- Table order ------------------------------------------------------ */
  "mt.table": "Table",
  "mt.pickFirst": "Choose a table first",
  "mt.search": "Search for a dish…",
  "mt.ticket": "Ticket",
  "mt.emptyTicket": "Empty ticket",
  "mt.emptyTicketBody": "Tap a dish to add it.",
  "mt.pickTableBody": "Select the table that is ordering.",
  "mt.clear": "Clear the ticket",
  "mt.notesPh": "Note for the kitchen…",
  "mt.sent": "Order {ref} sent to the kitchen — table {table}.",
  "mt.soldOut": "Sold out",
  "mt.seatsShort": "{count} seats",
  "mt.guests": "Guests",
  "mt.guestsHint": "How many people are at this table?",

  "plan.freeForever": "free, forever",
  "plan.trial": "{days}-day free trial",
  "plan.desc.starter": "To get started and put your menu online, at no cost.",
  "plan.desc.professional": "For a restaurant in full service: more dishes, more tables, lower commission.",
  "plan.desc.enterprise": "No limits, and the lowest commission. For several locations.",
  "plan.perMonth": "per month, per location",
  "plan.start": "Get started",
  "plan.menuItems": "menu items",
  "plan.tables": "tables",
  "plan.promotions": "active promotion(s)",
  "plan.staff": "Staff management",
  "plan.analytics": "Reports and analytics",
  "plan.commission": "Commission of",
  "plan.kitchen": "Kitchen display",
  "plan.mobileMoney": "Mobile payment (MoMo, OM)",
};

/**
 * Every module, merged.
 *
 * Order is irrelevant because each module namespaces its keys with its own
 * prefix — `mm.`, `mrv.`, `mrp.` and so on. Two modules claiming one key
 * would let the later spread win silently, and the prefix rule is what makes
 * that unable to happen rather than merely unlikely.
 */
const fr = {
  ...baseFr,
  ...commonDict.fr,
  ...categoriesDict.fr,
  ...chatDict.fr,
  ...notificationsDict.fr,
  ...menuDict.fr,
  ...modifiersDict.fr,
  ...mgateDict.fr,
  ...customersDict.fr,
  ...reviewsDict.fr,
  ...reportsDict.fr,
  ...staffDict.fr,
  ...profileDict.fr,
  ...promotionsDict.fr,
  ...settingsDict.fr,
  ...setupDict.fr,
  ...billingDict.fr,

  /* ── Customer area ── */
  ...custAccountDict.fr,
  ...custOrdersDict.fr,
  ...custReservationsDict.fr,
  ...custFavoritesDict.fr,
  ...custAddressesDict.fr,
  ...custLoyaltyDict.fr,
  ...custReviewsDict.fr,
  ...custProfileDict.fr,
  ...custSettingsDict.fr,
  ...custBrowseDict.fr,
  ...custCartDict.fr,
  ...marketingDict.fr,
  ...legalDict.fr,
} as const;

export type TranslationKey = keyof typeof fr;

const en: Record<TranslationKey, string> = {
  ...baseEn,
  ...commonDict.en,
  ...categoriesDict.en,
  ...chatDict.en,
  ...notificationsDict.en,
  ...menuDict.en,
  ...modifiersDict.en,
  ...mgateDict.en,
  ...customersDict.en,
  ...reviewsDict.en,
  ...reportsDict.en,
  ...staffDict.en,
  ...profileDict.en,
  ...promotionsDict.en,
  ...settingsDict.en,
  ...setupDict.en,
  ...billingDict.en,

  ...custAccountDict.en,
  ...custOrdersDict.en,
  ...custReservationsDict.en,
  ...custFavoritesDict.en,
  ...custAddressesDict.en,
  ...custLoyaltyDict.en,
  ...custReviewsDict.en,
  ...custProfileDict.en,
  ...custSettingsDict.en,
  ...custBrowseDict.en,
  ...custCartDict.en,
  ...marketingDict.en,
  ...legalDict.en,
};

export const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { fr, en };

/**
 * Fill `{name}`-style placeholders.
 *
 * Shared by the client hook (use-locale) and the server helper
 * (locale-server), so a string interpolates identically whichever side of the
 * boundary renders it — a Server Component cannot call useLocale, and before
 * this the two had separate implementations waiting to drift.
 */
export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  let out = template;
  for (const [name, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${name}}`, String(value));
  }
  return out;
}

/**
 * The BCP-47 tag to hand to `Intl.DateTimeFormat` / `Intl.NumberFormat`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  IT LIVES HERE, BESIDE `interpolate`, AND NOT IN use-locale.
 *
 *  It used to be exported from lib/i18n/use-locale, which carries "use
 *  client". That makes every export of that module a CLIENT REFERENCE — a
 *  stub that throws the moment a Server Component calls it:
 *
 *      Attempted to call intlLocale() from the server but intlLocale is on
 *      the client.
 *
 *  Which is what /loyalty did, and the invoice page carries a comment
 *  explaining that it deliberately hand-rolled the same two-line function
 *  rather than import it. Two workarounds and one crash for a pure function
 *  of a string.
 *
 *  This module has no "use client", so both sides may call it. use-locale
 *  re-exports it, so every existing client import keeps working unchanged.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cameroon is the region on both, so dates and separators stay local while
 * the language follows the reader.
 */
export function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-CM" : "fr-CM";
}
