"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * The plan gate's tenant-facing half — the "upgrade" prompt.
 *
 * Shown by the pages of features a Starter plan does not include (reports,
 * reservations, staff). The sidebar lock is the other half: the page stays
 * reachable, so the gate is a decision this component renders rather than a
 * redirect that tells the tenant they are not allowed in.
 *
 * The copy sells the plan, not the wall: "upgrade to unlock", never "you are
 * blocked". The CTA always lands on /m/billing — the one page a tenant must
 * reach to do something about it.
 *
 * A Client Component because its copy is translated and the page that decides
 * whether to show it is a Server Component.
 */
export function PlanGateUpsell({
  feature,
  plan,
}: {
  /** `mgate.feature.*` key — what the tenant would get by upgrading. */
  feature: TranslationKey;
  /** `mgate.plan.*` key — the tier that includes the feature. */
  plan: TranslationKey;
}) {
  const { t } = useLocale();

  return (
    <Card className="mx-auto max-w-lg">
      <CardBody className="py-12 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-warning-light text-warning">
          <Lock className="size-6" aria-hidden />
        </span>
        <h2 className="mt-4 font-display text-xl font-bold">
          {t("mgate.title", { feature: t(feature), plan: t(plan) })}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">
          {t("mgate.body", { feature: t(feature), plan: t(plan) })}
        </p>
        <Link
          href="/m/billing"
          className={buttonClasses({ size: "lg", className: "mt-6 w-full sm:w-auto" })}
        >
          {t("mgate.cta")}
        </Link>
      </CardBody>
    </Card>
  );
}