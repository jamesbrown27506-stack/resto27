import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { getTranslator } from "@/lib/i18n/locale-server";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

export const metadata: Metadata = {
  title: "Conditions d'utilisation",
  description:
    "Les conditions d'utilisation de RestoLink pour les clients et pour les restaurants partenaires.",
  alternates: { canonical: "/terms" },
};

/** The section ids are URL anchors, so they stay French regardless of locale. */
const SECTION_IDS = [
  "objet",
  "comptes",
  "commandes",
  "responsabilite",
  "abonnements",
  "avis",
  "modification",
  "droit",
];

export default async function TermsPage() {
  const t = await getTranslator();

  const sections: LegalSection[] = SECTION_IDS.map((id) => ({
    id,
    heading: t(`leg.terms.${id}` as TranslationKey),
    paragraphs: [1, 2, 3]
      .map((n) => t(`leg.terms.${id}.p${n}` as TranslationKey))
      .filter((p) => !p.startsWith("leg.terms.")),
  })).filter((s) => s.paragraphs.length > 0);

  return (
    <LegalPage
      title={t("leg.terms.title")}
      intro={t("leg.terms.intro")}
      updatedAt="2026-07-01T00:00:00Z"
      sections={sections}
    />
  );
}
