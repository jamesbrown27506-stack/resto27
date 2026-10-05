import { publicMetadata } from "@/lib/seo";
import { getLocale as seoLocale } from "@/lib/i18n/locale-server";
import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { getTranslator } from "@/lib/i18n/locale-server";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

const baseMetadata: Metadata = {
  title: "Politique de confidentialité",
  description:
    "Comment Resto237 collecte, utilise et protège vos données personnelles au Cameroun.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

/** The section ids are URL anchors, so they stay French regardless of locale. */
const SECTION_IDS = [
  "donnees",
  "utilisation",
  "conservation",
  "securite",
  "paiement",
  "droits",
  "contact",
];

export default async function PrivacyPage() {
  const t = await getTranslator();

  const sections: LegalSection[] = SECTION_IDS.map((id) => ({
    id,
    heading: t(`leg.privacy.${id}` as TranslationKey),
    paragraphs: [1, 2, 3]
      .map((n) => t(`leg.privacy.${id}.p${n}` as TranslationKey))
      .filter((p) => !p.startsWith("leg.privacy.")),
  })).filter((s) => s.paragraphs.length > 0);

  return (
    <LegalPage
      title={t("leg.privacy.title")}
      intro={t("leg.privacy.intro")}
      updatedAt="2026-10-05T00:00:00Z"
      sections={sections}
    />
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const fr = await seoLocale() === "fr";
  return publicMetadata("/privacy", fr ? String(baseMetadata.title) : "Privacy policy", fr ? String(baseMetadata.description) : "Read how Resto237 handles your personal information.");
}
