import { defineDict } from "../define";

/**
 * The first-login setup wizard (/m/setup).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `stp.` so two modules can never collide.
 */
export const setupDict = defineDict({
  fr: {
    "stp.title": "Préparons votre restaurant",
    "stp.subtitle": "Quelques minutes pour démarrer — votre type d'établissement, vos tables, puis votre carte.",
    "stp.step": "Étape {step} sur {total}",

    "stp.kind.title": "Quel type d'établissement êtes-vous ?",
    "stp.kind.body": "Les clients vous trouveront sous ce type dans Explorer. Vous pourrez le changer plus tard dans votre profil.",
    "stp.kind.readOnly": "Seul le propriétaire ou le gérant peut choisir le type.",
    "stp.kind.skip": "Plus tard",
    "stp.kind.continue": "Continuer",

    "stp.tables.title": "Vos tables",
    "stp.tables.body":
      "Sans tables, aucun client ne peut s'installer pour manger sur place. Ajoutez les vôtres — ou démarrez avec la configuration suggérée, modifiable à tout moment.",
    "stp.tables.suggest.title": "Configuration suggérée",
    "stp.tables.suggest.body": "2 tables de 5 places — la taille la plus courante, modifiable plus tard.",
    "stp.tables.suggest.add": "Ajouter 2 tables de 5",
    "stp.tables.suggest.added": "Table ajoutée.",

    /* ── Création en lot ───────────────────────────────────────────── */
    "stp.tables.bulkTitle": "Ajouter vos tables d'un coup",
    "stp.tables.bulkBody":
      "Combien de tables avez-vous, et combien de places chacune ? Nous les créons et les numérotons pour vous — tout reste modifiable ensuite.",
    "stp.tables.bulkCount": "Combien de tables ?",
    "stp.tables.bulkSeats": "Places par table",
    "stp.tables.bulkAdd": "Créer {count} tables de {seats} places",
    "stp.tables.bulkAdded": "{count} tables de {seats} places créées.",
    "stp.tables.bulkCountInvalid": "Entrez un nombre de tables (au moins 1).",
    "stp.tables.oneTitle": "Ajouter une seule table (numéro précis)",

    "stp.tables.addForm": "Ajouter une table",
    "stp.tables.add": "Ajouter",
    "stp.tables.list": "Vos tables",
    "stp.tables.none": "Aucune table pour l'instant — ajoutez-en ou passez à l'étape suivante.",
    "stp.tables.noRights":
      "Votre rôle ne permet pas de créer des tables — votre gérant peut les ajouter à tout moment.",
    "stp.tableRequired": "Entrez un numéro de table.",
    "stp.seatsInvalid": "Le nombre de places doit être au moins 1.",
    "stp.tables.continue": "Continuer",
    "stp.skip": "Passer pour l'instant",

    /* ── Delivery capability (step 2) ──────────────────────────────── */
    "stp.delivery.title": "Livraison",
    "stp.delivery.askBody":
      "Livrez-vous à domicile ? Tous les restaurants ne le font pas — et vous pourrez activer ou désactiver la livraison à tout moment depuis votre tableau de bord.",
    "stp.delivery.yes": "Oui, nous livrons",
    "stp.delivery.yesDesc":
      "Votre restaurant apparaîtra dans les recherches de livraison et les clients pourront commander pour se faire livrer.",
    "stp.delivery.no": "Non, pas de livraison",
    "stp.delivery.noDesc":
      "Vous ne proposez que la vente à emporter et le service sur place. Aucun client ne verra d'option de livraison chez vous.",
    "stp.delivery.body":
      "Avez-vous vos propres livreurs ? Si oui, vous gérez la livraison et les frais. Si non, la plateforme prend en charge la livraison pour vous.",
    "stp.delivery.feeTitle": "Frais de livraison annoncés",
    "stp.delivery.feeBody":
      "Le montant exact reste fixé par vous à la confirmation de chaque commande. Ces deux chiffres sont ce que le client voit AVANT de commander, pour qu'il sache à quoi s'attendre.",
    "stp.delivery.feeMin": "Minimum",
    "stp.delivery.feeMax": "Maximum",
    "stp.delivery.feeHint":
      "Facultatif. Laissez le maximum vide si vous ne pouvez pas vous engager sur un plafond. Sinon, vos frais ne pourront pas le dépasser.",
    "stp.delivery.feeInvalid": "Entrez un montant en francs, entier et positif.",
    "stp.delivery.feeOrder": "Le maximum ne peut pas être inférieur au minimum.",
    "stp.delivery.own": "J'ai mes propres livreurs",
    "stp.delivery.ownDesc":
      "Vous avez votre propre équipe de livraison. Les frais de livraison sont fixés par vos soins lors de la confirmation de chaque commande.",
    "stp.delivery.platform": "La plateforme gère la livraison",
    "stp.delivery.platformDesc":
      "Pas de livreurs ? Pas de souci. La plateforme assigne un livreur et les frais sont fixés par l'administrateur.",
    "stp.delivery.continue": "Continuer",

    /* ── Opening hours (step 3) ────────────────────────────────────── */
    "stp.hours.title": "Horaires d'ouverture",
    "stp.hours.body":
      "Nous avons prérempli vos horaires du lundi au samedi, de 10h à 22h. Vous pouvez les ajuster maintenant ou plus tard depuis votre profil.",
    "stp.hours.default": "Lundi – Samedi : 10h00 – 22h00",
    "stp.hours.closed": "Dimanche : Fermé",
    "stp.hours.note": "Ces horaires sont affichés sur votre page publique.",
    "stp.hours.continue": "Continuer",

    "stp.categories.title": "Votre carte",
    "stp.categories.body":
      "Nous avons créé quatre catégories par défaut — les entrées (avant le plat principal), les plats principaux, les desserts (après) et les boissons. Vous pourrez les renommer ou les supprimer à tout moment.",
    "stp.categories.continue": "Continuer",

    "stp.dishes.title": "Vos plats populaires",
    "stp.dishes.body":
      "La plupart des restaurants servent ces classiques camerounais. Cochez ceux que vous proposez — vous pourrez modifier les prix et les descriptions à tout moment.",
    "stp.dishes.price": "Prix",
    "stp.dishes.imageNote":
      "Les photos sont les nôtres pour vous faire démarrer — remplacez-les par les vôtres quand vous voulez depuis « Ma carte ».",
    "stp.dishes.selectAll": "Tout sélectionner",
    "stp.dishes.clear": "Tout retirer",
    "stp.dishes.add": "Ajouter {count} plat(s) et terminer",
    "stp.dishes.added": "Plats ajoutés à votre carte.",
    "stp.dishes.none":
      "Aucun plat ajouté — votre carte démarre vide, ajoutez vos plats quand vous voulez.",
    "stp.dishes.continue": "Continuer",

    "stp.fee.title": "Frais de réservation",
    "stp.fee.body":
      "Un acompte garantit qu'une table réservée est prise au sérieux. Le client est toujours informé que ce montant est déduit de son addition finale.",
    "stp.fee.none": "Aucun frais",
    "stp.fee.noneBody": "N'importe qui peut réserver sans rien payer d'avance.",
    "stp.fee.fixed": "Montant fixe",
    "stp.fee.fixedBody":
      "Le même montant pour toute réservation, quel que soit le nombre de convives.",
    "stp.fee.fixedLabel": "Montant de l'acompte",
    "stp.fee.fixedHint":
      "Le client paie cet acompte en ligne au moment de réserver (Mobile Money). Il est déduit de son addition une fois sur place.",
    "stp.fee.perSeat": "Montant par convive",
    "stp.fee.perSeatBody":
      "Multiplié par le nombre de convives. Une table de dix immobilise dix couverts — et coûte dix fois plus cher à laisser vide.",
    "stp.fee.perSeatLabel": "Acompte par convive",
    "stp.fee.perSeatSuffix": "FCFA / convive",
    "stp.fee.perSeatHint":
      "Le client paie ce montant multiplié par le nombre de convives, en ligne au moment de réserver. Le total est déduit de son addition une fois sur place.",
    "stp.fee.perSeatExample": "Une table de 2 paie {two}. Une table de 5 paie {five}.",
    "stp.fee.noRights":
      "Votre rôle ne permet pas de fixer les frais de réservation — votre gérant pourra le faire depuis les réservations.",
    "stp.fee.valueRequired": "Entrez un montant.",
    "stp.fee.invalid": "Entrez un montant en francs, entier et positif (0 = aucun frais).",
    "stp.fee.finish": "Terminer",

    "stp.categories.done": "Terminer",
    "stp.done": "Configuration terminée. Bienvenue !",

    "stp.tableNumber": "N° de table",
    "stp.tableCapacity": "Places",
  },
  en: {
    "stp.title": "Let's set up your restaurant",
    "stp.subtitle": "A few minutes to get started — your kind of place, your tables, then your menu.",
    "stp.step": "Step {step} of {total}",

    "stp.kind.title": "What kind of place are you?",
    "stp.kind.body": "Customers will find you under this type in Explore. You can change it later in your profile.",
    "stp.kind.readOnly": "Only the owner or a manager can choose the type.",
    "stp.kind.skip": "Later",
    "stp.kind.continue": "Continue",

    "stp.tables.title": "Your tables",
    "stp.tables.body":
      "With no tables, no guest can sit down to eat. Add yours — or start from the suggested setup and change it any time.",
    "stp.tables.suggest.title": "Suggested setup",
    "stp.tables.suggest.body": "2 tables of 5 seats — the most common size, and changeable later.",
    "stp.tables.suggest.add": "Add 2 tables of 5",
    "stp.tables.suggest.added": "Table added.",

    /* ── Bulk creation ─────────────────────────────────────────────── */
    "stp.tables.bulkTitle": "Add your tables all at once",
    "stp.tables.bulkBody":
      "How many tables do you have, and how many seats each? We create and number them for you — everything stays editable afterwards.",
    "stp.tables.bulkCount": "How many tables?",
    "stp.tables.bulkSeats": "Seats per table",
    "stp.tables.bulkAdd": "Create {count} tables of {seats} seats",
    "stp.tables.bulkAdded": "Created {count} tables of {seats} seats.",
    "stp.tables.bulkCountInvalid": "Enter how many tables (at least 1).",
    "stp.tables.oneTitle": "Add a single table (specific number)",

    "stp.tables.addForm": "Add a table",
    "stp.tables.add": "Add",
    "stp.tables.list": "Your tables",
    "stp.tables.none": "No tables yet — add some or move on to the next step.",
    "stp.tables.noRights": "Your role cannot create tables — your manager can add them any time.",
    "stp.tableRequired": "Enter a table number.",
    "stp.seatsInvalid": "Capacity must be at least 1.",
    "stp.tables.continue": "Continue",
    "stp.skip": "Skip for now",

    /* ── Delivery capability (step 2) ──────────────────────────────── */
    "stp.delivery.title": "Delivery",
    "stp.delivery.askBody":
      "Do you deliver? Not every restaurant does — and you can switch delivery on or off any time from your dashboard.",
    "stp.delivery.yes": "Yes, we deliver",
    "stp.delivery.yesDesc":
      "Your restaurant appears in delivery searches and customers can order for delivery.",
    "stp.delivery.no": "No delivery",
    "stp.delivery.noDesc":
      "You offer pickup and dine-in only. No customer will see a delivery option for you.",
    "stp.delivery.body":
      "Do you have your own delivery riders? If yes, you handle delivery and set fees. If no, the platform manages delivery for you.",
    "stp.delivery.feeTitle": "The delivery fee you advertise",
    "stp.delivery.feeBody":
      "You still set the exact amount when you confirm each order. These two numbers are what the customer sees BEFORE ordering, so they know what to expect.",
    "stp.delivery.feeMin": "Minimum",
    "stp.delivery.feeMax": "Maximum",
    "stp.delivery.feeHint":
      "Optional. Leave the maximum empty if you cannot commit to a ceiling. Otherwise your fee can never go above it.",
    "stp.delivery.feeInvalid": "Enter a whole, positive number of francs.",
    "stp.delivery.feeOrder": "The maximum cannot be lower than the minimum.",
    "stp.delivery.own": "I have my own riders",
    "stp.delivery.ownDesc":
      "You have your own delivery team. Delivery fees are set by you when confirming each order.",
    "stp.delivery.platform": "Platform handles delivery",
    "stp.delivery.platformDesc":
      "No riders? No problem. The platform assigns a rider and the admin sets the delivery fee.",
    "stp.delivery.continue": "Continue",

    /* ── Opening hours (step 3) ────────────────────────────────────── */
    "stp.hours.title": "Opening hours",
    "stp.hours.body":
      "We pre-filled your hours from Monday to Saturday, 10 AM to 10 PM. You can adjust now or later from your profile.",
    "stp.hours.default": "Monday – Saturday: 10:00 AM – 10:00 PM",
    "stp.hours.closed": "Sunday: Closed",
    "stp.hours.note": "These hours are displayed on your public page.",
    "stp.hours.continue": "Continue",

    "stp.categories.title": "Your menu",
    "stp.categories.body":
      "We created four default categories — starters (before the main meal), main dishes, desserts (after) and drinks. You can rename or delete them any time.",
    "stp.categories.continue": "Continue",

    "stp.dishes.title": "Your popular dishes",
    "stp.dishes.body":
      "Most restaurants serve these Cameroonian classics. Tick the ones you offer — you can edit prices and descriptions any time.",
    "stp.dishes.price": "Price",
    "stp.dishes.imageNote":
      "The photos are ours to get you started — swap them for your own any time from Your menu.",
    "stp.dishes.selectAll": "Select all",
    "stp.dishes.clear": "Clear selection",
    "stp.dishes.add": "Add {count} dish(es) and finish",
    "stp.dishes.added": "Dishes added to your menu.",
    "stp.dishes.none": "No dishes added — your menu starts empty; add dishes whenever you want.",
    "stp.dishes.continue": "Continue",

    "stp.fee.title": "Reservation fee",
    "stp.fee.body":
      "A deposit keeps a booked table serious. The customer is always told this amount is deducted from their final bill.",
    "stp.fee.none": "No fee",
    "stp.fee.noneBody": "Anyone can book without paying anything up front.",
    "stp.fee.fixed": "Fixed amount",
    "stp.fee.fixedBody": "The same amount for every booking, however many are coming.",
    "stp.fee.fixedLabel": "Deposit amount",
    "stp.fee.fixedHint":
      "The customer pays this deposit online when booking (Mobile Money). It is deducted from their bill once they arrive.",
    "stp.fee.perSeat": "Amount per guest",
    "stp.fee.perSeatBody":
      "Multiplied by the party size. A table of ten holds ten covers — and costs ten times as much to leave empty.",
    "stp.fee.perSeatLabel": "Deposit per guest",
    "stp.fee.perSeatSuffix": "FCFA / guest",
    "stp.fee.perSeatHint":
      "The customer pays this amount times the party size, online when booking. The total is deducted from their bill once they arrive.",
    "stp.fee.perSeatExample": "A table of 2 pays {two}. A table of 5 pays {five}.",
    "stp.fee.noRights":
      "Your role cannot set the reservation fee — your manager can do it from Reservations.",
    "stp.fee.valueRequired": "Enter an amount.",
    "stp.fee.invalid": "Enter a whole number of francs, 0 or more (0 = no fee).",
    "stp.fee.finish": "Finish",

    "stp.categories.done": "Finish",
    "stp.done": "Setup complete. Welcome!",

    "stp.tableNumber": "Table number",
    "stp.tableCapacity": "Seats",
  },
});
