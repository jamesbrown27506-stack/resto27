import { defineDict } from "../define";

/**
 * The reviews a customer has written (/reviews).
 *
 * OWNED BY THIS SCREEN - every string in both languages, or the build fails.
 * Prefix every key with `crv.` so two modules can never collide.
 */
export const custReviewsDict = defineDict({
  fr: {
    "crv.title": "Mes avis",
    "crv.subtitle": "Les avis que vous avez publiés, et les réponses des restaurants.",
    "crv.empty": "Aucun avis publié",
    "crv.emptyBody": "Après une commande livrée, vous pouvez noter le restaurant.",
    "crv.seeOrders": "Voir mes commandes",
    "crv.edit": "Modifier",
    "crv.delete": "Supprimer",
    "crv.replyFrom": "Réponse de {name}",
    "crv.reacted": "{name} a réagi à votre avis",
    "crv.editTitle": "Modifier mon avis",
    "crv.rating": "Votre note",
    "crv.body": "Votre commentaire",
    "crv.updated": "Avis mis à jour.",
    "crv.deleted": "Avis supprimé.",
    "crv.deleteTitle": "Supprimer cet avis ?",
    "crv.deleteBody":
      "Il ne sera plus visible sur la fiche du restaurant. Cette action est définitive.",
  },
  en: {
    "crv.title": "My reviews",
    "crv.subtitle": "The reviews you have published, and the restaurants' replies.",
    "crv.empty": "No reviews published",
    "crv.emptyBody": "After a delivered order, you can rate the restaurant.",
    "crv.seeOrders": "See my orders",
    "crv.edit": "Edit",
    "crv.delete": "Delete",
    "crv.replyFrom": "Reply from {name}",
    "crv.reacted": "{name} reacted to your review",
    "crv.editTitle": "Edit my review",
    "crv.rating": "Your rating",
    "crv.body": "Your comment",
    "crv.updated": "Review updated.",
    "crv.deleted": "Review deleted.",
    "crv.deleteTitle": "Delete this review?",
    "crv.deleteBody":
      "It will no longer appear on the restaurant's page. This cannot be undone.",
  },
});
