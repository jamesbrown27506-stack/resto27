import { defineDict } from "../define";

/**
 * Strings shared by more than one screen: verbs on buttons, filter chrome,
 * the vocabulary of a list. If a string is only ever seen on one page, it
 * belongs in that page's module instead.
 */
export const commonDict = defineDict({
  fr: {
    "common.search": "Rechercher…",
    "common.clear": "Effacer",
    "common.create": "Créer",
    "common.back": "Retour",
    "common.actions": "Actions",
    "common.none": "Aucun",
    "common.never": "Jamais",
    "common.optional": "Facultatif",
    "common.required": "Obligatoire",
    "common.loading": "Chargement…",
    "common.slowConnectionTitle": "La connexion est lente",
    "common.slowConnectionBody": "Votre demande est en cours. Patientez un instant.",
    "common.noResults": "Aucun résultat",
    "common.noResultsBody": "Ajustez vos filtres.",
    "common.retry": "Réessayer",
    "common.of": "sur",
    "common.total": "Total",

    /* Used wherever a count has to read naturally in both languages. */
    "common.countDishes": "{count} plat(s)",
    "common.countOrders": "{count} commande(s)",

    /*
     * Branch roles and capabilities.
     *
     * These live here, not in lib/capabilities.ts, because that module is
     * imported by Server Components and by the permission checks themselves —
     * it must stay a pure data module with no locale in it. It keeps its
     * French BRANCH_ROLE_LABEL for server-side use (emails, audit lines); the
     * keys below are what the interface renders.
     */
    "common.role.owner": "Propriétaire",
    "common.role.manager": "Gérant",
    "common.role.kitchen": "Cuisine",
    "common.role.cashier": "Caissier",
    "common.role.waiter": "Serveur",

    "common.roleDesc.owner": "Accès complet, y compris la facturation et le personnel.",
    "common.roleDesc.manager": "Gère le service, le menu et l'équipe. Pas la facturation.",
    "common.roleDesc.kitchen": "Écran de cuisine et avancement des commandes.",
    "common.roleDesc.cashier": "Commandes, encaissement et clients.",
    "common.roleDesc.waiter": "Prise de commande en salle, tables et réservations.",

    "common.cap.orders.view": "Voir les commandes",
    "common.cap.orders.advance": "Faire avancer les commandes",
    "common.cap.kitchen.display": "Écran de cuisine",
    "common.cap.menu.view": "Voir le menu",
    "common.cap.menu.edit": "Modifier le menu",
    "common.cap.tables.view": "Voir les tables",
    "common.cap.tables.manage": "Gérer les tables",
    "common.cap.reservations.view": "Voir les réservations",
    "common.cap.reservations.decide": "Décider des réservations",
    "common.cap.promotions.manage": "Gérer les promotions",
    "common.cap.customers.view": "Voir les clients",
    "common.cap.reviews.reply": "Répondre aux avis",
    "common.cap.reports.view": "Voir les rapports",
    "common.cap.staff.manage": "Gérer le personnel",
    "common.cap.billing.manage": "Gérer la facturation",
    "common.cap.profile.edit": "Modifier le profil",
    "common.cap.settings.manage": "Gérer les paramètres",

    /* Branch switcher and subscription banner — chrome, so these appear on
       every single manager screen and were the loudest untranslated strings. */
    "common.branch.switch": "Changer d'établissement",
    "common.branch.switchHint": "Votre rôle peut différer d'une succursale à l'autre.",
    "common.branch.primary": "Principal",

    "common.subState.active": "Actif",
    "common.subState.grace": "Période de grâce",
    "common.subState.locked": "Verrouillé",
    "common.subState.free_mode": "Gratuit",

    "common.sub.expiredTitle": "Votre abonnement a expiré",
    "common.sub.expiredBodyDate": "Renouvelez avant la fin de la période de grâce. Échéance : {date}.",
    "common.sub.expiredBody": "Renouvelez pour conserver votre accès complet.",
    "common.sub.graceBody": "Expiré le {expired}. Votre formule fonctionne encore jusqu’au {deadline} ({left}) : renouvelez avant pour la garder.",
    "common.sub.graceLastDay": "Expiré le {expired}. Aujourd’hui est le dernier jour de la période de grâce : renouvelez maintenant pour garder votre formule.",
    "common.sub.daysLeft": "{count} jour(s) restant(s)",
    "common.sub.lockedTitle": "Compte verrouillé",
    "common.sub.lockedBody":
      "Vos limites sont revenues au niveau Starter. Réglez votre facture pour rétablir l'accès complet.",
    "common.sub.freeTitle": "Mode gratuit actif",
    "common.sub.freeBodyDate": "Toutes les fonctionnalités payantes sont offertes jusqu'au {date}.",
    "common.sub.freeBody": "Toutes les fonctionnalités payantes sont actuellement offertes.",
    "common.sub.manage": "Gérer l'abonnement",
    "common.hide": "Masquer",

    /* The image picker — shared by the admin branding screen, the restaurant
       profile and the dish editor. */
    "common.img.notSaved": "Non enregistré",
    "common.img.choose": "Choisir un fichier",
    "common.img.replace": "Remplacer",
    "common.img.undo": "Annuler le choix",
    "common.img.remove": "Retirer",
    "common.img.working": "Optimisation…",
    "common.img.tooLarge": "Cette image fait {size} Mo et n'a pas pu être réduite sous {limit} Mo.",
    "common.img.shrunk": "Image réduite à {size} Mo pour l'envoi.",

    /*
     * Quoting someone's words — an order note, a review being replied to.
     *
     * The marks live IN the string, not around the interpolation in JSX.
     * `<span>« {text} »</span>` gives the span three DOM children (bare text,
     * the value, bare text), and that adjacency is precisely what browser
     * auto-translate rewrites out from under React before the next
     * insertBefore throws NotFoundError. One placeholder, one text node.
     *
     * It also stops French guillemets being shown to English readers.
     */
    "common.quoted": "« {text} »",
    "common.accountNav": "Navigation du compte",
    "common.typedConfirm": "Saisissez {phrase} pour confirmer",
    "common.typedConfirmAria": "Saisir {phrase} pour confirmer",

    /* The notification bell — shared by every shell. */
    "notif.title": "Notifications",
    "notif.unreadCount": "{count} non lue(s)",
    "notif.needsAction": "Une action vous attend",
    "notif.actionBanner": "Une commande ou un acompte attend votre paiement.",
    "notif.actionOpen": "Voir",
    "notif.markAllRead": "Tout lire",
    "notif.empty": "Aucune notification",
    "notif.emptyBody": "Les événements vous concernant apparaîtront ici.",

    /* The install / notification-permission banners — shown automatically
       until accepted or dismissed (dismissals cool down for one hour). */
    "pwa.install.title": "Installez {name}",
    "pwa.install.body":
      "Ajoutez {name} à votre écran d'accueil : lancement rapide et plein écran, comme une vraie application.",
    "pwa.install.action": "Installer",
    "pwa.install.ios": "Sur iPhone/iPad : touchez Partager, puis « Sur l'écran d'accueil ».",
    "pwa.notif.title": "Activez les notifications",
    "pwa.notif.body":
      "Soyez alerté des commandes et réservations, même quand l'onglet est fermé.",
    "pwa.notif.action": "Activer",
    "pwa.notif.enabled": "Notifications activées sur cet appareil.",
    "pwa.notif.failed": "Impossible d'activer les notifications.",
    "pwa.notif.denied":
      "Les notifications sont bloquées par le navigateur. Autorisez-les dans les réglages du site pour recevoir les alertes.",
    "pwa.native.body":
      "Suivez vos commandes et réservations en temps réel, même quand l'application est fermée.",
    "pwa.native.blocked":
      "Les notifications sont bloquées pour {name}. Activez-les dans Paramètres › Applications › {name} › Notifications.",
    /* The installed app's welcome, first launch only (app-launch.tsx). */
    "applaunch.welcomeTitle": "Bienvenue sur {name}",
    "applaunch.welcomeBody": "Commandez et réservez dans les meilleurs restaurants de Douala.",
    "applaunch.compareTitle": "Choisissez un plat, puis le restaurant",
    "applaunch.compareBody": "Voyez qui le propose, à quel prix et dans quel quartier : le plus proche ou le moins cher.",
    "applaunch.trackTitle": "Suivez tout en direct",
    "applaunch.trackBody": "Une notification à chaque étape de votre commande ou de votre réservation.",
    "applaunch.next": "Suivant",
    "applaunch.start": "Commencer",
    "applaunch.skip": "Passer",
    "applaunch.language": "Langue",

    /* "A new version is available", installed app only (app-update-prompt.tsx). */
    "appupd.title": "Nouvelle version disponible",
    "appupd.body":
      "La version {version} de l'application est prête. Téléchargez-la puis installez-la par-dessus celle-ci : votre compte et vos données sont conservés.",
    "appupd.required": "Cette mise à jour est nécessaire pour continuer à utiliser l'application.",
    "appupd.action": "Mettre à jour",
    "appupd.later": "Plus tard",
    "appupd.downloading": "Téléchargement de la mise à jour… {percent} %",
    "appupd.permission":
      "Autorisez Resto237 à installer des applications (« Autoriser cette source »), puis revenez : l'installation reprend toute seule.",
    "appupd.failed": "Le téléchargement a échoué. Vérifiez votre connexion et réessayez.",
    "appupd.retry": "Réessayer",
    "pwa.later": "Plus tard",

    /* "Download our app" — the band above the footer and the footer links. */
    "appdl.tag": "Application mobile",
    "appdl.title": "Téléchargez l'application {name}",
    "appdl.body":
      "Commandez, suivez votre livraison en direct et recevez les alertes de vos commandes et réservations, directement sur votre téléphone.",
    "appdl.android.kicker": "Télécharger pour",
    "appdl.ios.kicker": "Installer sur",
    "appdl.android.meta": "Android 7.0 ou plus · version {version} · {size} Mo",
    "appdl.android.hint":
      "Hors Play Store, Android peut vous demander d'autoriser l'installation depuis votre navigateur : acceptez, puis ouvrez le fichier téléchargé.",
    "appdl.ios.title": "Sur iPhone et iPad",
    "appdl.ios.body":
      "L'application arrive bientôt sur l'App Store. En attendant, ouvrez ce site dans Safari, touchez Partager puis « Sur l'écran d'accueil » : vous obtenez la même application, en plein écran.",
    "appdl.footer": "Application mobile",
    "pwa.dismiss": "Fermer",
  },
  en: {
    "common.search": "Search…",
    "common.clear": "Clear",
    "common.create": "Create",
    "common.back": "Back",
    "common.actions": "Actions",
    "common.none": "None",
    "common.never": "Never",
    "common.optional": "Optional",
    "common.required": "Required",
    "common.loading": "Loading…",
    "common.slowConnectionTitle": "Your connection is slow",
    "common.slowConnectionBody": "Your request is still in progress. Please wait a moment.",
    "common.noResults": "No results",
    "common.noResultsBody": "Adjust your filters.",
    "common.retry": "Try again",
    "common.of": "of",
    "common.total": "Total",

    "common.countDishes": "{count} dish(es)",
    "common.countOrders": "{count} order(s)",

    "common.role.owner": "Owner",
    "common.role.manager": "Manager",
    "common.role.kitchen": "Kitchen",
    "common.role.cashier": "Cashier",
    "common.role.waiter": "Waiter",

    "common.roleDesc.owner": "Full access, including billing and staff.",
    "common.roleDesc.manager": "Runs the service, the menu and the team. Not billing.",
    "common.roleDesc.kitchen": "Kitchen display and moving orders along.",
    "common.roleDesc.cashier": "Orders, taking payment and customers.",
    "common.roleDesc.waiter": "Taking orders in the dining room, tables and bookings.",

    "common.cap.orders.view": "View orders",
    "common.cap.orders.advance": "Move orders along",
    "common.cap.kitchen.display": "Kitchen display",
    "common.cap.menu.view": "View the menu",
    "common.cap.menu.edit": "Edit the menu",
    "common.cap.tables.view": "View tables",
    "common.cap.tables.manage": "Manage tables",
    "common.cap.reservations.view": "View bookings",
    "common.cap.reservations.decide": "Accept or decline bookings",
    "common.cap.promotions.manage": "Manage promotions",
    "common.cap.customers.view": "View customers",
    "common.cap.reviews.reply": "Reply to reviews",
    "common.cap.reports.view": "View reports",
    "common.cap.staff.manage": "Manage staff",
    "common.cap.billing.manage": "Manage billing",
    "common.cap.profile.edit": "Edit the profile",
    "common.cap.settings.manage": "Manage settings",

    "common.branch.switch": "Switch location",
    "common.branch.switchHint": "Your role can differ from one location to the next.",
    "common.branch.primary": "Main",

    "common.subState.active": "Active",
    "common.subState.grace": "Grace period",
    "common.subState.locked": "Locked",
    "common.subState.free_mode": "Free",

    "common.sub.expiredTitle": "Your subscription has expired",
    "common.sub.expiredBodyDate": "Renew before the grace period ends. Due: {date}.",
    "common.sub.expiredBody": "Renew to keep your full access.",
    "common.sub.graceBody": "Expired on {expired}. Your plan keeps working until {deadline} ({left}): renew before then to keep it.",
    "common.sub.graceLastDay": "Expired on {expired}. Today is the last day of the grace period: renew now to keep your plan.",
    "common.sub.daysLeft": "{count} day(s) left",
    "common.sub.lockedTitle": "Account locked",
    "common.sub.lockedBody": "Your limits are back to Starter level. Settle your invoice to restore full access.",
    "common.sub.freeTitle": "Free mode is on",
    "common.sub.freeBodyDate": "All paid features are free until {date}.",
    "common.sub.freeBody": "All paid features are currently free.",
    "common.sub.manage": "Manage subscription",
    "common.hide": "Hide",

    "common.img.notSaved": "Not saved yet",
    "common.img.choose": "Choose file",
    "common.img.replace": "Replace",
    "common.img.undo": "Undo",
    "common.img.remove": "Remove",
    "common.img.working": "Optimising…",
    "common.img.tooLarge": "That image is {size} MB and could not be brought under {limit} MB.",
    "common.img.shrunk": "Image reduced to {size} MB for upload.",

    "common.quoted": "“{text}”",
    "common.accountNav": "Account navigation",
    "common.typedConfirm": "Type {phrase} to confirm",
    "common.typedConfirmAria": "Type {phrase} to confirm",

    /* The notification bell — shared by every shell. */
    "notif.title": "Notifications",
    "notif.unreadCount": "{count} unread",
    "notif.needsAction": "Something is waiting for you",
    "notif.actionBanner": "An order or a deposit is waiting for your payment.",
    "notif.actionOpen": "View",
    "notif.markAllRead": "Mark all as read",
    "notif.empty": "No notifications",
    "notif.emptyBody": "Events concerning you will appear here.",

    /* The install / notification-permission banners — shown automatically
       until accepted or dismissed (dismissals cool down for one hour). */
    "pwa.install.title": "Install {name}",
    "pwa.install.body":
      "Add {name} to your home screen for quick, full-screen launches — just like a real app.",
    "pwa.install.action": "Install",
    "pwa.install.ios": "On iPhone/iPad: tap Share, then “Add to Home Screen”.",
    "pwa.notif.title": "Enable notifications",
    "pwa.notif.body": "Get order and booking alerts even when this tab is closed.",
    "pwa.notif.action": "Enable",
    "pwa.notif.enabled": "Notifications enabled on this device.",
    "pwa.notif.failed": "Could not enable notifications.",
    "pwa.notif.denied":
      "Notifications are blocked by your browser. Allow them in the site settings to receive alerts.",
    "pwa.native.body": "Follow your orders and bookings live, even when the app is closed.",
    "pwa.native.blocked":
      "Notifications are blocked for {name}. Turn them on in Settings › Apps › {name} › Notifications.",
    /* The installed app's welcome, first launch only (app-launch.tsx). */
    "applaunch.welcomeTitle": "Welcome to {name}",
    "applaunch.welcomeBody": "Order and book a table at the best restaurants in Douala.",
    "applaunch.compareTitle": "Pick a dish, then the restaurant",
    "applaunch.compareBody": "See who serves it, at what price and in which neighbourhood: the nearest or the cheapest.",
    "applaunch.trackTitle": "Follow it all live",
    "applaunch.trackBody": "A notification at every step of your order or booking.",
    "applaunch.next": "Next",
    "applaunch.start": "Get started",
    "applaunch.skip": "Skip",
    "applaunch.language": "Language",

    /* "A new version is available", installed app only (app-update-prompt.tsx). */
    "appupd.title": "A new version is available",
    "appupd.body":
      "Version {version} of the app is ready. Download it and install it over this one: your account and data are kept.",
    "appupd.required": "This update is required to keep using the app.",
    "appupd.action": "Update",
    "appupd.later": "Later",
    "appupd.downloading": "Downloading the update… {percent}%",
    "appupd.permission":
      "Allow Resto237 to install apps (\"Allow from this source\"), then come back: the install carries on by itself.",
    "appupd.failed": "The download failed. Check your connection and try again.",
    "appupd.retry": "Try again",
    "pwa.later": "Later",

    /* "Download our app" — the band above the footer and the footer links. */
    "appdl.tag": "Mobile app",
    "appdl.title": "Get the {name} app",
    "appdl.body":
      "Order, follow your delivery live and get alerts about your orders and bookings, right on your phone.",
    "appdl.android.kicker": "Download for",
    "appdl.ios.kicker": "Install on",
    "appdl.android.meta": "Android 7.0 or later · version {version} · {size} MB",
    "appdl.android.hint":
      "Outside the Play Store, Android may ask you to allow installs from your browser. Accept, then open the downloaded file.",
    "appdl.ios.title": "On iPhone and iPad",
    "appdl.ios.body":
      "The app is coming to the App Store soon. Meanwhile, open this site in Safari, tap Share, then “Add to Home Screen” to get the same app, full screen.",
    "appdl.footer": "Get the app",
    "pwa.dismiss": "Close",
  },
});
