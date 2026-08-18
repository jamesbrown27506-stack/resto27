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
    "stp.subtitle": "Quelques minutes pour démarrer — vos tables d'abord, puis votre carte.",
    "stp.step": "Étape {step} sur {total}",

    "stp.tables.title": "Vos tables",
    "stp.tables.body":
      "Sans tables, aucun client ne peut s'installer pour manger sur place. Ajoutez les vôtres — ou démarrez avec la configuration suggérée, modifiable à tout moment.",
    "stp.tables.suggest.title": "Configuration suggérée",
    "stp.tables.suggest.body": "2 tables de 5 places — la taille la plus courante, modifiable plus tard.",
    "stp.tables.suggest.add": "Ajouter 2 tables de 5",
    "stp.tables.suggest.added": "Configuration suggérée ajoutée.",
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

    "stp.categories.title": "Votre carte",
    "stp.categories.body":
      "Nous avons créé quatre catégories par défaut — les entrées (avant le plat principal), les plats principaux, les desserts (après) et les boissons. Vous pourrez les renommer ou les supprimer à tout moment.",
    "stp.categories.continue": "Continuer",

    "stp.dishes.title": "Vos plats populaires",
    "stp.dishes.body":
      "La plupart des restaurants servent ces classiques camerounais. Cochez ceux que vous proposez — vous pourrez modifier les prix et les descriptions à tout moment.",
    "stp.dishes.selectAll": "Tout sélectionner",
    "stp.dishes.clear": "Tout retirer",
    "stp.dishes.add": "Ajouter {count} plat(s) et terminer",
    "stp.dishes.added": "Plats ajoutés à votre carte.",
    "stp.dishes.none":
      "Aucun plat ajouté — votre carte démarre vide, ajoutez vos plats quand vous voulez.",

    "stp.categories.done": "Terminer",
    "stp.done": "Configuration terminée. Bienvenue !",

    "stp.tableNumber": "N° de table",
    "stp.tableCapacity": "Places",
  },
  en: {
    "stp.title": "Let's set up your restaurant",
    "stp.subtitle": "A few minutes to get started — your tables first, then your menu.",
    "stp.step": "Step {step} of {total}",

    "stp.tables.title": "Your tables",
    "stp.tables.body":
      "With no tables, no guest can sit down to eat. Add yours — or start from the suggested setup and change it any time.",
    "stp.tables.suggest.title": "Suggested setup",
    "stp.tables.suggest.body": "2 tables of 5 seats — the most common size, and changeable later.",
    "stp.tables.suggest.add": "Add 2 tables of 5",
    "stp.tables.suggest.added": "Suggested setup added.",
    "stp.tables.addForm": "Add a table",
    "stp.tables.add": "Add",
    "stp.tables.list": "Your tables",
    "stp.tables.none": "No tables yet — add some or move on to the next step.",
    "stp.tables.noRights": "Your role cannot create tables — your manager can add them any time.",
    "stp.tableRequired": "Enter a table number.",
    "stp.seatsInvalid": "Capacity must be at least 1.",
    "stp.tables.continue": "Continue",
    "stp.skip": "Skip for now",

    "stp.categories.title": "Your menu",
    "stp.categories.body":
      "We created four default categories — starters (before the main meal), main dishes, desserts (after) and drinks. You can rename or delete them any time.",
    "stp.categories.continue": "Continue",

    "stp.dishes.title": "Your popular dishes",
    "stp.dishes.body":
      "Most restaurants serve these Cameroonian classics. Tick the ones you offer — you can edit prices and descriptions any time.",
    "stp.dishes.selectAll": "Select all",
    "stp.dishes.clear": "Clear selection",
    "stp.dishes.add": "Add {count} dish(es) and finish",
    "stp.dishes.added": "Dishes added to your menu.",
    "stp.dishes.none": "No dishes added — your menu starts empty; add dishes whenever you want.",

    "stp.categories.done": "Finish",
    "stp.done": "Setup complete. Welcome!",

    "stp.tableNumber": "Table number",
    "stp.tableCapacity": "Seats",
  },
});