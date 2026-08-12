import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Conditions d'utilisation",
  description:
    "Les conditions d'utilisation de RestoLink pour les clients et pour les restaurants partenaires.",
  alternates: { canonical: "/terms" },
};

const SECTIONS: LegalSection[] = [
  {
    id: "objet",
    heading: "Objet",
    paragraphs: [
      "RestoLink met en relation des clients et des restaurants au Cameroun. La plateforme permet de commander des repas en livraison ou à emporter, de réserver une table, et donne aux restaurants les outils de gestion de leur service.",
      "L'utilisation de la plateforme implique l'acceptation pleine et entière des présentes conditions.",
    ],
  },
  {
    id: "comptes",
    heading: "Comptes",
    paragraphs: [
      "Vous êtes responsable de la confidentialité de vos identifiants et de toute activité effectuée depuis votre compte. Prévenez-nous immédiatement en cas d'utilisation non autorisée.",
      "Les comptes restaurant sont soumis à validation par notre équipe avant publication. Nous pouvons refuser ou suspendre un compte en cas de manquement aux présentes conditions.",
    ],
  },
  {
    id: "commandes",
    heading: "Commandes et frais de livraison",
    paragraphs: [
      "Les prix affichés sont ceux fixés par le restaurant et sont exprimés en francs CFA, toutes taxes comprises.",
      "Les frais de livraison ne sont pas calculés automatiquement : ils sont déterminés par le restaurant au moment où il confirme votre commande, en fonction de votre quartier. Ils vous sont communiqués à ce moment-là et s'ajoutent au total.",
      "Une commande peut être annulée tant qu'elle n'a pas été prise en charge par la cuisine. Passé ce stade, l'annulation relève de l'appréciation du restaurant.",
    ],
  },
  {
    id: "responsabilite",
    heading: "Responsabilité",
    paragraphs: [
      "La préparation des repas, leur qualité, leur conformité et le respect des règles d'hygiène relèvent de la seule responsabilité du restaurant.",
      "Les informations sur les allergènes sont fournies par les restaurants. En cas d'allergie sévère, contactez directement l'établissement avant de commander.",
    ],
  },
  {
    id: "abonnements",
    heading: "Abonnements des restaurants",
    paragraphs: [
      "L'accès aux outils de gestion est soumis à un abonnement mensuel par établissement, ainsi qu'à une commission sur la valeur des commandes livrées. La commission ne s'applique ni aux commandes annulées ni aux frais de livraison.",
      "En cas de retard de paiement, une période de grâce de trois jours est appliquée sans restriction d'accès. Au-delà, le compte revient aux limites de la formule Starter jusqu'au règlement. Aucune donnée n'est supprimée, et la page de facturation reste accessible en permanence.",
      "Le taux de commission appliqué à un relevé est celui en vigueur au moment de sa génération. Un relevé déjà émis n'est jamais recalculé.",
    ],
  },
  {
    id: "avis",
    heading: "Avis",
    paragraphs: [
      "Les avis ne peuvent être déposés qu'après une commande effectivement livrée. Ils doivent rester factuels et respectueux.",
      "Nous pouvons retirer un avis signalé comme injurieux ou diffamatoire. Nous ne modifions jamais le contenu d'un avis : il est publié tel quel ou retiré.",
    ],
  },
  {
    id: "modification",
    heading: "Modification des conditions",
    paragraphs: [
      "Ces conditions peuvent évoluer. Toute modification substantielle est notifiée par email et dans l'application au moins quinze jours avant son entrée en vigueur.",
    ],
  },
  {
    id: "droit",
    heading: "Droit applicable",
    paragraphs: [
      "Les présentes conditions sont régies par le droit camerounais. Tout litige relève de la compétence des tribunaux de Douala.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Conditions d'utilisation"
      intro="Les règles qui encadrent l'utilisation de la plateforme, côté client comme côté restaurant."
      updatedAt="2026-07-01T00:00:00Z"
      sections={SECTIONS}
    />
  );
}
