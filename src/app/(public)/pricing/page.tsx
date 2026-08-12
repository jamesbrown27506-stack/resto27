import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { Faq } from "@/components/marketing/faq";
import { PricingGrid } from "@/components/marketing/pricing-grid";
import { CtaBanner, SectionHeader } from "@/components/marketing/sections";
import { SectionTag } from "@/components/ui/badge";
import { formatMoney, formatPercent } from "@/lib/format/currency";
import { formatLimit } from "@/lib/format/subscription";
import { listPublicPlans, type PublicPlan } from "@/lib/data/plans";

export const metadata: Metadata = {
  title: "Tarifs et commissions pour les restaurants",
  description:
    "Trois formules d'abonnement pour les restaurants au Cameroun, payables par MTN Mobile Money ou Orange Money. Sans engagement.",
  alternates: { canonical: "/pricing" },
};

const ROWS: { label: string; get: (p: PublicPlan) => React.ReactNode }[] = [
  { label: "Prix mensuel", get: (p) => (p.monthlyPrice === 0 ? "Gratuit" : formatMoney(p.monthlyPrice)) },
  {
    label: "Essai gratuit",
    get: (p) => (p.trialDays ? `${p.trialDays} jours` : p.monthlyPrice === 0 ? "—" : false),
  },
  { label: "Plats au menu", get: (p) => formatLimit(p.menuItemLimit) },
  { label: "Tables", get: (p) => formatLimit(p.tableLimit) },
  { label: "Promotions actives", get: (p) => formatLimit(p.promotionLimit) },
  { label: "Commission par commande", get: (p) => formatPercent(p.commissionRate) },
  { label: "Gestion du personnel", get: (p) => p.staffManagement },
  { label: "Rapports et analytique", get: (p) => p.analytics },
  { label: "Écran de cuisine", get: () => true },
  { label: "Commande en salle", get: () => true },
  { label: "Réservations", get: () => true },
  { label: "Paiement Mobile Money", get: () => true },
  { label: "Programme de fidélité", get: () => true },
];

const FAQ_ITEMS = [
  {
    question: "La commission s'ajoute-t-elle à l'abonnement ?",
    answer:
      "Oui. L'abonnement mensuel donne accès à la plateforme ; la commission est un pourcentage de la valeur des commandes livrées. Elle ne s'applique jamais aux commandes annulées, ni aux frais de livraison — cet argent est votre coût, pas votre recette.",
  },
  {
    question: "Que se passe-t-il si je paie en retard ?",
    answer:
      "Vous disposez de trois jours de grâce après l'échéance, pendant lesquels tout continue de fonctionner normalement avec un simple rappel affiché. Au-delà, le compte passe aux limites de la formule Starter jusqu'au règlement — vos données restent intactes et la page de facturation reste toujours accessible.",
  },
  {
    question: "Puis-je changer de formule en cours de mois ?",
    answer:
      "Oui, à tout moment et dans les deux sens. Le changement prend effet dès la confirmation du paiement, et la période déjà réglée est prise en compte.",
  },
  {
    question: "Chaque succursale a-t-elle besoin de son propre abonnement ?",
    answer:
      "Oui : le tarif s'entend par établissement, car chaque succursale a son menu, son équipe et ses commandes. La formule Enterprise est conçue pour les groupes à plusieurs adresses.",
  },
  {
    question: "Comment se passe le paiement ?",
    answer:
      "Vous saisissez votre numéro MTN MoMo ou Orange Money, puis validez la demande sur votre téléphone. Votre formule est activée dès la confirmation de l'opérateur.",
  },
];

export default async function PricingPage() {
  const plans = await listPublicPlans();

  return (
    <>
      <section className="container-page py-14 text-center lg:py-20">
        <SectionTag>Tarifs</SectionTag>
        <h1 className="mx-auto mt-4 max-w-2xl font-display text-4xl font-bold sm:text-5xl">
          Un tarif clair, par établissement
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-text-secondary">
          Sans engagement, payable par Mobile Money. Changez ou arrêtez à tout moment.
        </p>
      </section>

      <section className="container-page pb-16">
        {/*
          Rendered from the plan rows, never hardcoded (§14.1). The limits
          advertised here are the same values the app enforces.
        */}
        <PricingGrid plans={plans} />
      </section>

      <section className="bg-surface-2 py-16">
        <div className="container-page">
          <SectionHeader title="Comparer les formules" />

          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <caption className="sr-only">Comparaison détaillée des formules</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-5 py-4 text-left text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
                    Fonctionnalité
                  </th>
                  {plans.map((p) => (
                    <th
                      key={p.id}
                      scope="col"
                      className="px-5 py-4 text-center font-display text-base font-bold whitespace-nowrap"
                    >
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="px-5 py-3.5 text-left font-medium">
                      {row.label}
                    </th>
                    {plans.map((p) => {
                      const value = row.get(p);
                      return (
                        <td key={p.id} className="px-5 py-3.5 text-center">
                          {typeof value === "boolean" ? (
                            value ? (
                              <Check className="mx-auto size-4 text-primary" aria-label="Inclus" />
                            ) : (
                              <Minus className="mx-auto size-4 text-text-light" aria-label="Non inclus" />
                            )
                          ) : (
                            <span className="tnum font-semibold">{value}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-5 text-center text-sm text-text-secondary">
            Besoin d&apos;autre chose ?{" "}
            <Link href="/contact" className="font-semibold text-primary underline underline-offset-4">
              Parlons-en
            </Link>
          </p>
        </div>
      </section>

      <section className="container-page py-16">
        <SectionHeader title="Questions sur la facturation" />
        <Faq items={FAQ_ITEMS} />
      </section>

      <CtaBanner
        title="Prêt à inscrire votre restaurant ?"
        description="La validation prend en général moins de 48 heures."
        primary={{ href: "/register/restaurant", label: "Créer mon compte restaurant" }}
        secondary={{ href: "/contact", label: "Poser une question" }}
      />
    </>
  );
}
