import { defineDict } from "../define";

/**
 * Option groups and options (/m/menu/[id]/modifiers).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `mod.` so two modules can never collide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE EXPLANATORY PARAGRAPH IS FOUR KEYS, NOT ONE.
 *
 *  It reads "**Groupe** — une question posée au client…", and the emphasis is
 *  the whole point: the manager has to learn that a group is a QUESTION and an
 *  option is an ANSWER before the min/max fields mean anything. Storing the
 *  markup in the string would force dangerouslySetInnerHTML on translated
 *  content; splitting the term from its definition keeps the <strong> in JSX
 *  where React can own it.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Counted strings come in explicit variants rather than "{count} option(s)":
 * French counts 0 as singular where English does not, so the caller picks.
 */
export const modifiersDict = defineDict({
  fr: {
    "mod.title": "Options",
    "mod.backToMenu": "Retour au menu",
    "mod.readOnly": "Vous consultez ces options en lecture seule.",
    "mod.basePrice": "Prix du plat : {price}",

    /* ── Le paragraphe pédagogique ────────────────────────────────────── */
    "mod.explain.groupTerm": "Un groupe",
    "mod.explain.groupBody":
      "est une question posée au client (« Taille », « Suppléments ») et le nombre de réponses qu'il peut donner.",
    "mod.explain.optionTerm": "Une option",
    "mod.explain.optionBody":
      "est une réponse possible. Elle peut ajouter un montant au prix du plat, ou en retirer.",

    /* ── Carte de groupe ──────────────────────────────────────────────── */
    "mod.group.required": "Obligatoire",
    "mod.group.optional": "Facultatif",
    "mod.group.singleChoice": "Choix unique",
    "mod.group.range": "{min} à {max} choix",
    "mod.group.upTo": "Jusqu'à {max} choix",
    "mod.group.optionCount_one": "{count} option",
    "mod.group.optionCount_other": "{count} options",
    "mod.group.noOptions": "Ce groupe n'a encore aucune option.",
    "mod.group.noOptionsHint":
      "Tant qu'il est vide, le client ne le verra pas au moment de commander.",
    "mod.group.editAria": "Modifier le groupe {name}",
    "mod.group.deleteAria": "Supprimer le groupe {name}",

    /* ── Panneau du groupe ────────────────────────────────────────────── */
    "mod.newGroup": "Nouveau groupe",
    "mod.editGroup": "Modifier le groupe",
    "mod.field.name": "Nom du groupe",
    "mod.field.namePlaceholder": "Taille",
    "mod.field.nameHint": "C'est la question que verra le client.",
    "mod.field.required": "Réponse obligatoire",
    "mod.field.requiredHint": "Le client ne peut pas commander ce plat sans choisir.",
    "mod.field.min": "Minimum",
    "mod.field.max": "Maximum",
    "mod.field.minMaxHint": "Combien de réponses le client peut donner. 1 et 1 pour un choix unique.",

    /* ── Erreurs de saisie ────────────────────────────────────────────── */
    "mod.err.nameShort": "Le nom du groupe est trop court.",
    "mod.err.maxAtLeastOne": "Le maximum doit être d'au moins 1.",
    "mod.err.minMax": "Le maximum ne peut pas être inférieur au minimum : personne ne pourrait valider.",
    "mod.err.requiredMin": "Un groupe obligatoire exige un minimum d'au moins 1.",
    "mod.err.priceWhole": "Le montant doit être un nombre entier de francs.",

    /* ── Suppression d'un groupe ──────────────────────────────────────── */
    "mod.deleteGroup.title": "Supprimer « {name} » ?",
    "mod.deleteGroup.msgNone":
      "Ce groupe sera supprimé. Les commandes déjà passées gardent le détail d'origine. Cette action est définitive.",
    "mod.deleteGroup.msgOne":
      "Ce groupe et son option seront supprimés ensemble. Les commandes déjà passées gardent le détail d'origine. Cette action est définitive.",
    "mod.deleteGroup.msgMany":
      "Ce groupe et ses {count} options seront supprimés ensemble. Les commandes déjà passées gardent le détail d'origine. Cette action est définitive.",

    /* ── Options ──────────────────────────────────────────────────────── */
    "mod.option.unavailable": "Indisponible",
    "mod.option.available": "Disponible",
    "mod.option.included": "Sans supplément",
    "mod.option.availabilityOf": "Disponibilité de {name}",
    "mod.option.deleteAria": "Supprimer l'option {name}",
    "mod.addOption": "Ajouter une option",
    "mod.option.name": "Nom de l'option",
    "mod.option.namePlaceholder": "Familial",
    "mod.option.price": "Différence de prix",
    "mod.option.priceHint": "Peut être négatif : « sans viande, −500 ».",
    "mod.deleteOption.title": "Supprimer « {name} » ?",
    "mod.deleteOption.message":
      "Cette option disparaîtra du choix proposé aux clients. Les commandes déjà passées gardent le détail d'origine.",

    /* ── État vide ────────────────────────────────────────────────────── */
    "mod.empty.title": "Aucun groupe d'options",
    "mod.empty.body":
      "Ajoutez un groupe si ce plat se décline en tailles, en suppléments ou en niveaux de piment.",
    "mod.empty.readOnlyBody": "Ce plat se commande tel quel, sans choix à faire.",
    "mod.empty.action": "Créer un groupe",

    /* ── Retours d'action ─────────────────────────────────────────────── */
    "mod.toast.groupCreated": "Groupe créé.",
    "mod.toast.groupSaved": "Groupe enregistré.",
    "mod.toast.groupDeleted": "Groupe supprimé.",
    "mod.toast.optionAdded": "Option ajoutée.",
    "mod.toast.optionDeleted": "Option supprimée.",
    "mod.toast.optionOn": "{name} de nouveau disponible.",
    "mod.toast.optionOff": "{name} marqué indisponible.",
  },

  en: {
    "mod.title": "Options",
    "mod.backToMenu": "Back to menu",
    "mod.readOnly": "You are viewing these options read-only.",
    "mod.basePrice": "Dish price: {price}",

    "mod.explain.groupTerm": "A group",
    "mod.explain.groupBody":
      "is a question put to the customer (“Size”, “Extras”) and how many answers they may give.",
    "mod.explain.optionTerm": "An option",
    "mod.explain.optionBody":
      "is one possible answer. It can add to the dish's price, or take away from it.",

    "mod.group.required": "Required",
    "mod.group.optional": "Optional",
    "mod.group.singleChoice": "Single choice",
    "mod.group.range": "{min} to {max} choices",
    "mod.group.upTo": "Up to {max} choices",
    "mod.group.optionCount_one": "{count} option",
    "mod.group.optionCount_other": "{count} options",
    "mod.group.noOptions": "This group has no options yet.",
    "mod.group.noOptionsHint": "While it is empty, customers never see it at checkout.",
    "mod.group.editAria": "Edit the {name} group",
    "mod.group.deleteAria": "Delete the {name} group",

    "mod.newGroup": "New group",
    "mod.editGroup": "Edit group",
    "mod.field.name": "Group name",
    "mod.field.namePlaceholder": "Size",
    "mod.field.nameHint": "This is the question the customer sees.",
    "mod.field.required": "Answer required",
    "mod.field.requiredHint": "The customer cannot order this dish without choosing.",
    "mod.field.min": "Minimum",
    "mod.field.max": "Maximum",
    "mod.field.minMaxHint": "How many answers the customer may give. 1 and 1 for a single choice.",

    "mod.err.nameShort": "The group name is too short.",
    "mod.err.maxAtLeastOne": "Maximum must be at least 1.",
    "mod.err.minMax": "Maximum cannot be below minimum — nobody could submit that.",
    "mod.err.requiredMin": "A required group needs a minimum of at least 1.",
    "mod.err.priceWhole": "The amount must be a whole number of francs.",

    "mod.deleteGroup.title": "Delete “{name}”?",
    "mod.deleteGroup.msgNone":
      "This group will be deleted. Past orders keep their original detail. This cannot be undone.",
    "mod.deleteGroup.msgOne":
      "This group and its one option go together. Past orders keep their original detail. This cannot be undone.",
    "mod.deleteGroup.msgMany":
      "This group and its {count} options go together. Past orders keep their original detail. This cannot be undone.",

    "mod.option.unavailable": "Unavailable",
    "mod.option.available": "Available",
    "mod.option.included": "No extra charge",
    "mod.option.availabilityOf": "Availability of {name}",
    "mod.option.deleteAria": "Delete the {name} option",
    "mod.addOption": "Add an option",
    "mod.option.name": "Option name",
    "mod.option.namePlaceholder": "Family size",
    "mod.option.price": "Price difference",
    "mod.option.priceHint": "May be negative: “no meat, −500”.",
    "mod.deleteOption.title": "Delete “{name}”?",
    "mod.deleteOption.message":
      "This option will disappear from the choices customers are offered. Past orders keep their original detail.",

    "mod.empty.title": "No option groups",
    "mod.empty.body": "Add a group if this dish comes in sizes, with extras, or at different heat levels.",
    "mod.empty.readOnlyBody": "This dish is ordered as it is, with nothing to choose.",
    "mod.empty.action": "Create a group",

    "mod.toast.groupCreated": "Group created.",
    "mod.toast.groupSaved": "Group saved.",
    "mod.toast.groupDeleted": "Group deleted.",
    "mod.toast.optionAdded": "Option added.",
    "mod.toast.optionDeleted": "Option deleted.",
    "mod.toast.optionOn": "{name} is available again.",
    "mod.toast.optionOff": "{name} marked unavailable.",
  },
});
