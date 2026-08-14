import { defineDict } from "../define";

/**
 * Saved delivery addresses (/addresses).
 *
 * OWNED BY THIS SCREEN - every string in both languages, or the build fails.
 * Prefix every key with `cad.` so two modules can never collide.
 */
export const custAddressesDict = defineDict({
  fr: {
    "cad.title": "Adresses",
    "cad.subtitle": "Vos adresses de livraison enregistrées.",
    "cad.new": "Nouvelle adresse",
    "cad.notice":
      "Modifier une adresse ici ne change rien à vos commandes déjà passées : chacune conserve l'adresse telle qu'elle était au moment de la commande.",

    "cad.empty": "Aucune adresse enregistrée",
    "cad.emptyBody": "Ajoutez-en une pour aller plus vite au moment de commander.",
    "cad.add": "Ajouter une adresse",

    "cad.default": "Par défaut",
    "cad.edit": "Modifier",
    "cad.delete": "Supprimer",
    "cad.city": "Douala",

    "cad.editTitle": "Modifier l'adresse",
    "cad.label": "Libellé",
    "cad.labelHint": "Domicile, Bureau…",
    "cad.labelPh": "Domicile",
    "cad.recipient": "Nom du destinataire",
    "cad.phone": "Téléphone",
    "cad.quartier": "Quartier",
    "cad.quartierPick": "Choisir un quartier",
    "cad.line": "Adresse",
    "cad.linePh": "Rue, immeuble, étage",
    "cad.landmark": "Point de repère",
    "cad.landmarkHint": "Souvent plus utile que l'adresse elle-même pour le livreur.",
    "cad.landmarkPh": "En face de la pharmacie du Golfe",
    "cad.isDefault": "Adresse par défaut",
    "cad.isDefaultHint": "Pré-sélectionnée lors de vos prochaines commandes.",

    "cad.required": "Vérifiez les champs obligatoires.",
    "cad.added": "Adresse ajoutée.",
    "cad.updated": "Adresse mise à jour.",
    "cad.deleted": "Adresse supprimée.",
    "cad.deleteTitle": "Supprimer cette adresse ?",
    "cad.deleteBody":
      "Vos commandes passées ne sont pas affectées - elles conservent leur propre copie de l'adresse.",
  },
  en: {
    "cad.title": "Addresses",
    "cad.subtitle": "Your saved delivery addresses.",
    "cad.new": "New address",
    "cad.notice":
      "Editing an address here changes nothing about orders you have already placed: each one keeps the address as it was when you ordered.",

    "cad.empty": "No saved addresses",
    "cad.emptyBody": "Add one to check out faster next time.",
    "cad.add": "Add an address",

    "cad.default": "Default",
    "cad.edit": "Edit",
    "cad.delete": "Delete",
    "cad.city": "Douala",

    "cad.editTitle": "Edit the address",
    "cad.label": "Label",
    "cad.labelHint": "Home, Office…",
    "cad.labelPh": "Home",
    "cad.recipient": "Recipient name",
    "cad.phone": "Phone",
    "cad.quartier": "Neighbourhood",
    "cad.quartierPick": "Choose a neighbourhood",
    "cad.line": "Address",
    "cad.linePh": "Street, building, floor",
    "cad.landmark": "Landmark",
    "cad.landmarkHint": "Often more useful to the courier than the address itself.",
    "cad.landmarkPh": "Opposite the Golfe pharmacy",
    "cad.isDefault": "Default address",
    "cad.isDefaultHint": "Pre-selected on your next orders.",

    "cad.required": "Check the required fields.",
    "cad.added": "Address added.",
    "cad.updated": "Address updated.",
    "cad.deleted": "Address deleted.",
    "cad.deleteTitle": "Delete this address?",
    "cad.deleteBody":
      "Your past orders are unaffected - each keeps its own copy of the address.",
  },
});
