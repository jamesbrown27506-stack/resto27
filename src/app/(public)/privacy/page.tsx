import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description:
    "Comment RestoLink collecte, utilise et protège vos données personnelles au Cameroun.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

const SECTIONS: LegalSection[] = [
  {
    id: "donnees",
    heading: "Données que nous collectons",
    paragraphs: [
      "Lorsque vous créez un compte, nous collectons votre nom, votre adresse email et votre numéro de téléphone. Ces informations sont nécessaires pour vous identifier et pour permettre au restaurant de vous joindre au sujet de votre commande.",
      "Lorsque vous passez commande, nous enregistrons les articles commandés, le montant, votre adresse de livraison et vos éventuelles instructions. Ces éléments sont conservés avec la commande.",
    ],
  },
  {
    id: "utilisation",
    heading: "Utilisation de vos données",
    paragraphs: [
      "Vos données servent à traiter vos commandes et vos réservations, à vous tenir informé de leur avancement, à gérer votre programme de fidélité et à répondre à vos demandes d'assistance.",
      "Nous ne vendons jamais vos données à des tiers. Les restaurants n'ont accès qu'aux informations nécessaires à l'exécution de vos commandes chez eux.",
    ],
  },
  {
    id: "conservation",
    heading: "Conservation et suppression",
    paragraphs: [
      "Vous pouvez demander la suppression de votre compte à tout moment depuis vos paramètres. Vos données personnelles — nom, email, téléphone — sont alors définitivement anonymisées.",
      "L'historique des commandes est conservé sous forme anonymisée. Cette conservation est nécessaire : les commandes constituent l'historique comptable du restaurant et la base du calcul des commissions de la plateforme. Elles ne peuvent plus être reliées à votre identité.",
    ],
  },
  {
    id: "securite",
    heading: "Sécurité",
    paragraphs: [
      "Les mots de passe sont stockés sous forme de condensats cryptographiques et ne sont jamais lisibles, y compris par nos équipes. Les échanges avec la plateforme sont chiffrés.",
      "Si vous suspendez ou modifiez votre mot de passe, toutes vos sessions ouvertes sont immédiatement invalidées sur l'ensemble de vos appareils.",
    ],
  },
  {
    id: "paiement",
    heading: "Paiements",
    paragraphs: [
      "Les commandes sont réglées en espèces à la livraison ou directement au restaurant. Nous ne stockons aucune coordonnée bancaire de client.",
      "Les abonnements des restaurateurs sont réglés par Mobile Money via notre prestataire de paiement. Nous conservons la référence de la transaction et le montant, jamais les identifiants de votre compte mobile.",
    ],
  },
  {
    id: "droits",
    heading: "Vos droits",
    paragraphs: [
      "Vous pouvez consulter, corriger ou faire supprimer vos données personnelles à tout moment depuis votre compte, ou en nous écrivant à contact@restolink.cm.",
      "Vous pouvez également refuser les emails non essentiels depuis vos paramètres de notification, sans perdre les messages liés à vos commandes en cours.",
    ],
  },
  {
    id: "contact",
    heading: "Nous contacter",
    paragraphs: [
      "Pour toute question relative à cette politique, écrivez-nous à contact@restolink.cm ou utilisez le formulaire de contact.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Politique de confidentialité"
      intro="Ce que nous collectons, pourquoi, et ce que vous pouvez en faire."
      updatedAt="2026-07-01T00:00:00Z"
      sections={SECTIONS}
    />
  );
}
